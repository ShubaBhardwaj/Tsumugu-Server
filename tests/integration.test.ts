import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { MockLanguageModelV4 } from "ai/test";
import { retrieveWorkspaceContext } from "../src/lib/rag/retrieve";
import { createApp } from "../src/app";
import prisma from "../src/lib/db";
import { sessionProvider } from "../src/middleware/require-auth.middleware";
import { sourceProviders } from "../src/lib/source-providers";
import { memoryClientProvider } from "../src/lib/mem0";
import { aiProvider } from "../src/lib/ai-provider";
import {
  artifactGenerator,
  gatherSourceContext,
} from "../src/services/artifact-generation.services";
import { chatModelProvider } from "../src/services/chat.services";
import {
  jobTransport,
  deliverJob,
  recoverJobs,
  runJob,
  waitForDeliveries,
  retryJobForUser,
} from "../src/services/job.services";
import {
  createJob,
  workspaceTransaction,
} from "../src/repository/job.repository";
import { createMessageRecord } from "../src/repository/message.repository";
import {
  reprocessSource,
  deleteSourceForWorkspace,
} from "../src/services/source.services";
import { reconcileLegacyJobs } from "../src/services/job-recovery.services";
import { assertTestDatabase } from "./helpers";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("isolated PostgreSQL and HTTP flows", () => {
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
  let base: string;
  let ws: string;
  const vectors = new Map<string, any>();
  const call = (
    method: string,
    path: string,
    body?: unknown,
    user: string | null = "alice",
  ) =>
    fetch(base + path, {
      method,
      headers: {
        ...(user ? { "x-test-user": user } : {}),
        "Content-Type": "application/json",
        Origin: "http://localhost:3001",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const json = async (response: Response) => response.json() as Promise<any>;
  async function source(content = "Study material") {
    const response = await call("POST", `/api/workspaces/${ws}/sources`, {
      type: "TEXT",
      title: "Biology",
      content,
    });
    expect(response.status).toBe(201);
    await waitForDeliveries();
    return json(response);
  }
  async function execute(id: string) {
    await waitForDeliveries();
    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id } });
    await runJob(id, job.deliveryGeneration);
  }
  function model(text = "Answer from the source [1]", error = false) {
    return new MockLanguageModelV4({
      doStream: async () =>
        ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "t" });
              controller.enqueue({ type: "text-delta", id: "t", delta: text });
              if (error)
                controller.enqueue({
                  type: "error",
                  error: new Error("model failed"),
                });
              else {
                controller.enqueue({ type: "text-end", id: "t" });
                controller.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: {
                    inputTokens: { total: 10 },
                    outputTokens: { total: 10 },
                  },
                });
              }
              controller.close();
            },
          }),
        }) as any,
    });
  }
  beforeAll(async () => {
    assertTestDatabase(process.env.TEST_DATABASE_URL!);
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "user", "background_job" CASCADE');
    vectors.clear();
    await prisma.user.createMany({
      data: [
        { id: "alice", name: "Alice", email: "alice@test.invalid" },
        { id: "bob", name: "Bob", email: "bob@test.invalid" },
      ],
    });
    ws = (
      await prisma.workspace.create({
        data: { userId: "alice", title: "Study" },
      })
    ).id;
    spyOn(sessionProvider, "get").mockImplementation(async (headers) =>
      headers["x-test-user"]
        ? ({ user: { id: String(headers["x-test-user"]) } } as any)
        : null,
    );
    spyOn(jobTransport, "send").mockResolvedValue({ ids: ["accepted"] } as any);
    spyOn(sourceProviders, "embedTexts").mockImplementation(async (texts) =>
      texts.map(() => [0.1, 0.2]),
    );
    spyOn(sourceProviders, "upsertSourceVectors").mockImplementation(
      async (workspaceId, records) => {
        for (const record of records)
          vectors.set(record.id, { ...record, workspaceId, score: 0.9 });
      },
    );
    spyOn(sourceProviders, "deleteVectorIds").mockImplementation(
      async (_workspace, ids) => {
        for (const id of ids) vectors.delete(id);
      },
    );
    spyOn(sourceProviders, "deleteSourceVectors").mockImplementation(
      async (workspaceId, sourceId) => {
        for (const [id, record] of vectors)
          if (
            record.workspaceId === workspaceId &&
            record.metadata.sourceId === sourceId
          )
            vectors.delete(id);
      },
    );
    spyOn(sourceProviders, "deleteJobVectors").mockImplementation(
      async (workspaceId, sourceId, jobId, runId) => {
        for (const [id, record] of vectors)
          if (
            record.workspaceId === workspaceId &&
            record.metadata.sourceId === sourceId &&
            record.metadata.jobId === jobId &&
            (!runId || record.metadata.runId === runId)
          )
            vectors.delete(id);
      },
    );
    spyOn(sourceProviders, "deleteWorkspaceVectors").mockImplementation(
      async (workspaceId) => {
        for (const [id, record] of vectors)
          if (record.workspaceId === workspaceId) vectors.delete(id);
      },
    );
    spyOn(sourceProviders, "queryWorkspaceVectors").mockImplementation(
      async (workspaceId) =>
        [...vectors.values()].filter((v) => v.workspaceId === workspaceId),
    );
    spyOn(sourceProviders, "deletePdfFromCloudinary").mockResolvedValue(
      undefined,
    );
    spyOn(sourceProviders, "extractPdfFromCloudinary").mockResolvedValue({
      text: "First page. Third page.",
      pages: ["First page.", "", "Third page."],
      pageCount: 3,
    });
    spyOn(sourceProviders, "uploadPdfToCloudinary").mockResolvedValue({
      secureUrl: "https://test.invalid/file.pdf",
      publicId: "file",
      bytes: 10,
      originalFilename: "file.pdf",
      resourceType: "raw",
    });
    spyOn(sourceProviders, "scrapeWebsite").mockResolvedValue({
      markdown: "Website text",
      title: "Website",
      sourceUrl: "https://test.invalid",
    });
    spyOn(sourceProviders, "fetchYoutubeTranscript").mockResolvedValue({
      videoId: "12345678901",
      content: "Transcript",
    });
    spyOn(memoryClientProvider, "get").mockReturnValue({
      get: async () => ({
        id: "m",
        userId: "alice",
        memory: "Short explanations",
      }),
      update: async () => [{ id: "m", memory: "updated" }],
      delete: async () => ({}),
      search: async () => ({ results: [] }),
      getAll: async () => ({ results: [] }),
      add: async () => [{ id: "m", memory: "Short explanations" }],
    } as any);
    spyOn(aiProvider, "generateText").mockResolvedValue({
      text: "A short summary.",
    } as any);
    spyOn(artifactGenerator, "generate").mockResolvedValue({
      markdown: "A source-based summary.",
    });
    spyOn(chatModelProvider, "get").mockReturnValue(model());
  });
  afterEach(async () => {
    await waitForDeliveries();
    mock.restore();
  });

  test("migration upgrades tied messages with stable positions and clamps progress", async () => {
    const client = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query(
        "CREATE SCHEMA upgrade_fixture; SET search_path TO upgrade_fixture",
      );
      await client.query(
        readFileSync(
          "prisma/migrations/20261114123150_init/migration.sql",
          "utf8",
        ),
      );
      await client.query(
        `INSERT INTO "user" (id,name,email,"updatedAt") VALUES ('u','U','u@x',NOW()); INSERT INTO workspace (id,"userId",title,"updatedAt") VALUES ('w','u','W',NOW()); INSERT INTO conversation (id,"workspaceId","summaryMessageCount","updatedAt") VALUES ('c','w',99,NOW()); INSERT INTO message (id,"conversationId",role,content,"createdAt") VALUES ('b','c','USER','second','2026-01-01'),('a','c','USER','first','2026-01-01')`,
      );
      await client.query(
        readFileSync(
          "prisma/migrations/20261115110000_complete_backend_fixes/migration.sql",
          "utf8",
        ),
      );
      expect(
        (
          await client.query(
            "SELECT id,position FROM message ORDER BY position",
          )
        ).rows,
      ).toEqual([
        { id: "a", position: 1 },
        { id: "b", position: 2 },
      ]);
      expect(
        (
          await client.query(
            'SELECT "messageCount", "summaryMessageCount" FROM conversation',
          )
        ).rows[0],
      ).toEqual({ messageCount: 2, summaryMessageCount: 2 });
    } finally {
      await client.query(
        "SET search_path TO public; DROP SCHEMA IF EXISTS upgrade_fixture CASCADE",
      );
      await client.end();
    }
  });
  test("memory routes enforce sessions, ownership, outages, and owner success", async () => {
    expect(
      (await call("PATCH", "/api/memory/m", { memory: "new" }, null)).status,
    ).toBe(401);
    expect(
      (await call("PATCH", "/api/memory/m", { memory: "new" }, "bob")).status,
    ).toBe(404);
    expect(
      (await call("DELETE", "/api/memory/m", undefined, "bob")).status,
    ).toBe(404);
    expect(
      (await call("PATCH", "/api/memory/m", { memory: "new" })).status,
    ).toBe(200);
    expect((await call("DELETE", "/api/memory/m")).status).toBe(204);
    spyOn(memoryClientProvider, "get").mockReturnValue({
      get: async () => {
        throw Error("outage");
      },
    } as any);
    expect((await call("DELETE", "/api/memory/m")).status).toBe(503);
  });
  test("source + job rolls back together; foreign users cannot create sources", async () => {
    expect(
      (
        await call(
          "POST",
          `/api/workspaces/${ws}/sources`,
          { type: "TEXT", title: "t", content: "x" },
          "bob",
        )
      ).status,
    ).toBe(404);
    await expect(
      workspaceTransaction(ws, async (tx) => {
        const row = await tx.source.create({
          data: { workspaceId: ws, type: "TEXT", title: "t" },
        });
        await createJob(tx, {
          type: "SOURCE",
          ownerId: "alice",
          workspaceId: ws,
          resourceId: row.id,
        });
        throw Error("rollback");
      }),
    ).rejects.toThrow();
    expect(await prisma.source.count()).toBe(0);
    expect(await prisma.backgroundJob.count()).toBe(0);
  });
  test("missed delivery survives recovery and retry preserves source identity", async () => {
    spyOn(jobTransport, "send").mockRejectedValue(Error("offline"));
    const row = await source();
    expect(await prisma.backgroundJob.count()).toBe(1);
    let job = await prisma.backgroundJob.findUniqueOrThrow({
      where: { id: row.jobId },
    });
    expect(job.status).toBe("PENDING");
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { deliveryAttempts: 7, nextAttemptAt: new Date(0) },
    });
    await deliverJob(job.id);
    expect(
      (await prisma.source.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe("FAILED");
    spyOn(jobTransport, "send").mockResolvedValue({ ids: ["ok"] } as any);
    const [a, b] = await Promise.all([
      retryJobForUser(job.id, "alice"),
      retryJobForUser(job.id, "alice"),
    ]);
    expect(a.jobId).toBe(b.jobId);
    expect(await prisma.source.count()).toBe(1);
    await execute(a.jobId);
    expect(
      (await prisma.source.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe("READY");
    expect(
      (await call("GET", `/api/jobs/${a.jobId}`, undefined, "bob")).status,
    ).toBe(404);
  });
  test("stale acknowledged and running jobs use a new delivery generation", async () => {
    const row = await source();
    await prisma.backgroundJob.update({
      where: { id: row.jobId },
      data: {
        status: "RUNNING",
        leaseUntil: new Date(0),
        leaseToken: "expired",
      },
    });
    await recoverJobs();
    const job = await prisma.backgroundJob.findUniqueOrThrow({
      where: { id: row.jobId },
    });
    expect(job.deliveryGeneration).toBe(1);
    await runJob(job.id, 0);
    expect(await prisma.sourceChunk.count()).toBe(0);
    await execute(job.id);
    const count = await prisma.sourceChunk.count();
    await execute(job.id);
    expect(await prisma.sourceChunk.count()).toBe(count);
  });
  test("PDF pages survive saved combined text and fewer-chunk reprocessing", async () => {
    const response = await call(
      "POST",
      `/api/workspaces/${ws}/sources/import/website`,
      { url: "https://example.com" },
    );
    expect(response.status).toBe(201);
    const row = await source("x".repeat(2500));
    await execute(row.jobId);
    expect(
      await prisma.sourceChunk.count({ where: { sourceId: row.id } }),
    ).toBeGreaterThan(1);
    await prisma.source.update({
      where: { id: row.id },
      data: {
        type: "PDF",
        content: "old combined text",
        metadata: { fileUrl: "https://test.invalid/a.pdf", publicId: "p" },
      },
    });
    const job = await reprocessSource(ws, row.id, "alice");
    await execute(job.jobId);
    const chunks = await prisma.sourceChunk.findMany({
      where: { sourceId: row.id },
      orderBy: { index: "asc" },
    });
    expect(chunks.map((c) => (c.metadata as any).page)).toEqual([1, 3]);
    expect(
      [...vectors.values()].filter((v) => v.metadata.sourceId === row.id),
    ).toHaveLength(2);
  });
  test("deleted sources immediately disappear; cleanup retries and removes files", async () => {
    const row = await source();
    await execute(row.jobId);
    await prisma.source.update({
      where: { id: row.id },
      data: { metadata: { publicId: "uploaded", resourceType: "raw" } },
    });
    expect(
      (
        await call("POST", `/api/workspaces/${ws}/sources/bulk-delete`, {
          sourceIds: [row.id, "foreign"],
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("GET", `/api/workspaces/${ws}/sources/${row.id}`)).status,
    ).toBe(200);
    await deleteSourceForWorkspace(ws, row.id, "alice");
    expect(
      (await call("GET", `/api/workspaces/${ws}/sources/${row.id}`)).status,
    ).toBe(404);
    const cleanup = await prisma.backgroundJob.findFirstOrThrow({
      where: { type: "SOURCE_CLEANUP" },
    });
    spyOn(sourceProviders, "deleteSourceVectors").mockRejectedValueOnce(
      Error("offline"),
    );
    await execute(cleanup.id);
    expect(
      (
        await prisma.backgroundJob.findUniqueOrThrow({
          where: { id: cleanup.id },
        })
      ).status,
    ).toBe("PENDING");
    await execute(cleanup.id);
    expect(await prisma.source.count()).toBe(0);
    expect(sourceProviders.deletePdfFromCloudinary).toHaveBeenCalledWith(
      "uploaded",
      "raw",
    );
  });
  test("artifact API validates selection and content and can retry the same artifact", async () => {
    const row = await source();
    await execute(row.jobId);
    for (const sourceIds of [[], [row.id, "foreign"]])
      expect(
        (
          await call("POST", `/api/workspaces/${ws}/artifacts`, {
            type: "SUMMARY",
            sourceIds,
          })
        ).status,
      ).toBe(400);
    const response = await call("POST", `/api/workspaces/${ws}/artifacts`, {
      type: "SUMMARY",
      sourceIds: [row.id],
    });
    expect(response.status).toBe(202);
    const artifact = await json(response);
    await execute(artifact.jobId);
    expect(
      (
        await json(
          await call("GET", `/api/workspaces/${ws}/artifacts/${artifact.id}`),
        )
      ).status,
    ).toBe("READY");
    expect(
      (
        await call(
          "GET",
          `/api/workspaces/${ws}/artifacts/${artifact.id}`,
          undefined,
          "bob",
        )
      ).status,
    ).toBe(404);
    expect((await call("GET", `/api/workspaces/${ws}/artifacts`)).status).toBe(
      200,
    );
    expect(
      (await call("DELETE", `/api/workspaces/${ws}/artifacts/${artifact.id}`))
        .status,
    ).toBe(204);
    await execute(artifact.jobId);
    expect(await prisma.learningArtifact.count()).toBe(0);
  });
  test("context references exclude unused sources and record truncation", async () => {
    const row = await source("x".repeat(130000));
    await prisma.source.update({
      where: { id: row.id },
      data: { status: "READY" },
    });
    const extra = await prisma.source.create({
      data: {
        workspaceId: ws,
        type: "TEXT",
        title: "Extra",
        content: "extra",
        status: "READY",
      },
    });
    const result = await gatherSourceContext(ws, [row.id, extra.id]);
    expect(result.sourceIds).toEqual([row.id]);
    expect(result.truncatedSources).toEqual([row.id]);
    expect(result.text.length).toBeLessThanOrEqual(120000);
  });
  test("chat streams cited answers with owned persisted history; malformed bodies write nothing", async () => {
    const row = await source();
    await execute(row.jobId);
    expect(
      (await call("POST", `/api/workspaces/${ws}/chat`, { messages: [{}] }))
        .status,
    ).toBe(400);
    expect(await prisma.message.count()).toBe(0);
    const body = {
      messages: [
        {
          id: "u",
          role: "user",
          parts: [{ type: "text", text: "Explain biology" }],
        },
      ],
    };
    const response = await call("POST", `/api/workspaces/${ws}/chat`, body);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "X-Conversation-Id",
    );
    const id = response.headers.get("x-conversation-id")!;
    expect(await response.text()).toContain("Answer from the source");
    const history = await json(
      await call("GET", `/api/workspaces/${ws}/conversations/${id}/messages`),
    );
    expect(history.map((m: any) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(history[1].citations[0].sourceId).toBe(row.id);
    expect(
      (
        await call(
          "GET",
          `/api/workspaces/${ws}/conversations/${id}/messages`,
          undefined,
          "bob",
        )
      ).status,
    ).toBe(404);
    expect(
      (await call("GET", `/api/workspaces/${ws}/conversations`)).status,
    ).toBe(200);
    expect(
      (await call("DELETE", `/api/workspaces/${ws}/conversations/${id}`))
        .status,
    ).toBe(204);
  });
  test("stream errors do not persist a completed assistant answer", async () => {
    spyOn(chatModelProvider, "get").mockReturnValue(model("partial", true));
    const response = await call("POST", `/api/workspaces/${ws}/chat`, {
      messages: [
        { id: "u", role: "user", parts: [{ type: "text", text: "Question" }] },
      ],
    });
    await response.text();
    expect(await prisma.message.count({ where: { role: "ASSISTANT" } })).toBe(
      0,
    );
  });
  test("summary reads only new positions; memory outage retries independently", async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId: ws },
    });
    const inserted = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        createMessageRecord({
          conversationId: conversation.id,
          role: i % 2 ? "ASSISTANT" : "USER",
          content: `message-${i + 1}`,
        }),
      ),
    );
    expect(new Set(inserted.map((m) => m.position)).size).toBe(16);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { summary: "Earlier summary", summaryMessageCount: 8 },
    });
    const job = await workspaceTransaction(ws, (tx) =>
      createJob(tx, {
        type: "SUMMARY",
        resourceId: conversation.id,
        workspaceId: ws,
        ownerId: "alice",
      }),
    );
    await execute(job.id);
    expect(aiProvider.generateText).toHaveBeenCalledTimes(1);
    const prompt = (aiProvider.generateText as any).mock.calls[0][0].prompt;
    expect(prompt).not.toContain("message-1\n");
    expect(
      (
        await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        })
      ).summaryMessageCount,
    ).toBe(16);
    const memory = await workspaceTransaction(ws, (tx) =>
      createJob(tx, {
        type: "MEMORY",
        resourceId: conversation.id,
        workspaceId: ws,
        ownerId: "alice",
        payload: { messageIds: inserted.slice(-2).map((m) => m.id) },
      }),
    );
    spyOn(memoryClientProvider, "get").mockReturnValue({
      add: async () => {
        throw Error("offline");
      },
    } as any);
    await execute(memory.id);
    expect(aiProvider.generateText).toHaveBeenCalledTimes(1);
    expect(
      (
        await prisma.backgroundJob.findUniqueOrThrow({
          where: { id: memory.id },
        })
      ).status,
    ).toBe("PENDING");
  });
  test("oversized bodies return 413 and legacy orphan work is recovered", async () => {
    expect(
      (
        await call("POST", `/api/workspaces/${ws}/chat`, {
          text: "x".repeat(270000),
        })
      ).status,
    ).toBe(413);
    const legacy = await prisma.source.create({
      data: {
        workspaceId: ws,
        title: "Legacy",
        type: "TEXT",
        content: "Legacy",
        status: "PENDING",
      },
    });
    await reconcileLegacyJobs();
    const row = await prisma.source.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    expect(row.jobId).toBeTruthy();
    await reconcileLegacyJobs();
    expect(
      await prisma.backgroundJob.count({ where: { resourceId: legacy.id } }),
    ).toBe(1);
  });
  test("missed acknowledgement is retried with the same delivery identity", async () => {
    const row = await source();
    await prisma.backgroundJob.update({
      where: { id: row.jobId },
      data: { status: "PENDING", leaseUntil: null, nextAttemptAt: new Date(0) },
    });
    spyOn(jobTransport, "send").mockRejectedValueOnce(
      Error("acknowledgement lost"),
    );
    await deliverJob(row.jobId);
    await prisma.backgroundJob.update({
      where: { id: row.jobId },
      data: { nextAttemptAt: new Date(0) },
    });
    await recoverJobs();
    const calls = (jobTransport.send as any).mock.calls;
    expect(calls.at(-1)[1]).toBe(calls.at(-2)[1]);
    await execute(row.jobId);
    expect(
      (
        await prisma.backgroundJob.findUniqueOrThrow({
          where: { id: row.jobId },
        })
      ).status,
    ).toBe("SUCCEEDED");
  });
  test("repeatedly interrupted jobs terminate visibly", async () => {
    const row = await source();
    await prisma.backgroundJob.update({
      where: { id: row.jobId },
      data: {
        status: "RUNNING",
        processingAttempts: 4,
        leaseUntil: new Date(0),
      },
    });
    await recoverJobs();
    expect(
      (
        await prisma.backgroundJob.findUniqueOrThrow({
          where: { id: row.jobId },
        })
      ).status,
    ).toBe("FAILED");
    expect(
      (await prisma.source.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe("FAILED");
  });
  test("deleting during an external vector write blocks retrieval and finishes cleanup", async () => {
    const row = await source();
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    spyOn(sourceProviders, "upsertSourceVectors").mockImplementation(
      async (workspaceId, records) => {
        started();
        await gate;
        for (const record of records)
          vectors.set(record.id, { ...record, workspaceId, score: 0.9 });
      },
    );
    const running = execute(row.jobId);
    await entered;
    await deleteSourceForWorkspace(ws, row.id, "alice");
    expect(await retrieveWorkspaceContext(ws, "material")).toEqual([]);
    const cleanup = await prisma.backgroundJob.findFirstOrThrow({
      where: { type: "SOURCE_CLEANUP" },
    });
    await execute(cleanup.id);
    expect(
      (
        await prisma.backgroundJob.findUniqueOrThrow({
          where: { id: cleanup.id },
        })
      ).status,
    ).toBe("PENDING");
    release();
    await running;
    await execute(cleanup.id);
    expect(vectors.size).toBe(0);
    expect(await prisma.source.count()).toBe(0);
  });
  test("workspace cleanup hides children, cancels work and deletes its files and namespace", async () => {
    const row = await source();
    await execute(row.jobId);
    await prisma.source.update({
      where: { id: row.id },
      data: { metadata: { publicId: "pdf" } },
    });
    const conversation = await json(
      await call("POST", `/api/workspaces/${ws}/conversations`, {
        title: "Chat",
      }),
    );
    const artifact = await json(
      await call("POST", `/api/workspaces/${ws}/artifacts`, {
        type: "SUMMARY",
      }),
    );
    expect((await call("DELETE", `/api/workspaces/${ws}`)).status).toBe(204);
    expect(
      (
        await call(
          "GET",
          `/api/workspaces/${ws}/conversations/${conversation.id}/messages`,
        )
      ).status,
    ).toBe(404);
    await execute(artifact.jobId);
    expect(artifactGenerator.generate).not.toHaveBeenCalled();
    const cleanup = await prisma.backgroundJob.findFirstOrThrow({
      where: { type: "WORKSPACE_CLEANUP" },
    });
    await execute(cleanup.id);
    expect(await prisma.workspace.count()).toBe(0);
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.learningArtifact.count()).toBe(0);
    expect(sourceProviders.deleteWorkspaceVectors).toHaveBeenCalledWith(ws);
    expect(sourceProviders.deletePdfFromCloudinary).toHaveBeenCalledWith(
      "pdf",
      "raw",
    );
    expect(
      await prisma.backgroundJob.count({
        where: { id: cleanup.id, status: "SUCCEEDED" },
      }),
    ).toBe(1);
  });
  test("orphan and superseded vector matches are never included", async () => {
    const row = await source();
    await execute(row.jobId);
    vectors.set("orphan", {
      workspaceId: ws,
      score: 0.99,
      metadata: {
        sourceId: "missing",
        sourceTitle: "Ghost",
        sourceType: "TEXT",
        chunkId: "ghost",
        text: "deleted",
      },
    });
    vectors.set("old", {
      workspaceId: ws,
      score: 0.99,
      metadata: {
        sourceId: row.id,
        jobId: row.jobId,
        runId: "old",
        sourceTitle: "Old",
        sourceType: "TEXT",
        chunkId: "old",
        text: "superseded",
      },
    });
    const result = await retrieveWorkspaceContext(ws, "material");
    expect(result).toHaveLength(1);
    expect(result[0].sourceTitle).toBe("Biology");
  });
  test("invalid AI output fails and owner retry keeps the artifact ID", async () => {
    const row = await source();
    await execute(row.jobId);
    const artifact = await json(
      await call("POST", `/api/workspaces/${ws}/artifacts`, { type: "QUIZ" }),
    );
    spyOn(artifactGenerator, "generate").mockResolvedValue({
      questions: Array.from({ length: 3 }, () => ({
        question: "q",
        options: ["a", "b"],
        correctIndex: 5,
        explanation: "bad",
      })),
    });
    for (let i = 0; i < 3; i++) await execute(artifact.jobId);
    expect(
      (
        await prisma.learningArtifact.findUniqueOrThrow({
          where: { id: artifact.id },
        })
      ).status,
    ).toBe("FAILED");
    const retry = await json(
      await call(
        "POST",
        `/api/workspaces/${ws}/artifacts/${artifact.id}/retry`,
        {},
      ),
    );
    spyOn(artifactGenerator, "generate").mockResolvedValue({
      questions: Array.from({ length: 3 }, () => ({
        question: "q",
        options: ["a", "b"],
        correctIndex: 1,
        explanation: "b",
      })),
    });
    await execute(retry.jobId);
    expect(
      (
        await prisma.learningArtifact.findUniqueOrThrow({
          where: { id: artifact.id },
        })
      ).status,
    ).toBe("READY");
    expect(await prisma.learningArtifact.count()).toBe(1);
  });
  test("source deletion before generation produces a failure, never substitute sources", async () => {
    const row = await source();
    await execute(row.jobId);
    const other = await source("other");
    await execute(other.jobId);
    const artifact = await json(
      await call("POST", `/api/workspaces/${ws}/artifacts`, {
        type: "SUMMARY",
        sourceIds: [row.id],
      }),
    );
    await deleteSourceForWorkspace(ws, row.id, "alice");
    await execute(artifact.jobId);
    expect(artifactGenerator.generate).not.toHaveBeenCalled();
    expect(
      (
        await prisma.learningArtifact.findUniqueOrThrow({
          where: { id: artifact.id },
        })
      ).content,
    ).toBeNull();
  });
  test("concurrent summary jobs and generation failure preserve progress", async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId: ws, summary: "Old", summaryMessageCount: 0 },
    });
    for (let i = 0; i < 8; i++)
      await createMessageRecord({
        conversationId: conversation.id,
        role: "USER",
        content: `new-${i}`,
      });
    const jobs = await workspaceTransaction(ws, async (tx) =>
      Promise.all([
        createJob(tx, {
          type: "SUMMARY",
          resourceId: conversation.id,
          workspaceId: ws,
          ownerId: "alice",
        }),
        createJob(tx, {
          type: "SUMMARY",
          resourceId: conversation.id,
          workspaceId: ws,
          ownerId: "alice",
        }),
      ]),
    );
    spyOn(aiProvider, "generateText").mockRejectedValueOnce(Error("offline"));
    await execute(jobs[0].id);
    expect(
      (
        await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        })
      ).summaryMessageCount,
    ).toBe(0);
    spyOn(aiProvider, "generateText").mockResolvedValue({
      text: "New summary",
    } as any);
    await Promise.all(jobs.map((job) => execute(job.id)));
    for (const job of jobs) await execute(job.id);
    expect(aiProvider.generateText).toHaveBeenCalledTimes(2);
    expect(
      (
        await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        })
      ).summaryMessageCount,
    ).toBe(8);
  });
  test("forged memory owner and deleted conversation jobs are cancelled", async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId: ws },
    });
    const job = await workspaceTransaction(ws, (tx) =>
      createJob(tx, {
        type: "MEMORY",
        resourceId: conversation.id,
        workspaceId: ws,
        ownerId: "bob",
      }),
    );
    await execute(job.id);
    expect(
      (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("CANCELLED");
    const summary = await workspaceTransaction(ws, (tx) =>
      createJob(tx, {
        type: "SUMMARY",
        resourceId: conversation.id,
        workspaceId: ws,
        ownerId: "alice",
      }),
    );
    await call(
      "DELETE",
      `/api/workspaces/${ws}/conversations/${conversation.id}`,
    );
    await execute(summary.id);
    expect(aiProvider.generateText).not.toHaveBeenCalled();
  });
  test("optional memory search outage still permits chat and disabled memory creates no jobs", async () => {
    spyOn(memoryClientProvider, "get").mockReturnValue({
      search: async () => {
        throw Error("offline");
      },
    } as any);
    const body = {
      messages: [
        { id: "u", role: "user", parts: [{ type: "text", text: "Question" }] },
      ],
    };
    const response = await call("POST", `/api/workspaces/${ws}/chat`, body);
    expect(await response.text()).toContain("Answer from the source");
    const key = process.env.MEM0_API_KEY;
    process.env.MEM0_API_KEY = "";
    try {
      const conversation = await json(
        await call("POST", `/api/workspaces/${ws}/conversations`, {}),
      );
      const next = await call("POST", `/api/workspaces/${ws}/chat`, {
        ...body,
        conversationId: conversation.id,
      });
      await next.text();
      expect(
        await prisma.backgroundJob.count({
          where: { resourceId: conversation.id, type: "MEMORY" },
        }),
      ).toBe(0);
    } finally {
      process.env.MEM0_API_KEY = key;
    }
  });
  test("PDF multipart, Markdown and YouTube imports enter the shared pipeline", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["%PDF-stub"], { type: "application/pdf" }),
      "study.pdf",
    );
    const response = await fetch(
      base + `/api/workspaces/${ws}/sources/upload`,
      { method: "POST", headers: { "x-test-user": "alice" }, body: form },
    );
    expect(response.status).toBe(201);
    const pdf = await json(response);
    await execute(pdf.jobId);
    expect(
      (await retrieveWorkspaceContext(ws, "page")).map((c) => c.page),
    ).toEqual([1, 3]);
    const md = await json(
      await call("POST", `/api/workspaces/${ws}/sources`, {
        type: "MARKDOWN",
        title: "Notes",
        content: "# Topic",
      }),
    );
    await execute(md.jobId);
    expect(
      (await prisma.source.findUniqueOrThrow({ where: { id: md.id } })).content,
    ).toBe("# Topic");
    const video = await json(
      await call("POST", `/api/workspaces/${ws}/sources/import/youtube`, {
        url: "https://youtu.be/12345678901",
      }),
    );
    await execute(video.jobId);
    expect(
      (await prisma.source.findUniqueOrThrow({ where: { id: video.id } }))
        .status,
    ).toBe("READY");
  });

  test("Node runtime disconnect aborts generation without saving an assistant reply", () => {
    const result = spawnSync("node", ["tests/node-disconnect.mjs"], {
      env: process.env,
      encoding: "utf8",
      timeout: 15000,
    });
    if (result.status !== 0)
      throw new Error(
        result.stderr ||
          result.error?.message ||
          "Node runtime cancellation failed",
      );
    expect(result.stdout).toContain("Node disconnect verified");
  });

  test("large summary backlogs and legacy oversized messages stay within input limits", async () => {
    const conversation = await prisma.conversation.create({
      data: { workspaceId: ws },
    });
    for (let i = 0; i < 7; i++)
      await createMessageRecord({
        conversationId: conversation.id,
        role: "USER",
        content: "x".repeat(i === 0 ? 30000 : 8000),
      });
    const job = await workspaceTransaction(ws, (tx) =>
      createJob(tx, {
        type: "SUMMARY",
        resourceId: conversation.id,
        workspaceId: ws,
        ownerId: "alice",
      }),
    );
    await execute(job.id);
    expect(
      (
        await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        })
      ).summaryMessageCount,
    ).toBe(7);
    const calls = (aiProvider.generateText as any).mock.calls;
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((call: any) => call[0].prompt.length <= 24000)).toBe(
      true,
    );
  });
  test("a superseded active worker cannot delete the recovered run's vectors", async () => {
    const row = await source();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (entered = resolve));
    let calls = 0;
    spyOn(sourceProviders, "upsertSourceVectors").mockImplementation(
      async (workspaceId, records) => {
        if (++calls === 1) {
          entered();
          await gate;
        }
        for (const record of records)
          vectors.set(record.id, { ...record, workspaceId, score: 0.9 });
      },
    );
    const old = execute(row.jobId);
    await started;
    await prisma.backgroundJob.update({
      where: { id: row.jobId },
      data: { leaseUntil: new Date(0) },
    });
    await recoverJobs();
    await execute(row.jobId);
    release();
    await old;
    const current = await prisma.source.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(current.status).toBe("READY");
    expect(await retrieveWorkspaceContext(ws, "material")).toHaveLength(1);
    expect(
      [...vectors.values()].every(
        (v) => v.metadata.runId === (current.metadata as any).indexRun,
      ),
    ).toBe(true);
  });
});

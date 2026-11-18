import { expect, spyOn, test } from "bun:test";
import { embeddingRuntime, embedTexts } from "../src/lib/embeddings";
import { EMBEDDING_DIMENSIONS } from "../src/lib/ai-config";
import { allWorkspaceVectorNamespaces, GEMINI_EMBEDDING_PROFILE, OPENAI_EMBEDDING_PROFILE, sourceIsSearchable, sourceNeedsReindex, workspaceVectorNamespace } from "../src/lib/embedding-profile";
import { assertIndexDimensions } from "../src/lib/pinecone";
import { safeAiError } from "../src/lib/ai-errors";
import { aiProvider } from "../src/lib/ai-provider";
import { generateArtifactContent } from "../src/services/artifact-generation.services";
import { generateSummary } from "../src/services/conversation-memory.services";
import { chatModelProvider } from "../src/services/chat.services";

test("Gemini embeddings use separate document and query task types without an OpenAI key", async () => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldGeminiKey = process.env.GEMINI_API_KEY;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.01);
  const mocked = spyOn(embeddingRuntime, "embedMany").mockImplementation(
    async () => ({ embeddings: [embedding] }) as any,
  );
  try {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-only";
    delete process.env.OPENAI_API_KEY;
    expect(await embedTexts(["source text"], "document")).toEqual([embedding]);
    expect(await embedTexts(["question"], "query")).toEqual([embedding]);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(mocked.mock.calls[0]![0].providerOptions?.google).toEqual({
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: "RETRIEVAL_DOCUMENT",
    });
    expect(mocked.mock.calls[1]![0].providerOptions?.google).toEqual({
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: "RETRIEVAL_QUERY",
    });
  } finally {
    mocked.mockRestore();
    if (oldProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = oldProvider;
    if (oldGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldGeminiKey;
    if (oldOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAIKey;
  }
});

test("provider namespaces isolate Gemini while preserving legacy OpenAI vectors", () => {
  expect(workspaceVectorNamespace("workspace-1", OPENAI_EMBEDDING_PROFILE)).toBe("workspace-1");
  expect(workspaceVectorNamespace("workspace-1", GEMINI_EMBEDDING_PROFILE)).toBe(`${GEMINI_EMBEDDING_PROFILE}:workspace-1`);
  expect(new Set(allWorkspaceVectorNamespaces("workspace-1")).size).toBe(2);
  expect(() => assertIndexDimensions(1536)).not.toThrow();
  expect(() => assertIndexDimensions(3072)).toThrow("1536");
  const previous = process.env.AI_PROVIDER;
  try {
    process.env.AI_PROVIDER = "gemini";
    expect(workspaceVectorNamespace("workspace-1")).toBe(`${GEMINI_EMBEDDING_PROFILE}:workspace-1`);
  } finally {
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  }
});

test("provider switches make legacy sources require reindexing", () => {
  const previous = process.env.AI_PROVIDER;
  const legacy = { status: "READY", metadata: { indexRun: "old-run" } };
  const gemini = { status: "READY", metadata: { indexRun: "new-run", embeddingProfile: GEMINI_EMBEDDING_PROFILE } };
  try {
    process.env.AI_PROVIDER = "openai";
    expect(sourceIsSearchable(legacy)).toBe(true);
    expect(sourceNeedsReindex(legacy)).toBe(false);
    process.env.AI_PROVIDER = "gemini";
    expect(sourceIsSearchable(legacy)).toBe(false);
    expect(sourceNeedsReindex(legacy)).toBe(true);
    expect(sourceIsSearchable(gemini)).toBe(true);
    process.env.AI_PROVIDER = "openai";
    expect(sourceIsSearchable(gemini)).toBe(false);
    expect(sourceNeedsReindex(gemini)).toBe(true);
    expect(sourceNeedsReindex({ ...legacy, status: "FAILED" })).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  }
});

test("AI provider errors expose safe categories, not provider response text", () => {
  const secret = "private-source-and-key";
  const auth = safeAiError({ status: 400, message: `API key not valid: ${secret}` });
  expect(auth.code).toBe("AI_PROVIDER_AUTH");
  expect(auth.message.includes(secret)).toBe(false);
  const quota = safeAiError({ statusCode: 429, message: secret });
  expect(quota.code).toBe("AI_PROVIDER_QUOTA");
  expect(quota.retryAfter).toBe(60);
  expect(quota.message.includes(secret)).toBe(false);
  const transient = safeAiError({ status: 503, message: secret });
  expect(transient.code).toBe("AI_PROVIDER_UNAVAILABLE");
  expect(transient.message.includes(secret)).toBe(false);
});

test("Gemini-only generation covers chat model, summaries, evidence, and every study type", async () => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldGeminiKey = process.env.GEMINI_API_KEY;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  const outputs: Record<string, unknown> = {
    TAKEAWAYS: { items: ["One", "Two", "Three"] },
    FLASHCARDS: { cards: Array.from({ length: 3 }, (_, i) => ({ front: `Q${i}`, back: `A${i}` })) },
    QUIZ: { questions: Array.from({ length: 3 }, (_, i) => ({ question: `Q${i}`, options: ["A", "B"], correctIndex: 0, explanation: "Because" })) },
    MINDMAP: { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ id: "e", source: "a", target: "b" }] },
    REPORT: { markdown: "Report", sections: [{ title: "Section", content: "Text" }] },
  };
  const mocked = spyOn(aiProvider, "generateText").mockImplementation(async (options: any) => {
    expect(options.model.modelId).toBe("gemini-2.5-flash-lite");
    if (options.system?.startsWith("Determine whether")) return { output: { supported: true } } as any;
    if (options.system?.startsWith("Summarize new messages")) return { text: "Short summary" } as any;
    if (options.system?.includes("generating a summary")) return { text: "Study summary" } as any;
    const type = Object.keys(outputs).find((name) => options.system?.includes(`generating a ${name.toLowerCase()}`));
    return { output: outputs[type!] } as any;
  });
  try {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-only";
    delete process.env.OPENAI_API_KEY;
    expect(chatModelProvider.get("gemini-2.5-flash-lite").modelId).toBe("gemini-2.5-flash-lite");
    expect(await generateSummary("", "USER: explain cells")).toBe("Short summary");
    expect(await generateArtifactContent("SUMMARY", "Cells have membranes", { topic: "cells" })).toEqual({ markdown: "Study summary" });
    for (const type of ["TAKEAWAYS", "FLASHCARDS", "QUIZ", "MINDMAP", "REPORT"] as const)
      expect(await generateArtifactContent(type, "Cells have membranes")).toEqual(outputs[type]);
    expect(mocked).toHaveBeenCalledTimes(8);
  } finally {
    mocked.mockRestore();
    if (oldProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = oldProvider;
    if (oldGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldGeminiKey;
    if (oldOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAIKey;
  }
});

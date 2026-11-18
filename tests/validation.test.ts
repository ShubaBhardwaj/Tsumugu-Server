import { expect, test } from "bun:test";
import { chunkText, chunkPages } from "../src/lib/chunking";
import { parseChatBody } from "../src/validators/chat.validator";
import { validateArtifactContent } from "../src/services/artifact-generation.services";
import { readServerConfig } from "../src/lib/config";
import { summaryBatch } from "../src/services/conversation-memory.services";
import { resolveChatModel } from "../src/lib/ai-provider";
import { createWorkspaceSchema } from "../src/validators/workspace.validator";

for (const text of [
  "A".repeat(1200) + "\n\n" + "B".repeat(1200),
  "word ".repeat(1000),
  "x".repeat(10000),
  "a. ".repeat(1000),
]) {
  test(`bounded chunks preserve all text (${text.length} chars)`, () => {
    const chunks = chunkText(text);
    expect(chunks.every((c) => c.content.length <= 1000)).toBe(true);
    const reconstructed =
      chunks[0]!.content +
      chunks
        .slice(1)
        .map((c) => c.content.slice(100))
        .join("");
    expect(reconstructed).toBe(text.trim());
  });
}
test("chunk options reject invalid values and preserve page numbers", () => {
  for (const options of [
    { chunkSize: 0 },
    { chunkSize: 2, chunkOverlap: 2 },
    { chunkOverlap: -1 },
    { chunkSize: 1.5 },
  ])
    expect(() => chunkText("abc", options)).toThrow();
  expect(chunkText(" ")).toEqual([]);
  expect(
    chunkPages(["first", "", "third"]).map((c) => c.metadata?.page),
  ).toEqual([1, 3]);
  expect(
    chunkText("abcdefgh", { chunkSize: 3, chunkOverlap: 0 })
      .map((c) => c.content)
      .join(""),
  ).toBe("abcdefgh");
});
const message = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "Explain this" }],
};
test("chat validates UI message bodies before application work", async () => {
  for (const messages of [
    [{}],
    [{ ...message, role: "system" }],
    [{ ...message, parts: [{ type: "text", text: " " }] }],
    [{ ...message, parts: [{ type: "file", url: "https://example.com" }] }],
    [{ ...message, parts: [{ type: "text", text: "x".repeat(8001) }] }],
  ])
    await expect(parseChatBody({ messages })).rejects.toThrow();
  expect((await parseChatBody({ messages: [message] })).messages[0]!.id).toBe(
    "m1",
  );
  await expect(
    parseChatBody({ messages: [message], model: "arbitrary" }),
  ).rejects.toThrow();
});
test("supported web search UI parts round-trip through validation", async () => {
  const result = await parseChatBody({
    messages: [
      {
        id: "assistant",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolCallId: "call-1",
            state: "output-available",
            input: { query: "biology" },
            output: "search results",
          },
        ],
      },
      message,
    ],
  });
  expect(result.messages).toHaveLength(2);
});
export const artifacts = {
  SUMMARY: { markdown: "Useful summary" },
  TAKEAWAYS: { items: ["One", "Two", "Three"] },
  FLASHCARDS: {
    cards: Array.from({ length: 3 }, () => ({
      front: "Question",
      back: "Answer",
    })),
  },
  QUIZ: {
    questions: Array.from({ length: 3 }, () => ({
      question: "Question",
      options: ["A", "B"],
      correctIndex: 1,
      explanation: "Because B",
    })),
  },
  MINDMAP: {
    nodes: [
      { id: "a", label: "Main" },
      { id: "b", label: "Sub" },
    ],
    edges: [{ id: "edge", source: "a", target: "b" }],
  },
  REPORT: {
    markdown: "Report",
    sections: [{ title: "Section", content: "Content" }],
  },
};
for (const [type, value] of Object.entries(artifacts))
  test(`valid and invalid ${type} content`, () => {
    expect(validateArtifactContent(type as any, value)).toBeDefined();
    expect(() => validateArtifactContent(type as any, {})).toThrow();
  });
test("quiz and mindmap semantics are checked after generation", () => {
  expect(() =>
    validateArtifactContent("QUIZ", {
      questions: artifacts.QUIZ.questions.map((q) => ({
        ...q,
        correctIndex: 5,
      })),
    }),
  ).toThrow();
  expect(() =>
    validateArtifactContent("MINDMAP", {
      ...artifacts.MINDMAP,
      edges: [{ id: "e", source: "a", target: "missing" }],
    }),
  ).toThrow();
  expect(() => validateArtifactContent("SUMMARY", { markdown: " " })).toThrow();
});
test("summary batches are bounded and contiguous", () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({
    content: "x".repeat(8000),
    position: i + 1,
    role: "USER",
  }));
  const batch = summaryBatch(messages, "previous");
  expect(batch.length).toBe(2);
  expect(batch.at(-1)!.position).toBe(2);
});
test("frontend and production configuration are validated without secret values", () => {
  const base = {
    DATABASE_URL: "test",
    BETTER_AUTH_URL: "http://localhost:8080",
    BETTER_AUTH_SECRET: "sensitive",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
    OPENAI_API_KEY: "test",
  };
  expect(readServerConfig(base).clientUrl).toBe("http://localhost:3001");
  expect(() => readServerConfig({ ...base, CLIENT_URL: "invalid" })).toThrow(
    "Invalid URL setting: CLIENT_URL",
  );
  expect(() => readServerConfig({ ...base, NODE_ENV: "production" })).toThrow(
    "INNGEST_SIGNING_KEY",
  );
  const production = {
    ...base,
    NODE_ENV: "production",
    CLIENT_URL: "https://client.example",
    OPENAI_API_KEY: "x",
    PINECONE_API_KEY: "x",
    PINECONE_INDEX: "x",
    CLOUDINARY_CLOUD_NAME: "x",
    CLOUDINARY_UPLOAD_PRESET: "x",
    CLOUDINARY_API_KEY: "x",
    CLOUDINARY_API_SECRET: "x",
    FIRECRAWL_API_KEY: "x",
    INNGEST_EVENT_KEY: "x",
    INNGEST_SIGNING_KEY: "x",
  };
  expect(readServerConfig(production).production).toBe(true);
  expect(readServerConfig({ ...production, AI_PROVIDER: "gemini", OPENAI_API_KEY: undefined, GEMINI_API_KEY: "x" }).production).toBe(true);
  expect(() =>
    readServerConfig({ ...production, INNGEST_DEV: "true" }),
  ).toThrow("INNGEST_DEV");
});

test("AI provider configuration requires only the selected key", () => {
  const base = {
    DATABASE_URL: "test",
    BETTER_AUTH_URL: "http://localhost:8080",
    BETTER_AUTH_SECRET: "sensitive",
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "test",
  };
  expect(() => readServerConfig({ ...base, OPENAI_API_KEY: "openai-test" })).not.toThrow();
  expect(() => readServerConfig({ ...base, AI_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-test" })).not.toThrow();
  expect(() => readServerConfig({ ...base, AI_PROVIDER: "gemini" })).toThrow("GEMINI_API_KEY");
  expect(() => readServerConfig({ ...base, AI_PROVIDER: "openai" })).toThrow("OPENAI_API_KEY");
  expect(() => readServerConfig({ ...base, AI_PROVIDER: "other" })).toThrow("AI_PROVIDER");
});

test("Gemini validates explicit models and maps old workspace preferences", async () => {
  const previous = process.env.AI_PROVIDER;
  try {
    process.env.AI_PROVIDER = "gemini";
    expect(resolveChatModel("gpt-4o-mini")).toBe("gemini-2.5-flash-lite");
    expect(() => resolveChatModel("gpt-4o", true)).toThrow();
    expect(createWorkspaceSchema.safeParse({ title: "Test", defaultModel: "gpt-4o" }).success).toBe(false);
    await expect(parseChatBody({ messages: [message], model: "gpt-4o" })).rejects.toThrow();
    expect(createWorkspaceSchema.safeParse({ title: "Test", defaultModel: "gemini-2.5-flash-lite" }).success).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  }
});

// Install before application imports: dotenv must never load real service settings in tests.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://test:test@127.0.0.1:1/tsumugu_test";
process.env.BETTER_AUTH_URL = "http://localhost:8080";
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-with-at-least-thirty-two-characters";
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
for (const key of [
  "OPENAI_API_KEY",
  "MEM0_API_KEY",
  "TAVILY_API_KEY",
  "PINECONE_API_KEY",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "FIRECRAWL_API_KEY",
]) {
  process.env[key] = "test-stub-only";
}
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(`Unstubbed external call blocked: ${url.hostname}`);
    }
    return originalFetch(input, init);
  },
  { preconnect: originalFetch.preconnect },
);

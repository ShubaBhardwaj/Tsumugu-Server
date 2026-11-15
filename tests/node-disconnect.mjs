// Exercise real Node HTTP cancellation; Bun's node:http polyfill does not emit all socket-close events.
import assert from "node:assert/strict";
import { request } from "node:http";
import { MockLanguageModelV4 } from "ai/test";
import { createApp } from "../dist/app.js";
import prisma from "../dist/lib/db.js";
import { sessionProvider } from "../dist/middleware/require-auth.middleware.js";
import { chatModelProvider } from "../dist/services/chat.services.js";
import { sourceProviders } from "../dist/lib/source-providers.js";
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.match(url.pathname, /^\/tsumugu_test/);
process.env.MEM0_API_KEY = "";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = new URL(
    typeof input === "string" ? input : (input.url ?? input.href),
  );
  assert.ok(
    ["127.0.0.1", "localhost"].includes(u.hostname),
    "External fetch blocked",
  );
  return nativeFetch(input, init);
};
sourceProviders.embedTexts = async () => [[0.1]];
sourceProviders.queryWorkspaceVectors = async () => [];
sessionProvider.get = async () => ({ user: { id: "alice" } });
let stopped;
const cancelled = new Promise((resolve) => {
  stopped = resolve;
});
chatModelProvider.get = () =>
  new MockLanguageModelV4({
    doStream: async (options) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "text" });
          controller.enqueue({
            type: "text-delta",
            id: "text",
            delta: "Partial",
          });
          const stop = () => {
            stopped();
            try {
              controller.close();
            } catch {}
          };
          if (options.abortSignal?.aborted) stop();
          else
            options.abortSignal?.addEventListener("abort", stop, {
              once: true,
            });
        },
        cancel() {
          stopped();
        },
      }),
    }),
  });
let server;
let timeout;
try {
  const workspace = await prisma.workspace.create({
    data: { title: "Disconnect fixture", userId: "alice" },
  });
  const before = await prisma.message.count({ where: { role: "ASSISTANT" } });
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const target = `http://127.0.0.1:${server.address().port}/api/workspaces/${workspace.id}/chat`;
  await new Promise((resolve, reject) => {
    const req = request(
      target,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (response) =>
        response.once("data", () => {
          req.destroy();
          resolve();
        }),
    );
    req.on("error", (error) => {
      if (error.code !== "ECONNRESET") reject(error);
    });
    req.end(
      JSON.stringify({
        messages: [
          {
            id: "u",
            role: "user",
            parts: [{ type: "text", text: "Question" }],
          },
        ],
      }),
    );
  });
  await Promise.race([
    cancelled,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(Error("Generation did not abort")),
        2000,
      );
    }),
  ]);
  assert.equal(
    await prisma.message.count({ where: { role: "ASSISTANT" } }),
    before,
  );
  console.log("Node disconnect verified");
} finally {
  clearTimeout(timeout);
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
}

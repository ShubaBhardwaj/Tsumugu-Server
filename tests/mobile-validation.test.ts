import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { auth } from "../src/lib/auth";
import { canonicalSourceUrl, sha256, urlContentRevision } from "../src/lib/source-identity";
import { idempotencyKey, parseIfMatch, uploadPdfSchema } from "../src/validators/mobile.validator";
import { importWebsiteSchema } from "../src/validators/source.validator";
import { createArtifactSchema } from "../src/validators/artifact.validator";
import { buildChatSystemPrompt } from "../src/lib/rag/retrieve";
import { generateArtifactContent, validateArtifactContent } from "../src/services/artifact-generation.services";
import { aiProvider } from "../src/lib/ai-provider";
import { uploadPdfToCloudinary } from "../src/lib/cloudinary";

afterEach(() => mock.restore());
test("Expo plugin loads alongside Google only with explicit native/browser trust", async () => {
  expect(auth.options.plugins?.map(plugin => plugin.id)).toContain("expo");
  expect(Object.keys(auth.options.socialProviders!)).toEqual(["google"]);
  expect(auth.options.emailAndPassword?.enabled).not.toBe(true);
  const context = await auth.$context;
  for (const allowed of ["tsumugu://", "tsumugu://auth/callback", "http://localhost:3001/home"])
    expect(context.isTrustedOrigin(allowed)).toBe(true);
  for (const denied of ["evil://auth", "https://evil.invalid", "exp://192.168.1.1:8081", "tsumugu-evil://auth", "https://localhost:3001.evil.invalid"])
    expect(context.isTrustedOrigin(denied)).toBe(false);
  for (const callbackURL of ["evil://auth", "https://evil.invalid"]){
    const result = await auth.handler(new Request("http://localhost:8080/api/auth/sign-in/social", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3001" },
      body: JSON.stringify({ provider: "google", callbackURL }),
    }));
    expect(result.status).toBe(403);
  }
});

test("URL fingerprint fixtures match mobile canonicalization, including aliases", () => {
  expect(canonicalSourceUrl(" HTTPS://Example.com:443/a?b=2&a=1#part ", "WEBSITE")).toBe("https://example.com/a?b=2&a=1#part");
  expect(urlContentRevision("WEBSITE", "https://example.com")).toBe(sha256("WEBSITE\nhttps://example.com/\n0"));
  const aliases = ["https://youtu.be/12345678901?t=4", "https://www.youtube.com/watch?v=12345678901&x=1", "https://m.youtube.com/shorts/12345678901", "https://youtube.com/embed/12345678901"];
  for (const url of aliases) expect(urlContentRevision("YOUTUBE", url)).toBe(sha256("YOUTUBE\nyoutube:12345678901\n0"));
  expect(urlContentRevision("WEBSITE", "https://example.com", 1)).not.toBe(urlContentRevision("WEBSITE", "https://example.com"));
  for (const url of ["https://notyoutube.com/watch?v=12345678901", "https://youtube.com.evil.invalid/watch?v=12345678901", "https://youtu.be/12345678901/extra", "ftp://youtu.be/12345678901", "https://u:p@youtube.com/watch?v=12345678901"])
    expect(() => canonicalSourceUrl(url, "YOUTUBE")).toThrow();
});

test("mobile metadata pairs, operation keys and revision guards reject malformed input", () => {
  expect(uploadPdfSchema.parse({ title: "Legacy" })).toEqual({ title: "Legacy" });
  expect(importWebsiteSchema.parse({ url: "https://example.com" })).toEqual({ url: "https://example.com" });
  for (const input of [{ clientItemKey: "document:one" }, { contentRevision: "f".repeat(64) }, { recreateDeleted: true }, { refreshGeneration: 1 }, { clientItemKey: "document:one", contentRevision: "F".repeat(64) }])
    expect(() => uploadPdfSchema.parse(input)).toThrow();
  expect(() => idempotencyKey(undefined, true)).toThrow();
  expect(() => idempotencyKey("spaces not allowed", true)).toThrow();
  expect(() => idempotencyKey("key", false)).toThrow();
  expect(parseIfMatch(`"${"f".repeat(64)}"`)).toBe("f".repeat(64));
  expect(() => parseIfMatch("*")).toThrow();
});

test("artifact option matrix accepts supported combinations and rejects extras", () => {
  for (const [type, options] of [["FLASHCARDS", { topic: " Cells ", count: 20, difficulty: "hard" }], ["QUIZ", { count: 5 }], ["SUMMARY", { detail: "detailed" }], ["TAKEAWAYS", { detail: "concise" }], ["MINDMAP", { topic: "Cells" }], ["REPORT", {}]])
    expect(createArtifactSchema.parse({ type, options }).options).toBeDefined();
  for (const [type, options] of [["QUIZ", { count: 20 }], ["FLASHCARDS", { count: 5 }], ["REPORT", { detail: "detailed" }], ["SUMMARY", { difficulty: "easy" }], ["MINDMAP", { count: 10 }], ["SUMMARY", { topic: " " }], ["QUIZ", { webSearch: true }]])
    expect(() => createArtifactSchema.parse({ type, options })).toThrow();
  expect(createArtifactSchema.parse({ type: "QUIZ" }).options).toBeUndefined();
  expect(() => validateArtifactContent("FLASHCARDS", { cards: Array.from({ length: 3 }, () => ({ front: "q", back: "a" })) }, { count: 10 })).toThrow("exactly 10");
});

test("empty collection prompt forbids general-knowledge fallback and account memories", () => {
  const prompt = buildChatSystemPrompt({ chunks: [], userMemories: ["OTHER COLLECTION SECRET"] });
  expect(prompt).toContain("Tsumugu");
  expect(prompt).toContain("insufficient");
  expect(prompt).toContain("untrusted data");
  expect(prompt).not.toContain("OTHER COLLECTION SECRET");
  expect(prompt).not.toContain("Answer helpfully from general knowledge");
});

test("unsupported artifact topic fails before generating invented content", async () => {
  spyOn(aiProvider, "generateText").mockResolvedValue({ output: { supported: false } } as any);
  await expect(generateArtifactContent("SUMMARY", "Cells have membranes", { topic: "Operating system scheduling" })).rejects.toThrow("do not support this topic");
  expect(aiProvider.generateText).toHaveBeenCalledTimes(1);
  const call = (aiProvider.generateText as any).mock.calls[0][0];
  expect(call.system).toContain("Do not use outside knowledge");
  expect(call.prompt).toContain("untrustedSourceText");
});

test("signed mobile PDF upload uses the exact persisted target without unsigned preset", async () => {
  // The helper reads configuration at module load; tests/setup supplies only safe placeholder keys.
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const form = init!.body as FormData;
    expect(form.get("public_id")).toBe("tsumugu/mobile/operation.pdf");
    expect(form.get("overwrite")).toBe("false");
    expect(form.get("signature")).toBeTruthy();
    expect(form.get("upload_preset")).toBeNull();
    return new Response(JSON.stringify({ public_id: "tsumugu/mobile/operation.pdf", secure_url: "https://test.invalid/operation.pdf", bytes: 10, resource_type: "raw" }), { status: 200 });
  });
  const result = await uploadPdfToCloudinary(Buffer.from("%PDF-stub"), "notes.pdf", "tsumugu/mobile/operation.pdf");
  expect(result.publicId).toBe("tsumugu/mobile/operation.pdf");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

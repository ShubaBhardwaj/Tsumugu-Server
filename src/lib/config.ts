import "dotenv/config";
import { configuredGeminiChatModel, selectedAiProvider } from "./ai-provider.js";
export function readServerConfig(env: NodeJS.ProcessEnv = process.env) {
  const aiProvider = selectedAiProvider(env);
  if (aiProvider === "gemini") configuredGeminiChatModel(env);
  const production = env.NODE_ENV === "production";
  const clientUrl =
    env.CLIENT_URL || (production ? "" : "http://localhost:3001");
  const required = [
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    aiProvider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY",
  ];
  if (production)
    required.push(
      "CLIENT_URL",
      "PINECONE_API_KEY",
      "PINECONE_INDEX",
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_UPLOAD_PRESET",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
      "FIRECRAWL_API_KEY",
      "INNGEST_EVENT_KEY",
      "INNGEST_SIGNING_KEY",
    );
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length)
    throw new Error(`Missing server settings: ${missing.join(", ")}`);
  if (
    production &&
    ["true", "1"].includes(env.INNGEST_DEV?.toLowerCase() ?? "")
  )
    throw new Error("INNGEST_DEV cannot be enabled in production");
  for (const [name, value] of [
    ["CLIENT_URL", clientUrl],
    ["BETTER_AUTH_URL", env.BETTER_AUTH_URL!],
  ]) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid URL setting: ${name}`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (name === "CLIENT_URL" && value !== url.origin)
    )
      throw new Error(`Invalid URL setting: ${name}`);
  }
  return {
    clientUrl,
    authUrl: env.BETTER_AUTH_URL!,
    production,
    port: Number(env.PORT || 8080),
  };
}
export function frontendOrigin(env: NodeJS.ProcessEnv = process.env) {
  return env.CLIENT_URL || "http://localhost:3001";
}

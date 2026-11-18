import { AppError } from "../types/app-error.js";

export function safeAiError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof value.statusCode === "number" ? value.statusCode : value.status;
  const message = typeof value.message === "string" ? value.message : "";
  if (status === 401 || status === 403 ||
      (status === 400 && /API_KEY_INVALID|API key not valid|invalid API key/i.test(message)))
    return new AppError(503, "AI provider credentials are invalid or lack access.", undefined, "AI_PROVIDER_AUTH");
  if (status === 429)
    return new AppError(429, "AI provider rate or quota limit reached. Retry later.", undefined, "AI_PROVIDER_QUOTA", 60);
  return new AppError(503, "AI provider is temporarily unavailable. Retry later.", undefined, "AI_PROVIDER_UNAVAILABLE");
}

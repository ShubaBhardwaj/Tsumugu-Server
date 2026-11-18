import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import {
  CHAT_MODEL,
  CHAT_MODELS,
  GEMINI_CHAT_MODEL,
  GEMINI_CHAT_MODELS,
} from "./ai-config.js";
import { ValidationError } from "../types/app-error.js";
import { safeAiError } from "./ai-errors.js";

const safeGenerateText = (async (options: Parameters<typeof generateText>[0]) => {
  try {
    return await generateText(options);
  } catch (error) {
    throw safeAiError(error);
  }
}) as typeof generateText;
export const aiProvider = { generateText: safeGenerateText, streamText };

export type AiProviderName = "openai" | "gemini";

export function selectedAiProvider(env: NodeJS.ProcessEnv = process.env): AiProviderName {
  const value = env.AI_PROVIDER?.trim().toLowerCase() || "openai";
  if (value !== "openai" && value !== "gemini")
    throw new Error("Invalid AI_PROVIDER setting: expected openai or gemini");
  return value;
}

export function defaultChatModel() {
  return selectedAiProvider() === "gemini" ? GEMINI_CHAT_MODEL : CHAT_MODEL;
}

export function supportedChatModels(): readonly string[] {
  return selectedAiProvider() === "gemini" ? GEMINI_CHAT_MODELS : CHAT_MODELS;
}

export function isSupportedChatModel(model: string): boolean {
  return supportedChatModels().includes(model);
}

export function resolveChatModel(requested: string, explicit = false): string {
  if (isSupportedChatModel(requested)) return requested;
  if (explicit)
    throw new ValidationError("Model is not available for the selected AI provider");
  return defaultChatModel();
}

export function languageModel(model = defaultChatModel()) {
  if (selectedAiProvider() === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    return createGoogle({ apiKey })(model);
  }
  return openai(model);
}

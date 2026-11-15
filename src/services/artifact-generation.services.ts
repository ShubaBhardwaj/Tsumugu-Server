import { Output } from "ai";
import { aiProvider } from "../lib/ai-provider.js";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { CHAT_MODEL } from "../lib/ai-config.js";
import { findSourcesByWorkspaceId } from "../repository/source.repository.js";
import type { ArtifactRecord } from "../repository/artifact.repository.js";
import { ValidationError } from "../types/app-error.js";

const MAX_CONTEXT_CHARS = 120_000;

const flashcardsSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().trim().min(1),
        back: z.string().trim().min(1),
      }),
    )
    .min(3)
    .max(30),
});

const quizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        options: z.array(z.string().trim().min(1)).min(2).max(5),
        correctIndex: z.number().int().min(0),
        explanation: z.string().trim().min(1),
      }),
    )
    .min(3)
    .max(15),
});

const mindmapSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        label: z.string().trim().min(1),
      }),
    )
    .min(2)
    .max(40),
  edges: z.array(
    z.object({
      id: z.string().trim().min(1),
      source: z.string().trim().min(1),
      target: z.string().trim().min(1),
    }),
  ),
});

const takeawaysSchema = z.object({
  items: z.array(z.string().trim().min(1)).min(3).max(20),
});

const reportSchema = z.object({
  markdown: z.string().trim().min(1),
  sections: z.array(
    z.object({
      title: z.string().trim().min(1),
      content: z.string().trim().min(1),
    }),
  ),
});

/**
 * Collects and concatenates text from READY workspace sources for artifact generation.
 *
 * @param workspaceId - Workspace whose sources to read
 * @param sourceIds - Optional subset of source ids; defaults to all READY sources
 * @returns Combined source text (max 120k chars) and the ids actually used
 * @throws {ValidationError} When no ready sources exist or none have extracted content
 *
 * @example
 *
 */
export async function gatherSourceContext(
  workspaceId: string,
  sourceIds?: string[],
) {
  const sources = await findSourcesByWorkspaceId(workspaceId, {
    status: "READY",
  });

  const ids = sourceIds === undefined ? undefined : [...new Set(sourceIds)];
  const selected = ids
    ? ids.map((id) => sources.find((s) => s.id === id))
    : sources.filter((s) => s.content?.trim());
  if (!selected.length || selected.some((s) => !s || !s.content?.trim()))
    throw new ValidationError(
      "Select ready sources with usable text from this workspace",
    );
  let text = "";
  const used: string[] = [];
  const truncatedSources: string[] = [];
  for (const source of selected) {
    if (!source) continue;
    const header = `# ${source.title}\n\n`;
    const available = MAX_CONTEXT_CHARS - text.length - header.length;
    if (available <= 0) break;
    const content = source.content!.trim();
    const part = content.slice(0, available);
    if (!part) continue;
    text += header + part;
    used.push(source.id);
    if (part.length < content.length) truncatedSources.push(source.id);
  }
  if (!used.length)
    throw new ValidationError("Selected sources have no usable text");
  return {
    text,
    selectedSourceIds: selected.filter((s) => !!s).map((s) => s!.id),
    sourceIds: used,
    truncatedSources,
    truncated: used.length !== selected.length || truncatedSources.length > 0,
  };
}

/**
 * Generates structured or markdown content for a learning artifact using the AI SDK.
 *
 * @param type - Artifact type (`SUMMARY`, `QUIZ`, `FLASHCARDS`, etc.)
 * @param sourceText - Combined source material from {@link gatherSourceContext}
 * @returns Type-specific JSON content stored on the artifact row
 * @throws {ValidationError} When the artifact type is unsupported
 *
 *
 *
 */
export async function generateArtifactContent(
  type: ArtifactRecord["type"],
  sourceText: string,
) {
  const system = [
    `You are Chaibook, an expert learning assistant generating a ${type.toLowerCase()} from workspace source materials.`,
    "Use ONLY the provided source content. Do not invent facts not supported by the sources.",
    "Be clear, educational, and well-structured.",
  ].join("\n");

  switch (type) {
    case "SUMMARY": {
      const result = await aiProvider.generateText({
        model: openai(CHAT_MODEL),
        abortSignal: AbortSignal.timeout(30000),
        maxRetries: 0,
        system,
        prompt: `Write a comprehensive markdown summary of the following sources:\n\n${sourceText}`,
      });
      return { markdown: result.text };
    }
    case "TAKEAWAYS": {
      const result = await aiProvider.generateText({
        model: openai(CHAT_MODEL),
        abortSignal: AbortSignal.timeout(30000),
        maxRetries: 0,
        system,
        output: Output.object({ schema: takeawaysSchema }),
        prompt: `Extract the most important key takeaways as concise bullet points from:\n\n${sourceText}`,
      });
      return result.output;
    }
    case "FLASHCARDS": {
      const result = await aiProvider.generateText({
        model: openai(CHAT_MODEL),
        abortSignal: AbortSignal.timeout(30000),
        maxRetries: 0,
        system,
        output: Output.object({ schema: flashcardsSchema }),
        prompt: `Create study flashcards (front/back) covering the main concepts from:\n\n${sourceText}`,
      });
      return result.output;
    }
    case "QUIZ": {
      const result = await aiProvider.generateText({
        model: openai(CHAT_MODEL),
        abortSignal: AbortSignal.timeout(30000),
        maxRetries: 0,
        system,
        output: Output.object({ schema: quizSchema }),
        prompt: `Create a multiple-choice quiz with explanations from:\n\n${sourceText}`,
      });
      return result.output;
    }
    case "MINDMAP": {
      const result = await aiProvider.generateText({
        model: openai(CHAT_MODEL),
        abortSignal: AbortSignal.timeout(30000),
        maxRetries: 0,
        system,
        output: Output.object({ schema: mindmapSchema }),
        prompt: `Create a mind map as nodes and edges. Use a central topic node and branch out logically from:\n\n${sourceText}`,
      });
      return result.output;
    }
    case "REPORT": {
      const result = await aiProvider.generateText({
        model: openai(CHAT_MODEL),
        abortSignal: AbortSignal.timeout(30000),
        maxRetries: 0,
        system,
        output: Output.object({ schema: reportSchema }),
        prompt: `Write a structured long-form report with sections and a full markdown version from:\n\n${sourceText}`,
      });
      return result.output;
    }
    default:
      throw new ValidationError(`Unsupported artifact type: ${type}`);
  }
}

export function validateArtifactContent(
  type: ArtifactRecord["type"],
  content: unknown,
) {
  const schemas = {
    SUMMARY: z.object({ markdown: z.string().trim().min(1) }),
    TAKEAWAYS: takeawaysSchema,
    FLASHCARDS: flashcardsSchema,
    QUIZ: quizSchema,
    MINDMAP: mindmapSchema,
    REPORT: reportSchema,
  };
  const value = schemas[type].parse(content);
  if (type === "QUIZ") {
    for (const question of (value as z.infer<typeof quizSchema>).questions) {
      if (question.correctIndex >= question.options.length)
        throw new ValidationError(
          "Quiz answer must refer to an existing option",
        );
    }
  }
  if (type === "MINDMAP") {
    const map = value as z.infer<typeof mindmapSchema>;
    const ids = new Set(map.nodes.map((n) => n.id));
    if (
      ids.size !== map.nodes.length ||
      new Set(map.edges.map((e) => e.id)).size !== map.edges.length ||
      map.edges.some((e) => !ids.has(e.source) || !ids.has(e.target))
    )
      throw new ValidationError(
        "Mind map connections must refer to unique existing nodes",
      );
  }
  return value;
}
export const artifactGenerator = { generate: generateArtifactContent };

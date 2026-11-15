import { z } from "zod";
import { workspaceIdParamSchema } from "./workspace.validator.js";

export const artifactTypes = [
  "SUMMARY",
  "TAKEAWAYS",
  "FLASHCARDS",
  "QUIZ",
  "MINDMAP",
  "REPORT",
] as const;

export const artifactIdParamSchema = workspaceIdParamSchema.extend({
  artifactId: z.string().trim().min(1, "Artifact id is required"),
});

export const artifactOptionsSchema = z
  .object({
    topic: z.string().trim().min(1).max(200).optional(),
    count: z.number().int().optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    detail: z.enum(["concise", "detailed"]).optional(),
  })
  .strict();
export type ArtifactOptions = z.infer<typeof artifactOptionsSchema>;

export const createArtifactSchema = z
  .object({
    type: z.enum(artifactTypes),
    title: z.string().trim().min(1).max(120).optional(),
    sourceIds: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    options: artifactOptionsSchema.optional(),
  })
  .superRefine(({ type, options }, ctx) => {
    if (!options) return;
    const counts =
      type === "FLASHCARDS" ? [10, 20, 30] : type === "QUIZ" ? [5, 10, 15] : [];
    if (options.count !== undefined && !counts.includes(options.count))
      ctx.addIssue({
        code: "custom",
        path: ["options", "count"],
        message: "Count is unsupported for this artifact type",
      });
    if (
      options.difficulty !== undefined &&
      !["FLASHCARDS", "QUIZ"].includes(type)
    )
      ctx.addIssue({
        code: "custom",
        path: ["options", "difficulty"],
        message: "Difficulty is supported only for flashcards and quizzes",
      });
    if (
      options.detail !== undefined &&
      !["SUMMARY", "TAKEAWAYS"].includes(type)
    )
      ctx.addIssue({
        code: "custom",
        path: ["options", "detail"],
        message: "Detail is supported only for summaries and takeaways",
      });
  });

export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;

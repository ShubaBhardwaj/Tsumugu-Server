import { z } from "zod";
import { isSupportedChatModel } from "../lib/ai-provider.js";

export const createWorkspaceSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(8).optional(),
  defaultModel: z.string().refine(isSupportedChatModel, "Model is not available for the selected AI provider").optional(),
  clientCollectionKey: z.uuid().optional(),
});

export const updateWorkspaceSchema = createWorkspaceSchema
  .omit({ clientCollectionKey: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

export const workspaceIdParamSchema = z.object({
  workspaceId: z.string().trim().min(1),
});

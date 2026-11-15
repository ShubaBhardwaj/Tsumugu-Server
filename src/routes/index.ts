import { chatRoutes, conversationRoutes } from "./chat.routes.js";
import { artifactRoutes } from "./artifact.routes.js";
import { jobRoutes } from "./job.routes.js";
import type { Express } from "express";
import { memoryRoutes } from "./memory.routes.js";
import { sourceRoutes } from "./source.routes.js";
import { workspaceRoutes } from "./workspace.routes.js";

export function registerRoutes(app: Express): void {
  workspaceRoutes.use("/:workspaceId/sources", sourceRoutes);
  workspaceRoutes.use("/:workspaceId/chat", chatRoutes);
  workspaceRoutes.use("/:workspaceId/conversations", conversationRoutes);
  workspaceRoutes.use("/:workspaceId/artifacts", artifactRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/workspaces", workspaceRoutes);
  app.use("/api/memory", memoryRoutes);
}

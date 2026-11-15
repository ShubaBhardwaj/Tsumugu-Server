import type { Request, Response } from "express";
import {
  artifactIdParamSchema,
  createArtifactSchema,
} from "../validators/artifact.validator.js";
import { workspaceIdParamSchema } from "../validators/workspace.validator.js";
import {
  listArtifactsForWorkspace,
  getArtifactForWorkspace,
  createArtifactForWorkspace,
  deleteArtifactForWorkspace,
  retryArtifact,
} from "../services/artifact.services.js";
export async function listArtifacts(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);
  res.json(await listArtifactsForWorkspace(workspaceId, req.session.user.id));
}
export async function getArtifact(req: Request, res: Response) {
  const { workspaceId, artifactId } = artifactIdParamSchema.parse(req.params);
  res.json(
    await getArtifactForWorkspace(workspaceId, artifactId, req.session.user.id),
  );
}
export async function createArtifact(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);
  const input = createArtifactSchema.parse(req.body);
  res
    .status(202)
    .json(
      await createArtifactForWorkspace(workspaceId, req.session.user.id, input),
    );
}
export async function deleteArtifact(req: Request, res: Response) {
  const { workspaceId, artifactId } = artifactIdParamSchema.parse(req.params);
  await deleteArtifactForWorkspace(
    workspaceId,
    artifactId,
    req.session.user.id,
  );
  res.status(204).send();
}
export async function retryArtifactGeneration(req: Request, res: Response) {
  const { workspaceId, artifactId } = artifactIdParamSchema.parse(req.params);
  res
    .status(202)
    .json(await retryArtifact(workspaceId, artifactId, req.session.user.id));
}

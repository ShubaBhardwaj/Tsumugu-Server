import type { Request, Response } from "express";
import { ValidationError } from "../types/app-error.js";
import { getZodFieldErrors } from "../utils/zod-error.js";
import {
  bulkDeleteSourcesSchema,
  createSourceSchema,
  importWebsiteSchema,
  importYoutubeSchema,
  listSourcesQuerySchema,
  sourceIdParamSchema,
} from "../validators/source.validator.js";
import { workspaceIdParamSchema } from "../validators/workspace.validator.js";
import {
  idempotencyKey,
  parseIfMatch,
  replaceContentSchema,
  uploadPdfSchema,
} from "../validators/mobile.validator.js";
import {
  getMobileBindings,
  getMobileReplacementType,
  submitMobileSource,
} from "../services/mobile-source.services.js";
import {
  bulkDeleteSourcesForWorkspace,
  createTextOrMarkdownSource,
  deleteSourceForWorkspace,
  getSourceForWorkspace,
  importWebsiteSource,
  importYoutubeSource,
  listSourcesForWorkspace,
  uploadPdfSource,
} from "../services/source.services.js";

function parseWorkspaceId(params: Request["params"]) {
  const parsed = workspaceIdParamSchema.safeParse(params);

  if (!parsed.success) {
    throw new ValidationError(
      "Invalid workspace id",
      getZodFieldErrors(parsed.error),
    );
  }

  return parsed.data;
}

function parseSourceParams(params: Request["params"]) {
  const parsed = sourceIdParamSchema.safeParse(params);

  if (!parsed.success) {
    throw new ValidationError(
      "Invalid source id",
      getZodFieldErrors(parsed.error),
    );
  }

  return parsed.data;
}

function parseListQuery(query: Request["query"]) {
  const parsed = listSourcesQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw new ValidationError(
      "Invalid query parameters",
      getZodFieldErrors(parsed.error),
    );
  }

  return parsed.data;
}

function parseCreateBody(body: unknown) {
  const parsed = createSourceSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError(
      "Validation failed",
      getZodFieldErrors(parsed.error),
    );
  }

  return parsed.data;
}

function parseBulkDeleteBody(body: unknown) {
  const parsed = bulkDeleteSourcesSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError(
      "Validation failed",
      getZodFieldErrors(parsed.error),
    );
  }

  return parsed.data;
}

export async function listSources(req: Request, res: Response) {
  const { workspaceId } = parseWorkspaceId(req.params);
  const filters = parseListQuery(req.query);
  const sources = await listSourcesForWorkspace(
    workspaceId,
    req.session.user.id,
    filters,
  );
  res.json(sources);
}

export async function getSource(req: Request, res: Response) {
  const { workspaceId, sourceId } = parseSourceParams(req.params);
  const source = await getSourceForWorkspace(
    workspaceId,
    sourceId,
    req.session.user.id,
  );
  res.json(source);
}

export async function createSource(req: Request, res: Response) {
  const { workspaceId } = parseWorkspaceId(req.params);
  const input = parseCreateBody(req.body);
  const source = await createTextOrMarkdownSource(
    workspaceId,
    req.session.user.id,
    input,
  );
  res.status(201).json(source);
}

export async function deleteSource(req: Request, res: Response) {
  const { workspaceId, sourceId } = parseSourceParams(req.params);
  await deleteSourceForWorkspace(
    workspaceId,
    sourceId,
    req.session.user.id,
    parseIfMatch(req.get("If-Match")),
  );
  res.status(204).send();
}

export async function bulkDeleteSources(req: Request, res: Response) {
  const { workspaceId } = parseWorkspaceId(req.params);
  const input = parseBulkDeleteBody(req.body);
  await bulkDeleteSourcesForWorkspace(
    workspaceId,
    req.session.user.id,
    input.sourceIds,
    input.expectedRevisions,
  );
  res.status(204).send();
}

export async function uploadPdf(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);

  if (!req.file) {
    throw new ValidationError("PDF file is required");
  }

  const input = uploadPdfSchema.parse(req.body);
  const key = idempotencyKey(req.get("Idempotency-Key"), !!input.clientItemKey);
  if (key) {
    const result = await submitMobileSource(workspaceId, req.session.user.id, {
      ...input,
      clientItemKey: input.clientItemKey!,
      contentRevision: input.contentRevision!,
      type: "PDF",
      file: req.file,
      idempotencyKey: key,
    });
    res.status(result.status).json(result.body);
    return;
  }
  const title = input.title;

  const source = await uploadPdfSource(
    workspaceId,
    req.session.user.id,
    req.file,
    title,
  );

  res.status(201).json(source);
}

export async function importWebsite(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);
  const input = importWebsiteSchema.parse(req.body);
  const key = idempotencyKey(req.get("Idempotency-Key"), !!input.clientItemKey);
  if (key) {
    const result = await submitMobileSource(workspaceId, req.session.user.id, {
      ...input,
      clientItemKey: input.clientItemKey!,
      contentRevision: input.contentRevision!,
      type: "WEBSITE",
      idempotencyKey: key,
    });
    res.status(result.status).json(result.body);
    return;
  }
  const source = await importWebsiteSource(
    workspaceId,
    req.session.user.id,
    input,
  );
  res.status(201).json(source);
}

export async function importYoutube(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);
  const input = importYoutubeSchema.parse(req.body);
  const key = idempotencyKey(req.get("Idempotency-Key"), !!input.clientItemKey);
  if (key) {
    const result = await submitMobileSource(workspaceId, req.session.user.id, {
      ...input,
      clientItemKey: input.clientItemKey!,
      contentRevision: input.contentRevision!,
      type: "YOUTUBE",
      idempotencyKey: key,
    });
    res.status(result.status).json(result.body);
    return;
  }
  const source = await importYoutubeSource(
    workspaceId,
    req.session.user.id,
    input,
  );
  res.status(201).json(source);
}

export async function mobileBindings(req: Request, res: Response) {
  const { workspaceId } = parseWorkspaceId(req.params);
  res.json(await getMobileBindings(workspaceId, req.session.user.id));
}

export async function replaceContent(req: Request, res: Response) {
  const { workspaceId, sourceId } = parseSourceParams(req.params);
  const input = replaceContentSchema.parse(req.body);
  const key = idempotencyKey(req.get("Idempotency-Key"), true)!;
  const type = await getMobileReplacementType(
    workspaceId,
    sourceId,
    req.session.user.id,
  );
  if (!["PDF", "WEBSITE", "YOUTUBE"].includes(type))
    throw new ValidationError(
      "Only mobile PDF/URL sources support content replacement",
    );
  const result = await submitMobileSource(workspaceId, req.session.user.id, {
    ...input,
    sourceId,
    type: type as "PDF" | "WEBSITE" | "YOUTUBE",
    file: req.file,
    idempotencyKey: key,
  });
  res.status(result.status).json(result.body);
}

import { randomUUID } from "node:crypto";
import prisma from "../lib/db.js";
import type { ClientSubmission, Prisma } from "../generated/prisma/client.js";
import {
  canonicalSourceUrl,
  sha256,
  urlContentRevision,
} from "../lib/source-identity.js";
import { sourceProviders } from "../lib/source-providers.js";
import { sourceNeedsReindex } from "../lib/embedding-profile.js";
import {
  createJob,
  workspaceTransaction,
  type Transaction,
} from "../repository/job.repository.js";
import {
  listMobileBindings,
  lockSubmission,
} from "../repository/mobile.repository.js";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "../types/app-error.js";
import { kickJob } from "./job.services.js";
import { getWorkspaceByIdForUser } from "./workspace.services.js";

const SUBMISSION_MS = 120_000;
type Json = Prisma.InputJsonValue;
type SourceType = "PDF" | "WEBSITE" | "YOUTUBE";
export type MobileSubmissionInput = {
  type: SourceType;
  clientItemKey: string;
  contentRevision: string;
  idempotencyKey: string;
  title?: string;
  file?: Express.Multer.File;
  url?: string;
  refreshGeneration?: number;
  recreateDeleted?: boolean;
  sourceId?: string;
  expectedRevision?: string;
};
const conflict = (code: string, message: string) =>
  new AppError(409, message, undefined, code);
const deleted = () =>
  new AppError(
    410,
    "The submitted resource was deleted. Review before recreating it.",
    undefined,
    "RESOURCE_DELETED",
  );
const inProgress = () =>
  new AppError(
    409,
    "This item has a submission in progress. Retry after reconciliation.",
    undefined,
    "REQUEST_IN_PROGRESS",
    5,
  );

async function ownedWorkspace(
  tx: Transaction,
  workspaceId: string,
  ownerId: string,
) {
  const workspace = await tx.workspace.findFirst({
    where: { id: workspaceId, userId: ownerId },
  });
  if (!workspace) throw new NotFoundError("Workspace not found");
  if (workspace.deletedAt) throw deleted();
}
const sourceResponse = (
  source: object,
  binding: { clientItemKey: string; contentRevision: string },
) => ({
  ...source,
  needsReindex: sourceNeedsReindex(source as { status: string; metadata: unknown }),
  clientItemKey: binding.clientItemKey,
  contentRevision: binding.contentRevision,
});

export async function getMobileBindings(workspaceId: string, ownerId: string) {
  await getWorkspaceByIdForUser(workspaceId, ownerId);
  return listMobileBindings(workspaceId);
}

export async function getMobileReplacementType(workspaceId: string, sourceId: string, ownerId: string) {
  const source = await prisma.source.findFirst({ where: { id: sourceId, workspaceId, workspace: { userId: ownerId } } });
  if (source) {
    if (source.deletedAt) throw deleted();
    return source.type;
  }
  const previous = await prisma.clientSubmission.findFirst({ where: { ownerId, workspaceId, sourceId, status: "COMMITTED" } });
  if (previous) throw deleted();
  throw new NotFoundError("Source not found");
}

async function replay(tx: Transaction, submission: ClientSubmission) {
  if (submission.status === "PENDING") throw inProgress();
  if (submission.status === "FAILED")
    throw new AppError(
      submission.responseStatus ?? 503,
      "Submission failed before acceptance. Review status and retry with a new operation key.",
      undefined,
      submission.errorCode ?? "SUBMISSION_FAILED",
    );
  const source =
    submission.sourceId &&
    (await tx.source.findFirst({
      where: {
        id: submission.sourceId,
        workspaceId: submission.workspaceId,
        deletedAt: null,
      },
    }));
  if (!source) throw deleted();
  return {
    status: submission.responseStatus!,
    body: submission.result as Record<string, unknown>,
  };
}

export async function enqueueRepresentationCleanup(
  tx: Transaction,
  data: {
    ownerId: string;
    workspaceId: string;
    resourceId: string;
    metadata: Json;
    dedupeKey: string;
    notBefore?: Date;
  },
) {
  return createJob(tx, {
    type: "REPRESENTATION_CLEANUP",
    ownerId: data.ownerId,
    workspaceId: data.workspaceId,
    resourceId: data.resourceId,
    dedupeKey: data.dedupeKey,
    payload: {
      metadata: data.metadata,
      notBefore: data.notBefore?.toISOString() ?? null,
    },
  });
}

async function failSubmission(
  tx: Transaction,
  submission: ClientSubmission,
  errorCode: string,
  status = 503,
) {
  await tx.clientSubmission.update({
    where: { id: submission.id },
    data: { status: "FAILED", errorCode, responseStatus: status },
  });
  if (submission.representationTarget)
    await enqueueRepresentationCleanup(tx, {
      ownerId: submission.ownerId,
      workspaceId: submission.workspaceId,
      resourceId: submission.id,
      metadata: {
        publicId: submission.representationTarget,
        resourceType: "raw",
      },
      dedupeKey: `submission-cleanup:${submission.id}`,
      // A timed-out transport can still settle. Retire its target after the bounded request window.
      notBefore: new Date(submission.deadline.getTime() + 30_000),
    });
}

/** Called by the existing recovery schedule. Expired operations fail visibly; bytes are never retained. */
export async function recoverClientSubmissions() {
  const expired = await prisma.clientSubmission.findMany({
    where: { status: "PENDING", deadline: { lte: new Date() } },
    take: 100,
  });
  for (const row of expired)
    await workspaceTransaction(row.workspaceId, async (tx) => {
      const current = await tx.clientSubmission.findUnique({
        where: { id: row.id },
      });
      if (current?.status === "PENDING" && current.deadline <= new Date())
        await failSubmission(tx, current, "SUBMISSION_EXPIRED");
    });
  return expired.length;
}

function validateInput(input: MobileSubmissionInput) {
  if (input.type === "PDF") {
    if (
      !input.clientItemKey.startsWith("document:") ||
      input.refreshGeneration !== undefined ||
      input.url !== undefined
    )
      throw new ValidationError(
        "PDF submissions require a document item key and PDF bytes",
      );
    const file = input.file;
    if (
      !file ||
      file.mimetype !== "application/pdf" ||
      file.buffer.length > 10 * 1024 * 1024 ||
      !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new ValidationError("Submit one PDF of at most 10 MiB");
    if (sha256(file.buffer) !== input.contentRevision)
      throw new ValidationError("contentRevision does not match the PDF bytes");
  } else {
    if (!input.clientItemKey.startsWith("link:") || !input.url || input.file)
      throw new ValidationError(
        "URL submissions require a link item key and URL",
      );
    if (
      urlContentRevision(
        input.type,
        input.url,
        input.refreshGeneration ?? 0,
      ) !== input.contentRevision
    )
      throw new ValidationError(
        "contentRevision does not match the URL fingerprint",
      );
  }
}

async function prepareContent(
  input: MobileSubmissionInput,
  target: string | null,
) {
  if (input.type === "PDF") {
    const file = input.file!;
    const upload = await sourceProviders.uploadPdfToCloudinary(
      file.buffer,
      file.originalname,
      target!,
    );
    return {
      title: input.title?.trim() || file.originalname.replace(/\.pdf$/i, ""),
      content: null,
      url: null,
      metadata: {
        fileUrl: upload.secureUrl,
        fileName: upload.originalFilename,
        fileSize: upload.bytes,
        publicId: upload.publicId,
        resourceType: upload.resourceType,
      },
    };
  }
  try {
    if (input.type === "WEBSITE") {
      const page = await sourceProviders.scrapeWebsite(input.url!);
      if (!page.markdown?.trim())
        throw new ValidationError("The website has no readable content");
      return {
        title: input.title || page.title || input.url!,
        content: page.markdown,
        url: input.url!,
        metadata: { importedFrom: page.sourceUrl },
      };
    }
    const transcript = await sourceProviders.fetchYoutubeTranscript(input.url!);
    if (!transcript.content?.trim())
      throw new ValidationError("The video has no usable transcript");
    return {
      title: input.title || `YouTube: ${transcript.videoId}`,
      content: transcript.content,
      url: input.url!,
      metadata: { videoId: transcript.videoId },
    };
  } catch (error) {
    if (error instanceof ValidationError)
      throw new AppError(
        400,
        input.type === "YOUTUBE"
          ? "No usable transcript. Check captions or choose another video."
          : "Could not read this website. Check the URL or choose another page.",
        undefined,
        "SOURCE_EXTRACTION_FAILED",
      );
    throw new AppError(
      503,
      "Source extraction is unavailable. Retry with a new operation key.",
      undefined,
      "SOURCE_EXTRACTION_UNAVAILABLE",
    );
  }
}

export async function submitMobileSource(
  workspaceId: string,
  ownerId: string,
  input: MobileSubmissionInput,
) {
  // Ownership precedes all content/provider work, including replay and fingerprint validation.
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, userId: ownerId } });
  if (!workspace) {
    if (await prisma.clientSubmission.count({ where: { ownerId, workspaceId } })) throw deleted();
    throw new NotFoundError("Workspace not found");
  }
  if (workspace.deletedAt) throw deleted();
  validateInput(input);
  const operation = input.sourceId ? "REPLACE" : "CREATE";
  const inputDigest = sha256(
    JSON.stringify({
      workspaceId,
      operation,
      type: input.type,
      item: input.clientItemKey,
      revision: input.contentRevision,
      expected: input.expectedRevision ?? null,
      sourceId: input.sourceId ?? null,
      title: input.title ?? null,
      url: input.url
        ? canonicalSourceUrl(input.url, input.type as "WEBSITE" | "YOUTUBE")
        : null,
      generation: input.refreshGeneration ?? 0,
      recreate: input.recreateDeleted ?? false,
      filename: input.file?.originalname ?? null,
    }),
  );
  const reservation = await workspaceTransaction(workspaceId, async (tx) => {
    await ownedWorkspace(tx, workspaceId, ownerId);
    await lockSubmission(tx, ownerId, input.idempotencyKey);
    const previous = await tx.clientSubmission.findUnique({
      where: {
        ownerId_idempotencyKey: {
          ownerId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (previous) {
      if (previous.inputDigest !== inputDigest)
        throw conflict(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used for different input",
        );
      if (previous.status === "PENDING" && previous.deadline <= new Date()) {
        await failSubmission(tx, previous, "SUBMISSION_EXPIRED");
        return { expired: true };
      }
      return { response: await replay(tx, previous) };
    }
    const binding = await tx.mobileSourceBinding.findUnique({
      where: {
        workspaceId_clientItemKey: {
          workspaceId,
          clientItemKey: input.clientItemKey,
        },
      },
      include: { source: true },
    });
    if (input.sourceId) {
      if (!binding || binding.sourceId !== input.sourceId)
        throw new NotFoundError("Mobile source not found");
      if (binding.deletedAt || !binding.source || binding.source.deletedAt)
        throw deleted();
      if (binding.source.type !== input.type)
        throw new ValidationError("Replacement must retain the source type");
      if (binding.contentRevision !== input.expectedRevision)
        throw conflict(
          "REVISION_CONFLICT",
          "Source revision changed. Reload mobile bindings.",
        );
    } else if (binding) {
      if (binding.deletedAt || !binding.source || binding.source.deletedAt) {
        if (!input.recreateDeleted)
          throw conflict(
            "SOURCE_RECREATE_REQUIRED",
            "Review the deleted source before explicitly recreating it",
          );
      } else {
        if (
          binding.contentRevision !== input.contentRevision ||
          binding.source.type !== input.type
        )
          throw conflict(
            "REVISION_CONFLICT",
            "Use content replacement with the current expectedRevision",
          );
        const body = sourceResponse(binding.source, binding);
        await tx.clientSubmission.create({
          data: {
            ownerId,
            workspaceId,
            clientItemKey: input.clientItemKey,
            idempotencyKey: input.idempotencyKey,
            operation,
            inputDigest,
            status: "COMMITTED",
            sourceId: binding.sourceId,
            sourceBindingId: binding.id,
            result: JSON.parse(JSON.stringify(body)),
            responseStatus: 200,
            leaseUntil: new Date(),
            deadline: new Date(),
          },
        });
        return { response: { status: 200, body } };
      }
    }
    const active = await tx.clientSubmission.findFirst({
      where: {
        workspaceId,
        clientItemKey: input.clientItemKey,
        status: "PENDING",
      },
    });
    if (active) {
      if (active.deadline <= new Date())
        await failSubmission(tx, active, "SUBMISSION_EXPIRED");
      else throw inProgress();
    }
    const id = randomUUID();
    const deadline = new Date(Date.now() + SUBMISSION_MS);
    const submission = await tx.clientSubmission.create({
      data: {
        id,
        ownerId,
        workspaceId,
        clientItemKey: input.clientItemKey,
        idempotencyKey: input.idempotencyKey,
        operation,
        inputDigest,
        sourceId: input.sourceId,
        sourceBindingId: binding?.id,
        leaseUntil: deadline,
        deadline,
        representationTarget:
          input.type === "PDF" ? `tsumugu/mobile/${id}.pdf` : null,
      },
    });
    return { submission };
  });
  if (reservation.expired)
    throw new AppError(
      503,
      "Submission expired. Retry with a new operation key.",
      undefined,
      "SUBMISSION_EXPIRED",
    );
  if (reservation.response) return reservation.response;
  const submission = reservation.submission!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const prepared = await Promise.race([
      prepareContent(input, submission.representationTarget),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AppError(
                503,
                "Source preparation timed out",
                undefined,
                "SUBMISSION_EXPIRED",
              ),
            ),
          SUBMISSION_MS,
        );
      }),
    ]);
    const accepted = await workspaceTransaction(workspaceId, async (tx) => {
      await ownedWorkspace(tx, workspaceId, ownerId);
      const current = await tx.clientSubmission.findUniqueOrThrow({
        where: { id: submission.id },
      });
      if (current.status !== "PENDING" || current.deadline <= new Date())
        throw conflict(
          "REVISION_CONFLICT",
          "Submission expired before acceptance. Reload mobile bindings.",
        );
      const binding = await tx.mobileSourceBinding.findUnique({
        where: {
          workspaceId_clientItemKey: {
            workspaceId,
            clientItemKey: input.clientItemKey,
          },
        },
        include: { source: true },
      });
      let source;
      if (input.sourceId) {
        if (
          !binding ||
          binding.sourceId !== input.sourceId ||
          binding.deletedAt ||
          !binding.source ||
          binding.source.deletedAt
        )
          throw deleted();
        if (binding.contentRevision !== input.expectedRevision)
          throw conflict(
            "REVISION_CONFLICT",
            "Source revision changed. Reload mobile bindings.",
          );
        await tx.backgroundJob.updateMany({
          where: {
            resourceId: input.sourceId,
            type: "SOURCE",
            status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
          },
          data: { status: "CANCELLED" },
        });
        if ((binding.source.metadata as any)?.publicId)
          await enqueueRepresentationCleanup(tx, {
            ownerId,
            workspaceId,
            resourceId: input.sourceId,
            metadata: binding.source.metadata as Json,
            dedupeKey: `replacement-cleanup:${submission.id}`,
          });
        source = await tx.source.update({
          where: { id: input.sourceId },
          data: { ...prepared, status: "PENDING" },
        });
      } else {
        if (binding && (!binding.deletedAt || !input.recreateDeleted))
          throw conflict(
            "REVISION_CONFLICT",
            "Source binding changed before acceptance",
          );
        source = await tx.source.create({
          data: {
            workspaceId,
            type: input.type,
            ...prepared,
            status: "PENDING",
          },
        });
      }
      const job = await createJob(tx, {
        type: "SOURCE",
        resourceId: source.id,
        workspaceId,
        ownerId,
      });
      source = await tx.source.update({
        where: { id: source.id },
        data: { jobId: job.id },
      });
      const savedBinding = await tx.mobileSourceBinding.upsert({
        where: {
          workspaceId_clientItemKey: {
            workspaceId,
            clientItemKey: input.clientItemKey,
          },
        },
        create: {
          workspaceId,
          clientItemKey: input.clientItemKey,
          sourceId: source.id,
          contentRevision: input.contentRevision,
        },
        update: {
          sourceId: source.id,
          contentRevision: input.contentRevision,
          deletedAt: null,
        },
      });
      const body = sourceResponse(source, savedBinding);
      const status = input.sourceId ? 200 : 201;
      await tx.clientSubmission.update({
        where: { id: submission.id },
        data: {
          status: "COMMITTED",
          sourceId: source.id,
          sourceBindingId: savedBinding.id,
          result: JSON.parse(JSON.stringify(body)),
          responseStatus: status,
        },
      });
      return { status, body, jobId: job.id };
    });
    kickJob(accepted.jobId);
    return { status: accepted.status, body: accepted.body };
  } catch (error) {
    const safe =
      error instanceof AppError
        ? error
        : new AppError(
            503,
            "Submission failed before acceptance. Retry with a new operation key.",
            undefined,
            "SUBMISSION_FAILED",
          );
    await workspaceTransaction(workspaceId, async (tx) => {
      const current = await tx.clientSubmission.findUnique({
        where: { id: submission.id },
      });
      if (current?.status === "PENDING")
        await failSubmission(
          tx,
          current,
          safe.code ?? "SUBMISSION_FAILED",
          safe.statusCode,
        );
    });
    throw safe;
  } finally {
    clearTimeout(timer);
  }
}

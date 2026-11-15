-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'COMMITTED', 'FAILED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'REPRESENTATION_CLEANUP';

-- AlterTable
ALTER TABLE "learning_artifact" ADD COLUMN     "options" JSONB;

-- CreateTable
CREATE TABLE "mobile_workspace_binding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientCollectionKey" TEXT NOT NULL,
    "workspaceId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_workspace_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_source_binding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientItemKey" TEXT NOT NULL,
    "sourceId" TEXT,
    "contentRevision" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_source_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_submission" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientItemKey" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceBindingId" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "responseStatus" INTEGER,
    "errorCode" TEXT,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "representationTarget" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_workspace_binding_workspaceId_key" ON "mobile_workspace_binding"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_workspace_binding_userId_clientCollectionKey_key" ON "mobile_workspace_binding"("userId", "clientCollectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_source_binding_sourceId_key" ON "mobile_source_binding"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_source_binding_workspaceId_clientItemKey_key" ON "mobile_source_binding"("workspaceId", "clientItemKey");

-- CreateIndex
CREATE INDEX "client_submission_status_deadline_idx" ON "client_submission"("status", "deadline");

-- CreateIndex
CREATE INDEX "client_submission_workspaceId_clientItemKey_status_idx" ON "client_submission"("workspaceId", "clientItemKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "client_submission_ownerId_idempotencyKey_key" ON "client_submission"("ownerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "mobile_workspace_binding" ADD CONSTRAINT "mobile_workspace_binding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_workspace_binding" ADD CONSTRAINT "mobile_workspace_binding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_source_binding" ADD CONSTRAINT "mobile_source_binding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_source_binding" ADD CONSTRAINT "mobile_source_binding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_submission" ADD CONSTRAINT "client_submission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


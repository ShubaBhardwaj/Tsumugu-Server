ALTER TABLE "workspace" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "source" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "jobId" TEXT;
ALTER TABLE "learning_artifact" ADD COLUMN "jobId" TEXT;
ALTER TABLE "conversation" ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "message" ADD COLUMN "position" INTEGER;
WITH ordered AS (
 SELECT "id", ROW_NUMBER() OVER (PARTITION BY "conversationId" ORDER BY "createdAt", "id") AS n FROM "message"
) UPDATE "message" m SET "position" = ordered.n FROM ordered WHERE m."id" = ordered."id";
ALTER TABLE "message" ALTER COLUMN "position" SET NOT NULL;
CREATE UNIQUE INDEX "message_conversationId_position_key" ON "message"("conversationId", "position");
UPDATE "conversation" c SET "messageCount" = (SELECT COUNT(*) FROM "message" m WHERE m."conversationId" = c."id");
UPDATE "conversation" SET "summaryMessageCount" = GREATEST(0, LEAST("summaryMessageCount", "messageCount"));
CREATE TYPE "JobStatus" AS ENUM ('PENDING','DISPATCHED','RUNNING','SUCCEEDED','FAILED','CANCELLED');
CREATE TYPE "JobType" AS ENUM ('SOURCE','ARTIFACT','SUMMARY','MEMORY','SOURCE_CLEANUP','WORKSPACE_CLEANUP');
CREATE TABLE "background_job" (
 "id" TEXT PRIMARY KEY, "type" "JobType" NOT NULL, "resourceId" TEXT NOT NULL,
 "ownerId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL UNIQUE,
 "status" "JobStatus" NOT NULL DEFAULT 'PENDING', "payload" JSONB NOT NULL,
 "deliveryGeneration" INTEGER NOT NULL DEFAULT 0, "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
 "processingAttempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3), "leaseToken" TEXT, "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "background_job_status_nextAttemptAt_idx" ON "background_job"("status", "nextAttemptAt");
CREATE INDEX "background_job_workspaceId_resourceId_idx" ON "background_job"("workspaceId", "resourceId");
CREATE INDEX "background_job_ownerId_idx" ON "background_job"("ownerId");

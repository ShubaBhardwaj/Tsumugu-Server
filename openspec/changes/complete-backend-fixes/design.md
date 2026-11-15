# Design

## Context

See `proposal.md` for the seven problems and intended outcome. This design is based on backend commit `a114397`.

The project already separates routes, controllers, services, and repositories. Chat and artifact services exist, but their HTTP controllers and routes do not. Memory update and deletion do not check ownership. Source creation and worker notification are separate operations. The summary service rereads all messages and then waits for Mem0 inside the same worker step. The only migration is the initial schema migration, and no automated test suite is present.

The proposed work keeps this structure, PostgreSQL, and the current providers. All changes below are planned; no application files or migrations are changed by creating this document.

## Goals / Non-Goals

**Goals:**

- Make the existing services reachable through small authenticated controllers.
- Keep access checks, validation, and durable job creation inside the service boundary.
- Make retries safe and make failures visible without leaking private data.
- Preserve existing successful workspace, source, and memory response codes.
- Give each behavior a focused test that can run without spending money on external APIs.

**Non-Goals:**

- Frontend screens, new login providers, provider changes, model upgrades, or live deployment.
- A new queue platform or a general-purpose job dashboard.
- Automatically deleting a user's previously generated artifacts merely because one source is deleted. Deleting the whole workspace still removes its artifacts.
- Guaranteeing exactly-once billing by external AI services after a process crash. The application will prevent duplicate saved results, but an uncertain external response can require a repeated provider request.

## Decisions

### 1. Reuse existing services and add a clear API contract

Controllers will parse input, get the session user, call the existing service layer, and return the result. Ownership remains in services so worker and future caller paths cannot bypass it.

All paths below are relative to `/api/workspaces/:workspaceId` unless stated otherwise.

| Method and path | Result |
| --- | --- |
| `GET /conversations` | 200, owned conversation list |
| `POST /conversations` | 201, new conversation |
| `GET /conversations/:conversationId/messages` | 200, ordered message history |
| `DELETE /conversations/:conversationId` | 204, conversation removed and pending work cancelled |
| `POST /chat` | 200, existing UI-message streaming format |
| `GET /artifacts` | 200, artifact list with status |
| `POST /artifacts` | 202, artifact ID, job ID, and pending status |
| `GET /artifacts/:artifactId` | 200, artifact status and available content |
| `DELETE /artifacts/:artifactId` | 204, artifact unavailable and work cancelled |
| `POST /artifacts/:artifactId/retry` | 202, new or already-active job for the same artifact |
| `POST /sources/:sourceId/reprocess` | 202, job for the same source |
| `GET /api/jobs/:jobId` | 200, the owner's safe job status |
| `POST /api/jobs/:jobId/retry` | 202, new or already-active retry job |

Missing sessions return 401. Missing, foreign, deleted, or wrong-workspace records return 404. Invalid fields return 400; requests above the body-size limit return 413. Preserve current source creation at 201 and current deletion responses at 204. Deletion means immediate removal from the app; external cleanup can finish in the background.

Keep `X-Conversation-Id` on chat replies and expose it through CORS. History returns persisted citations; no new frontend transport is introduced. Before headers are sent, failures use the normal error middleware. After streaming starts, report errors through the stream and do not save a completed assistant message for an aborted reply.

**Alternative considered:** inventing a second chat format. Reusing the current AI SDK stream avoids unnecessary changes to service code and future client integration.

### 2. Check memory ownership at the provider boundary

Add a typed memory lookup in `lib/mem0.ts`. Normalize the SDK's owner field, compare it with the session user, and fail closed when ownership is absent. Both update and deletion must pass through owner-aware services; controllers must not call provider deletion directly.

Return the same 404 for nonexistent and foreign memories. A provider outage becomes 503 and never permits the write. Do not derive ownership from user-editable metadata or from the memory's presence in the first page of a list.

**Alternative considered:** checking a list of 100 memories. That would incorrectly reject owners whose memory is on another page and is not an authoritative ID lookup.

### 3. Save background requests with a durable job record

Introduce a `BackgroundJob` table, also called an outbox: a saved list of work that still needs to run. Store its ID, type, resource ID, owner ID, optional workspace ID, deduplication key, status, delivery generation, delivery/processing attempt counts, next attempt time, lease expiry, and a safe last error. Keep payloads small: saved IDs and cleanup targets, not an entire source document. Cleanup jobs must survive parent deletion; do not give them cascading resource foreign keys.

Use statuses `PENDING`, `DISPATCHED`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `CANCELLED`. Source and artifact rows also carry their current processing job ID so an older job cannot commit a newer run's status.

Create the business record and job in one Prisma transaction. After commit, attempt immediate notification. A failed notification does not undo an accepted request: the pending job remains available to a relay. Add an Inngest recovery function that runs every minute and scans pending delivery, expired worker leases, and stale dispatched jobs. It must run on server startup as well, with a database lease preventing competing relay passes from claiming the same job.

Use the saved job ID as the logical work identity and `<jobId>:<deliveryGeneration>` as the event identity. Retry an uncertain notification with the same event identity. When deliberately recovering an expired execution, advance the delivery generation so provider event deduplication does not suppress recovery. Both envelopes still refer to the same logical job. Workers claim a lease, heartbeat during long work, and check the lease and current job before saving results. Use bounded backoff: initially 30 seconds, doubling to a maximum of 15 minutes, with eight delivery attempts. Exhaustion sets the job and its source/artifact to a safe, retryable failed state. Processing retries remain bounded using the existing worker retry counts; final failure must update the job and resource consistently. A retry creates a new job for the same resource; a uniqueness guard returns the active job when requests race.

Do not claim provider calls are exactly once. Completed jobs skip work; uncertain crashes use stable chunk IDs and guarded commits to avoid duplicate application records. Summaries and memory learning use different job types. Outbox recovery covers creation, summary requests, learned memories, generation, and cleanup.

**Alternatives considered:** catching a send error alone still loses work after a crash; adding a second broker increases infrastructure. A PostgreSQL outbox closes the save/notify gap using the existing database.

### 4. Make deletion immediate for users and recoverable for storage

Add nullable `deletedAt` markers to sources and workspaces. In one transaction, verify the entire selection, mark it deleted, cancel pending processing, and save cleanup work with the external IDs it needs. Existing reads must always exclude marked rows and children of marked workspaces.

Retrieval must check each vector match against a live, ready source and its current indexing run. This prevents deleted, failed, or superseded material from reaching a prompt even before external cleanup finishes.

Cleanup waits for active resource processing to finish or acknowledge cancellation, removes Pinecone vectors and database chunks, removes uploaded PDFs through Cloudinary, then hard-deletes the remaining rows. Workspace cleanup additionally removes its vector namespace and cascaded conversation/artifact rows. Treat already-missing external objects as success. Keep cleanup records when a provider is unavailable.

Workers check cancellation before and after external writes. Tag vectors with the processing job ID so obsolete writes can be identified. Do not mark cleanup complete while a known worker can still write that resource; recovery must revisit expired or interrupted runs. Use provider request timeouts and lease heartbeats so workers cannot stay active indefinitely. Guard all final status writes against deletion and a changed current-job ID.

**Alternative considered:** removing database rows first and ignoring provider errors. That loses cleanup targets and lets deleted text remain usable in search.

### 5. Fix document processing without introducing a new splitter dependency

Use one shared chunk-size and overlap configuration from `ai-config.ts`. Validate integer bounds and recursively split oversized segments using the existing separators. Merge only pieces that fit; preserve meaningful text and add bounded overlap without crossing PDF pages. Keep the current defaults of 1,000 characters and 100 characters of overlap.

Move PDF extraction responsibility to the background worker. Uploading saves the file and metadata, then queues work. The worker handles PDFs before the generic saved-text shortcut and always extracts the original file's page array, even when old records already contain combined text. Keep actual one-based page numbers through database chunks, vector metadata, and citations. A missing/unreadable original becomes an actionable failure; it must not invent page numbers.

For reprocessing, hide incomplete output from retrieval, remove old vectors for that source, and build the new chunk set with stable IDs for that job. A repeated delivery reuses that set; a new reprocess job gets a new generation. Only the current job can publish `READY`.

**Alternative considered:** storing the complete page array inside source JSON. Re-extracting the original in the worker avoids duplicating a large document in metadata and supports the existing stored PDFs.

### 6. Validate complete messages and meaningful generated content

Use the installed AI SDK's UI-message validation with the supported web-search tool definition, plus explicit application rules. Reject user-supplied system messages, unsupported parts, missing IDs/roles/parts, and a final message without nonblank user text. Start with documented limits of 256 KiB per JSON body, 100 UI messages per request, and 8,000 text characters per message. These are proposed defaults stored in shared configuration, not claims about provider limits.

Keep model allow-list validation. Parse before any database write or provider call. For existing conversations, build model history from owned persisted messages plus the new user turn so submitted assistant history is not authoritative. Bound the model's recent history as the current service intends.

Keep provider-compatible structural schemas for artifact generation. After output is returned, apply semantic checks before saving: nonblank fields, answer index less than option count, unique node/edge IDs, and edges pointing to real nodes. Invalid output follows the failed/retry path and never becomes `READY`.

An omitted artifact source selection means all usable ready sources; an explicit empty or partly invalid selection is a 400 error. Deduplicate IDs, preserve a deterministic order, and track actual contributions when applying the existing 120,000-character context limit. Save only contributing source IDs and record truncation. Revalidate selections when a delayed job begins.

**Alternative considered:** trusting the model's instructions alone. Prompt wording cannot guarantee a valid quiz answer or graph.

### 7. Summarize new messages in stable, bounded batches

Add `Message.position` and a conversation message counter. Allocate positions with message insertion in a transaction and enforce uniqueness within each conversation. Continue using `summaryMessageCount` as the last covered position; this keeps the existing summary fields while providing stable order under concurrent writes.

Serialize summary work per conversation. Capture the next contiguous unsummarized batch in position order. Use the previous summary plus only that batch, with a proposed maximum of 24,000 input characters including the previous summary. Keep saved summary text within 2,000 characters and the existing target of 250 words. Process further batches if required; never advance beyond messages actually covered. Save summary text and position together with a compare-and-set guard on the previous position. A repeated job with no new messages makes no AI call.

On a completed assistant reply, save the assistant message and any required summary/memory jobs in a transaction. Create learned-memory work for that completed exchange separately, keyed by its saved message IDs. Remove the direct fire-and-forget Mem0 write from chat and the Mem0 call inside summary generation. Derive memory ownership through the conversation's workspace. Memory failure retries only memory work; summary success remains saved. Missing optional Mem0 configuration creates no doomed job. A temporary memory search failure is logged and chat continues without it.

**Alternative considered:** resending the full chat on every summary. That grows input without bound and reprocesses old content.

### 8. Use one frontend origin and explicit worker environments

Add a shared validated server configuration module. `CLIENT_URL` is the allowed frontend origin for CORS and Better Auth trust; `BETTER_AUTH_URL` remains the backend auth base URL. Development keeps the current frontend fallback at `http://localhost:3001`; production requires an explicit frontend URL. Expose the conversation header and keep credentialed origins explicit.

Validate required settings at startup. In production reject local Inngest development mode and missing event/signing keys. Require settings for enabled source/AI features; make optional web search and memory behavior explicit. Configuration errors name variables without printing values. Provide `.env.example` and README commands for local worker registration, recovery, migrations, tests, build, and production startup. Do not edit a user's `.env`.

**Alternative considered:** independently calculating origins in auth and Express. That is the current source of disagreement.

### 9. Verify behavior at the boundaries

Use Bun's existing test runner, dependency stubs for external services, and an isolated disposable PostgreSQL test database for transactions and concurrency. Add a `test` script during implementation. Do not use production data, real provider keys, or paid APIs for automated tests.

Cover the scenarios in all eight specs, especially two-user ownership, route reachability, malformed messages, invalid AI outputs, oversized paragraphs, multi-page PDFs, delayed deletion, missed delivery, restart recovery, repeated events, concurrent retries, overlapping summaries, and Mem0 failure after summary success. Run type checking, build, Prisma validation, and a fresh test-database migration. Keep optional live-service smoke tests separate and report them as pending until actually run.

## Risks / Trade-offs

- **More database state:** durable jobs, deletion markers, and message positions need a migration. Mitigation: use additive fields, backfill deterministically, and test upgrades from the current schema.
- **External cleanup is eventually consistent:** provider deletion may take time. Mitigation: block deleted material from application reads immediately, keep durable cleanup targets, and retry failures.
- **Interrupted provider calls can cost twice:** application deduplication cannot undo an uncertain external call. Mitigation: stable job IDs, bounded retries, checkpoints, and no repeated summary after a separate Mem0 failure.
- **Existing PDFs may have inaccessible files:** page-aware reprocessing can fail. Mitigation: return a clear re-upload/retry message and do not manufacture citations.
- **Strict validation rejects payloads previously accepted:** mitigation is documented valid examples and route tests before exposing the new APIs.
- **Recovery depends on a running worker environment:** mitigation is a documented startup/registration check and pending-job recovery after outages.

## Migration Plan

1. During implementation, add a new migration; never rewrite the initial migration. Add the job table, source/workspace deletion markers, current processing-job references, message positions, and the conversation counter.
2. Backfill message positions by `(createdAt, id)` per conversation. Set counters to the highest position and retain an existing summary progress value only within the valid range. Test this mapping before enabling incremental summaries.
3. Deploy the additive schema, then the compatible application and registered workers. Reconcile old pending/processing rows without jobs and create one recovery job per resource; do not enqueue a duplicate for resources already complete.
4. Existing ready vectors without a generation tag remain usable only after a live ready-source check until that source is reprocessed. New runs always use generation checks. Reprocess existing PDFs deliberately to rebuild page-aware citations.
5. Verify transactions, recovery, routes, and deletion in the test environment before production rollout. This proposal performs no deployment or migration.
6. For rollback, first stop job delivery and drain active workers. Keep additive schema and unfinished cleanup records. Do not restore the old deletion/read code over marked records because it ignores deletion markers; use a compatible rollback build or keep affected routes disabled while repairing. Do not destructively remove the new tables as a rollback shortcut.

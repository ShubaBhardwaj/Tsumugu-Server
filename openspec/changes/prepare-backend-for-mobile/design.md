# Design

## Context

See proposal.md and specs/. The existing server already has authenticated workspace/source/chat/artifact/job endpoints, per-workspace vector namespaces, live-source checks, durable Inngest work, logical deletion, and provider test wrappers. Preserve that work and the complete-backend-fixes migration. Current code has no mobile identity/revision contract, no Expo auth plugin, account-scoped Mem0 context, and a general-knowledge fallback.

This is step 2 and edits the backend only. It must be implemented before step 3 mobile authentication and step 4 business integration. Step 1's local library provides document IDs and saved-link IDs, not server folder records.

## Goals / Non-Goals

**Goals:** establish the concrete contract below, native auth support, collection isolation, and bounded recoverable submissions using current infrastructure.

**Non-Goals:** a new batch queue platform, phone folder synchronization, automatic background uploads, whole-collection atomic index publication, mobile/web code, unsupported input formats, changing providers/models, deployment, or exactly-once provider billing.

## Decisions

### 1. Add Expo support to the existing auth instance

Install an @better-auth/expo version compatible with the locked Better Auth version and register its server plugin in src/lib/auth.ts. Preserve Google as the only provider; do not copy the guide's emailAndPassword example.

Trust the existing configured CLIENT_URL for browser access and the specific tsumugu native callback pattern. Keep browser CORS origins separate from callback schemes: a native scheme is not a browser origin to add indiscriminately to CORS. Preserve credentialed web requests and X-Conversation-Id exposure. BETTER_AUTH_URL remains the externally reachable auth server URL.

Document Google's server callback as <BETTER_AUTH_URL>/api/auth/callback/google and the subsequent native app callback separately. Production must not trust arbitrary origins or exp wildcards. No global origin/CSRF disabling or alternate JWT authentication system.

Reference: [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo). Reverify the installed version's documented plugin/API behavior at apply time. Generic guide examples are not additional product requirements.

### 2. Use durable bindings rather than title or URL matching

Add three focused persistence records in the next additive Prisma migration:

| Record | Planned identity and data |
| --- | --- |
| MobileWorkspaceBinding | unique (userId, clientCollectionKey); nullable unique workspaceId; deletedAt; timestamps |
| MobileSourceBinding | unique (workspaceId, clientItemKey); nullable unique sourceId; contentRevision; deletedAt; timestamps |
| ClientSubmission | unique (ownerId, idempotencyKey); operation; inputDigest; workspace/resource/binding IDs as applicable; PENDING/COMMITTED/FAILED; safe result/error; bounded lease/deadline; external representation target; timestamps |

Workspace/source cleanup must not erase the evidence required to recognize a deleted binding. Set binding deletion markers during logical deletion, before cleanup; sourceId/workspaceId use nullable references where the target may be hard-deleted. Keep source bindings until their workspace is deleted. Keep the small workspace binding tombstone for the account; deleting the account may remove it.

clientCollectionKey is a UUID generated and saved on mobile once for that account/local-collection binding. It is not a title or folder name. On confirmed recreation of a deleted workspace, mobile deliberately generates a new binding key. clientItemKey is document:<localDocumentId> or link:<localLinkId>, scoped by the workspace.

Do not backfill unrelated old web sources into mobile bindings by name/URL. Existing workspaces/sources remain usable without bindings.

Alternative rejected: nullable fields only on Source/Workspace. Hard deletion would erase them and allow an uncertain retry to recreate deleted resources silently.

### 3. Publish additive mobile contract v1

All requests remain session-authenticated. Identity comes from the session; client identifiers never authorize a different owner. Existing no-mobile-field requests retain existing response formats/codes.

| Endpoint | Additive contract |
| --- | --- |
| POST /api/workspaces | optional clientCollectionKey with existing title; create 201, resolve existing live binding 200; deleted binding 410 |
| GET /api/workspaces/:workspaceId/sources/mobile-bindings | owned bindings including clientItemKey, sourceId, contentRevision and deletion state; static route before /:sourceId |
| POST .../sources/upload | existing file/title plus clientItemKey, contentRevision and Idempotency-Key for mobile submissions |
| POST .../sources/import/website or /youtube | existing url/title plus clientItemKey, contentRevision, optional refreshGeneration and Idempotency-Key |
| PUT .../sources/:sourceId/content | replace mobile-bound source: expectedRevision plus new contentRevision; multipart file for PDF or JSON URL fields for the existing URL type; requires Idempotency-Key |
| DELETE .../sources/:sourceId | optional quoted If-Match content revision; conflict 409, successful existing semantics 204 |
| POST .../sources/bulk-delete | existing sourceIds; optional complete expectedRevisions map for guarded mobile removals |
| Existing source/job/conversation/artifact routes | remain the status, retry, chat, history, and management surfaces |

Successful mobile source responses include source ID, current jobId/status and binding identity/revision. New creation is 201; unchanged live item/revision is 200; an equivalent committed request replays its original successful response. A replay whose target was deleted returns 410, not a cached live resource.

HTTP 409 safe codes distinguish IDEMPOTENCY_CONFLICT, REQUEST_IN_PROGRESS, REVISION_CONFLICT and SOURCE_RECREATE_REQUIRED; 410 identifies a deleted owned target. Preserve ordinary foreign-resource 404. Include a safe Retry-After for an active submission. Document JSON error additions without changing existing error strings into secret-bearing dumps.

The same item key/current revision reuses a live source even if a client accidentally uses another request key. A different revision must go through replacement with the expected old revision, never a duplicate create. An explicitly reviewed re-add of a deleted source supplies recreateDeleted true and a fresh operation key; return a new source under the existing binding. Ordinary replay must not recreate it.

A workspace resolution replay does not rename the workspace from stale input. Later title synchronization is explicit PATCH only; mobile does not automatically mirror renames in this version.

### 4. Fingerprints and upload recovery

For PDFs, contentRevision is SHA-256 of actual file bytes; validate against the received buffer. Keep the existing 10 MiB single-file limit and reject invalid input before paid processing. For URLs, derive SHA-256 from type, conservatively canonicalized URL and refreshGeneration (default zero). Increasing refreshGeneration expresses an explicitly consented refresh of an unchanged URL; normal Analyze reuses unchanged URL content.

Wire fingerprints use lowercase hexadecimal SHA-256. For URLs, hash UTF-8 text formed as type + newline + canonicalKey + newline + decimal refreshGeneration, with no final newline. canonicalKey is youtube:<videoId> for a recognized exact-host video URL, or the conservatively serialized HTTP(S) website URL used by step 1. Both client and server use identical fixtures; reject unsupported hosts/schemes rather than applying the old substring-only video matcher.

Reserve ClientSubmission after ownership/input validation and before external upload/scrape work. Store its request digest and deterministic external upload target; never store original file bytes in this ledger. Replays compare the digest before provider work. An active lease returns REQUEST_IN_PROGRESS; expired work is recovered or fails visibly under a bounded policy.

Reuse the existing job recovery scheduler for expired submission reconciliation rather than adding a second daemon. Use a stable provider representation target for retries of one logical PDF upload, and keep enough information to query/clean it after a crash. If a source/job commits, save its binding and submission result in the same transaction. Tests must inject stops after reservation, upload, source commit and before response.

Current URL extraction happens before source/job creation. Keep this compatible for legacy imports, but protect mobile extraction with the same durable submission record. Extraction failure is an operation failure, not a falsely accepted READY source. Mobile records it before a source job exists. Paid-provider exactly-once execution is not promised.

### 5. Replace content without losing history

Read/validate the expected revision before expensive work and recheck it under the workspace/binding lock before commit. Prepare the replacement representation, then atomically cancel superseded source jobs, update source input/status/revision, create the new source job and commit its operation result. No database transaction spans a provider network call.

If an older request loses the revision race, schedule cleanup of its unused representation. Add a focused representation-cleanup job type/handler using existing leases/recovery, without deleting a live source row. Cleanup of the old accepted representation waits until no earlier worker can use/write it. Do not reuse whole-source cleanup in a way that hard-deletes the new source.

Set updated content PENDING so stale chunks are excluded by current live/run checks. URL replacement refreshes extracted content, not merely the old saved text. A failed replacement remains visibly failed; it does not silently claim the old revision is current. Conversation and artifact IDs remain unchanged; existing artifacts are historical outputs.

Conditional removals verify every expected source/revision in one transaction for bulk operations. Never infer deletion from a list of all IDs absent on the phone; only explicit tracked IDs may be removed.

### 6. Enforce collection grounding

Remove account-wide Mem0 retrieval/learning from collection chat. Previously queued collection MEMORY work must cancel safely rather than exporting more content; leave manual memory APIs and old provider data intact. Internal per-conversation summaries remain enabled.

Update chat/artifact branding to Tsumugu, delimit source content as untrusted data, remove the web-off general-knowledge fallback, and retain workspace/history ownership checks. Insufficient evidence gives a useful limitation.

With explicit webSearch true but no configured service, return 503 with WEB_SEARCH_UNAVAILABLE before persisting a new user turn or generating an answer. With search off, never call the search provider. Accumulate results from all tool calls with globally unique W labels and preserve those labels with saved citations; do not overwrite the earlier result set. Numeric collection citation labels stay distinct.

Keep the existing AI SDK stream. Completed message history remains the authoritative citation-delivery mechanism for the first mobile integration; no separate streaming protocol is introduced.

### 7. Support the controls already present in mobile

Extend createArtifactSchema with optional options, and persist normalized choices in a dedicated nullable options JSON column on LearningArtifact so worker metadata updates cannot erase them.

| Type | Supported optional choices |
| --- | --- |
| FLASHCARDS | topic up to 200 characters; count 10/20/30; difficulty easy/medium/hard |
| QUIZ | topic; count 5/10/15; difficulty easy/medium/hard |
| SUMMARY / TAKEAWAYS | topic; detail concise/detailed |
| MINDMAP / REPORT | topic |

Omitted options retain existing generation defaults. Reject unsupported type-option combinations rather than silently stripping them. Pass options to generation/retry, require requested counts exactly, preserve existing output structures and semantic checks, and fail visibly on unsupported topics/insufficient evidence. An internal unsupported-topic outcome becomes a failed artifact, not invented ready content. Artifact options never change source selection or authorize outside search.

## Risks / Trade-offs

- Replay support adds persistence -> keep three narrowly scoped records and reuse current worker/recovery infrastructure.
- Uncertain external calls may repeat -> stable representation identity, bounded leases and cleanup; do not promise exactly-once billing.
- Updating a collection is not an atomic snapshot swap -> individual readiness is honest; mobile must label partial updates.
- Old workers race with replacement/deletion -> preserve generation/lease checks and test replacement-specific representation cleanup.
- Tight grounding changes previous chat behavior -> document it as required alignment, preserve web-search opt-in.
- Native auth may need real Google configuration -> stubbed tests prove logic only; phone OAuth is a separate acceptance gate.

## Migration Plan

1. Verify the existing complete-backend-fixes migration/schema baseline without altering user databases.
2. Add new binding/submission records, artifact options, required indexes and representation-cleanup job enum in a new migration; regenerate the Prisma client during apply.
3. Test fresh and upgrade paths using the existing disposable-database runner, including existing sources/chats/jobs and no mobile metadata.
4. Implement server auth and identity/revision flows, grounding and options; publish request examples and safe environment names in README/.env.example.
5. Run the full isolated suite, typecheck, build, Prisma validation and strict OpenSpec validation. Record live provider/OAuth/worker checks separately.
6. Apply to an intended development database only during explicitly requested implementation/setup; never reset it. Production rollout and credentials remain a separate action. Roll back with a compatible build that preserves bindings, tombstones and unfinished cleanup, not by dropping new records.

Contract changes during apply must be reflected in the dependent mobile design before it is implemented.

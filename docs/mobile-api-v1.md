# Mobile API contract v1

Implemented by `prepare-backend-for-mobile`, 15 November 2026. All paths require the existing Better Auth session. Identity comes from that session. Foreign resources return 404; missing/expired/revoked sessions return 401. Native auth configuration is in the README.

## Identity and workspace resolution

One parent collection maps to one workspace. Mobile saves an account-specific UUID `clientCollectionKey` before its first request. Child folders never become workspaces.

```http
POST /api/workspaces
Content-Type: application/json

{"title":"DBMS","clientCollectionKey":"35a30cc1-ea4a-4ae4-bf63-0158aa15d89f"}
```

201 creates a workspace; 200 resolves the same live workspace, returning the existing workspace object (`id`, `title`, `description`, `icon`, `defaultModel`, timestamps). Resolution never changes an existing title. Use explicit PATCH for a remote rename. Legacy creation without the key still returns 201. Deleted bindings return 410 `RESOURCE_DELETED`, including after hard cleanup. Confirm recreation before generating a new collection key. Never recover by title matching.

`GET /api/workspaces/:workspaceId/sources/mobile-bindings` returns an array:

```json
[{"clientItemKey":"document:local-document-id","sourceId":"source-id","contentRevision":"lowercase-64-character-sha256","deletedAt":null}]
```

`sourceId` becomes null after hard cleanup; `deletedAt` remains set. Keep local mappings by item key as well as source ID. Live/deleted source bindings remain until workspace cleanup. Workspace binding tombstones survive workspace cleanup. Legacy/web sources are not automatically bound.

## Source submission and fingerprints

Paths below are relative to `/api/workspaces/:workspaceId`. PDF upload uses `POST /sources/upload`, multipart field `file`, one PDF at most **10 MiB**. Mobile metadata fields are `clientItemKey`, `contentRevision`, optional `title`, and optional `recreateDeleted`. PDF item keys use `document:<localDocumentId>`. The server verifies `%PDF-` bytes, MIME and SHA-256 of the actual bytes. Do not send a `content://` string as file content.

URL submissions use `POST /sources/import/website` or `/sources/import/youtube`, JSON:

```json
{
  "url":"https://example.com/notes",
  "title":"DBMS notes",
  "clientItemKey":"link:local-link-id",
  "contentRevision":"computed-lowercase-sha256",
  "refreshGeneration":0
}
```

Every mobile source submission/replacement requires `Idempotency-Key`: 1–128 ASCII letters, digits, hyphens or underscores (UUID recommended). Both mobile identity fields are required together; supplying a request key without mobile fields is invalid. Item suffixes accept 1–128 ASCII letters, digits, hyphens or underscores. URLs require `link:` keys. `refreshGeneration` is a nonnegative safe integer, default zero, supported only for URLs. Increment it only after explicit refresh consent.

Fingerprint serialization is UTF-8 `TYPE + "\n" + canonicalKey + "\n" + decimalGeneration`, **without a final newline**, hashed with SHA-256 and encoded as lowercase hexadecimal. PDF revisions hash only bytes.

| Input | Canonical key / hash input |
| --- | --- |
| Website ` HTTPS://Example.com:443/a?b=2&a=1#part ` | `https://example.com/a?b=2&a=1#part` |
| Website `https://example.com`, generation 0 | `WEBSITE\nhttps://example.com/\n0` |
| YouTube `https://youtu.be/12345678901?t=4`, generation 0 | `YOUTUBE\nyoutube:12345678901\n0` |
| YouTube `https://www.youtube.com/watch?v=12345678901&x=1` | Same video key as the previous row |

Website serialization uses the standard URL serializer after trimming; retain query order and fragments, with no tracking-parameter removal. Reject non-HTTP(S) URLs and embedded credentials. Recognized exact YouTube hosts: `youtu.be`, `youtube.com`, `www.youtube.com`, `m.youtube.com`; allow watch, shorts and embed video URLs with exactly 11 ID characters. Reject deceptive host suffixes and unsupported paths. Equivalent fixtures live in `tests/mobile-validation.test.ts` and match mobile `study-url.ts`.

A successful mobile source response extends the existing source object with **top-level** `clientItemKey` and `contentRevision`; it includes `id`, `workspaceId`, `type`, `title`, `content`, `url`, `status`, `metadata`, `jobId`, deletion state and timestamps. New creation returns 201. Reusing a live item/current revision under another request key returns 200 without provider work. Same-key committed replay returns its original successful status/body; poll the source/job for current progress. A committed replay with a deleted target returns 410 rather than a cached live response. A different revision requires replacement, never another create.

Accepted is not ready: poll existing source/job endpoints for PENDING/PROCESSING/READY/FAILED and per-item errors. Extraction of a website/transcript occurs before source acceptance. Empty pages, missing captions and provider outages produce a failed operation with no falsely ready source/job. Failed HTTP submissions require a new operation key after review. Retrying an accepted failed job uses `/api/jobs/:id/retry` or source reprocess; it does not create a duplicate source.

## Replace, remove and recreate

`PUT /sources/:sourceId/content` requires the same mobile `clientItemKey`, `expectedRevision`, new `contentRevision`, and a fresh `Idempotency-Key`. It accepts multipart `file` for an existing PDF, or JSON `url` and optional `refreshGeneration` for the existing WEBSITE/YOUTUBE type. Optional `title` supplies the replacement title. Do not include `recreateDeleted` or a client `type` in replacement bodies. Type changes are rejected. A successful replacement returns 200 with the same source ID, a new job ID and PENDING status. It cancels old processing and excludes obsolete retrieval immediately. Conversations and artifacts retain their IDs. Existing artifacts are historical outputs.

Example URL replacement:

```json
{
  "url":"https://example.com/notes",
  "clientItemKey":"link:local-link-id",
  "expectedRevision":"previous-lowercase-sha256",
  "contentRevision":"new-lowercase-sha256",
  "refreshGeneration":1
}
```

`POST /sources/:id/reprocess` re-indexes **saved server content**. It neither reads an edited phone original nor refetches a URL. Use content replacement to submit edits or refresh a URL. Pre-acceptance replacement failure leaves the previous accepted revision intact and reports the failed operation; accepted new content that fails indexing remains visibly FAILED until retried.

Single deletion supports `If-Match: "<contentRevision>"` (one quoted digest, no weak tags or wildcard). Bulk deletion supports:

```json
{"sourceIds":["source-id"],"expectedRevisions":{"source-id":"current-lowercase-sha256"}}
```

The map must cover exactly the selected IDs. Every guarded source must be mobile-bound in that workspace at that revision; conflicts reject the entire bulk operation. Successful deletion remains 204. Legacy unguarded deletions retain their behavior. Mobile must remove only explicitly tracked IDs reviewed in Analyze, preserving untracked/web-created sources.

After a remote source deletion, ordinary create returns 409 `SOURCE_RECREATE_REQUIRED`. Following explicit user review, submit the normal create body with `recreateDeleted: true` and a **new** request key. It creates a new source ID under the same item binding, before or after old-source cleanup. Replaying an old key never recreates the deleted target. Backend deletion never deletes phone originals.

## Safe errors and recovery

Errors retain `error` as a string and may add top-level `code`; existing `details` remains available for validation errors.

| HTTP/code | Client action |
| --- | --- |
| 400 validation / `SOURCE_EXTRACTION_FAILED` | Correct input, check usable page/captions; no accepted source implied |
| 409 `IDEMPOTENCY_CONFLICT` | Key already represents different input; reconcile the saved attempt |
| 409 `REQUEST_IN_PROGRESS` | Retry same request after `Retry-After: 5`; do not blindly allocate keys |
| 409 `REVISION_CONFLICT` | Reload bindings and review current revision before overwrite/removal |
| 409 `SOURCE_RECREATE_REQUIRED` | Ask for explicit recreation consent |
| 410 `RESOURCE_DELETED` | Recover/recreate deliberately; foreign IDs still return 404 |
| 503 `SUBMISSION_EXPIRED` / `SUBMISSION_FAILED` / `SOURCE_EXTRACTION_UNAVAILABLE` | Reconcile bindings, then review and retry unaccepted work under a new key |
| 503 `WEB_SEARCH_UNAVAILABLE` | Disable optional search or retry later; no new chat history was saved |

Multipart limit/type failures return 400; oversized JSON remains 413. Do not interpret a network failure as success or sign-out.

The durable submission ledger reserves work before providers and commits source/job/binding/result atomically. Preparation has a two-minute lease/deadline. Expired work fails visibly through the existing recovery scheduler; same-key retries do not repeat terminal operations. No PDF bytes are retained in the ledger. Mobile PDF representations use a signed, deterministic Cloudinary public ID `tsumugu/mobile/<submission UUID>.pdf`, with overwrite disabled. This requires server Cloudinary upload/create and destroy permissions; legacy unsigned-preset uploads remain supported. See the [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference).

Representation-only cleanup cannot delete a live replacement source. Old representations wait for source worker leases; unused submissions wait until the bounded transport deadline plus 30 seconds. Cleanup records survive parent deletion, use existing recovery/retries and are inspectable through owner job APIs. Exactly-once external billing is not promised. Collection Analyze remains a partial per-source update, not an atomic snapshot swap.

## Artifact options and citations

`POST /artifacts` retains `type`, optional `title` and optional nonempty `sourceIds`, adding optional `options`:

| Type | Supported options |
| --- | --- |
| FLASHCARDS | `topic`, `count`: 10/20/30, `difficulty`: easy/medium/hard |
| QUIZ | `topic`, `count`: 5/10/15, `difficulty`: easy/medium/hard |
| SUMMARY, TAKEAWAYS | `topic`, `detail`: concise/detailed |
| MINDMAP, REPORT | `topic` |

`topic` is trimmed, nonblank and at most 200 characters. Unknown options and unsupported type/option combinations return 400 before saving a job. Omitted options retain prior defaults. Example: `{"type":"QUIZ","options":{"count":10,"difficulty":"medium"}}`. Saved create/list/detail responses include nullable `options`, independent of worker metadata; retry preserves these choices. Ready content retains all six existing shapes and must match an explicit count exactly. Insufficient-topic evidence produces a failed artifact with an actionable error, not invented output. Options do not authorize outside search or broaden source selection.

The AI SDK streaming protocol is unchanged. Read `X-Conversation-Id`, then load completed saved messages for authoritative citations. Collection citation `label` values are `"1"`, `"2"`, etc.; web references use `"W1"`, `"W2"`, etc. and `sourceType: "WEB"`, title, URL and excerpt. Collection references retain source/chunk IDs and available PDF pages. An interrupted stream is never saved as a completed assistant answer.

## Handoff to later mobile changes

`integrate-expo-google-auth` must verify the reachable server URL, matching client plugin version, fixed `tsumugu` callback, explicit current cookies on custom requests, real session restoration/expiry, cancellation and account switches. No source submission follows login alone.

`connect-mobile-ai-workflows` must persist account/collection/item/request identities before mutation, use the exact fingerprint fixtures, include `clientItemKey` on replacements, distinguish 201/200 replay/reuse, handle tombstone `sourceId: null`, and retain revision guards. Reconcile bindings after uncertain responses; poll accepted source/job IDs. Handle added terminal submission codes and the artifact options/citation fields above.

These are concrete details of the planned additive v1 contract; endpoint names and planned semantics were preserved. Dependent mobile planning/code was read but not edited in this backend-only change. Those phases must consume this document alongside the backend design before apply. No phone integration or OAuth completion is claimed here.

# Tasks

All tasks below have been implemented and verified locally. Live-provider checks and deployment remain separate from these implementation tasks. Implement in this order because later API flows depend on the shared job and data changes. See `design.md` for the API contract and migration choices, and `specs/` for acceptance scenarios.

## 1. Establish focused test support

- [x] 1.1 Add a Bun test script and test layout without changing the package manager; verify a test runs through `bun run test`.
- [x] 1.2 Add reusable stubs for authentication and external AI, memory, file, and vector services; verify tests fail if an unstubbed external call is attempted.
- [x] 1.3 Add isolated PostgreSQL test setup and teardown with a test-database guard; verify it refuses a non-test database and document its setup in the README.

## 2. Protect saved memories

- [x] 2.1 Add typed lookup and normalization of a memory's owner in `lib/mem0.ts`; verify fixtures cover the installed SDK response shape, missing owner data, and missing memories.
- [x] 2.2 Require an owner lookup in memory update and deletion services and remove direct deletion from the controller; verify two-user tests show HTTP 404 with no provider write for a foreign memory.
- [x] 2.3 Map provider lookup outages to a safe HTTP 503 response; verify missing sessions return 401 and the owner's valid update/delete still return 200/204.
- [x] 2.4 Document the memory API ownership and error behavior; verify examples match the passing route tests.

## 3. Add durable jobs and the supporting migration

- [x] 3.1 Add an additive Prisma migration for background jobs, source/workspace deletion markers, current processing-job references, message positions, and the conversation message counter; verify a fresh test database migrates and Prisma validation passes.
- [x] 3.2 Backfill stable message positions and safe summary progress from the current schema; verify an upgrade fixture with tied timestamps retains deterministic order and no message loss.
- [x] 3.3 Add transaction-aware job repositories and deduplication constraints; verify rollback leaves neither an accepted resource nor an orphan job, and simultaneous requests produce one active job.
- [x] 3.4 Add immediate delivery plus a one-minute recovery relay and startup reconciliation; verify notification failure, lost delivery acknowledgements, process restart, and recovery with a new delivery generation after an expired execution.
- [x] 3.5 Add worker leases, heartbeats, bounded backoff, final failure handling, and guarded completion; verify duplicate events, expired leases, and superseded jobs cannot overwrite current results.
- [x] 3.6 Add owner-only job status/retry controllers and routes; verify own-job success, foreign-job 404, concurrent retry deduplication, and retry without another source/artifact record.
- [x] 3.7 Document job states, delivery limits, worker registration, and recovery; verify the README recovery examples against the job tests.

## 4. Finish source creation and deletion

- [x] 4.1 Enable text/Markdown creation and use one transaction for every source row and its job; verify valid creation returns 201 with real IDs and invalid requests save nothing.
- [x] 4.2 Mark source/workspace deletions and save cleanup targets transactionally while preserving HTTP 204; verify subsequent reads, artifact selection, and retrieval immediately exclude marked records.
- [x] 4.3 Validate all bulk-delete IDs before changing any row; verify mixed owned/foreign IDs cause no partial deletion.
- [x] 4.4 Add repeatable cleanup of Pinecone vectors, chunks, uploaded PDFs, and workspace namespaces before final row removal; verify provider failures preserve recovery records and already-missing objects are treated as cleaned.
- [x] 4.5 Coordinate cleanup with active processing and cancel delayed work; verify deleting during indexing cannot republish a source or leave its text usable after deletion.
- [x] 4.6 Add live-source/current-run checks to RAG retrieval, including the documented legacy-vector path; verify orphan, failed, deleted, and superseded matches are excluded.
- [x] 4.7 Document immediate app deletion versus background storage cleanup and updated create responses; verify the documented status codes against route tests.

## 5. Correct source indexing and PDF citations

- [x] 5.1 Replace oversized-segment handling with bounded recursive splitting and shared configuration; verify 1,200-character paragraphs, long words, uninterrupted text, and normal text all respect the 1,000-character default maximum.
- [x] 5.2 Validate chunk size/overlap and preserve meaningful text with bounded overlap; verify invalid values terminate with an error and empty text produces no chunks.
- [x] 5.3 Move PDF extraction to the worker and process PDFs before the combined-text shortcut; verify existing combined text still produces page-aware chunks and an empty middle page does not renumber page 3.
- [x] 5.4 Carry page and processing-run metadata through saved chunks, vectors, retrieval, and citations; verify a cited PDF excerpt retains its correct page end to end with stubbed providers.
- [x] 5.5 Add source reprocessing and stable per-run chunk identities, replacing obsolete vectors; verify fewer-chunk reprocessing, repeated delivery, a late old worker, and an unreadable original PDF.
- [x] 5.6 Document reprocessing, current job IDs, failure states, and the re-upload message for inaccessible PDFs; verify examples match source endpoint tests.

## 6. Validate and expose workspace chat

- [x] 6.1 Replace loose chat-message records with SDK-backed validation and explicit application rules; verify `{ messages: [{}] }`, blank final user text, unsupported parts, and system messages are rejected before writes or AI calls.
- [x] 6.2 Add documented request/text limits and shared model allow-list checks; verify valid payloads pass and oversized JSON returns 413.
- [x] 6.3 Add authenticated conversation and chat controllers/routes with nested workspace parameters; verify create/list/history/delete/chat endpoints are reachable and foreign resources return 404.
- [x] 6.4 Use owned persisted history for existing conversations and stream through the current UI-message format; verify history order, citations, conversation IDs, and permitted web-search message parts.
- [x] 6.5 Handle client disconnects and pre/post-header failures correctly; verify an aborted stream does not save a completed assistant answer and a Mem0 search outage does not stop basic chat.
- [x] 6.6 Document valid chat payloads, stream errors, conversation routes, and response headers; verify examples against the route and stream tests.

## 7. Validate and expose learning artifacts

- [x] 7.1 Add post-generation semantic validators for each artifact type; verify out-of-range quiz answers, blank fields, duplicate graph IDs, and missing edge endpoints cannot become ready content.
- [x] 7.2 Validate explicit source selections and track actual source contributions under the context limit; verify empty/foreign/unready selections fail, omitted selections work, and unused/truncated sources are represented accurately.
- [x] 7.3 Add artifact create/list/get/delete/retry controllers and routes with ownership checks; verify HTTP 202 creation/retry, HTTP 200 reads, HTTP 204 deletion, and foreign-resource 404 responses.
- [x] 7.4 Connect artifact generation to durable jobs with current-job guards and deletion cancellation; verify invalid output, queue failure, source deletion, duplicate events, and retries cannot publish stale content.
- [x] 7.5 Add valid and invalid fixtures for all six artifact types and document their response shapes; verify every supported type passes its own valid fixture and rejects invalid required content.

## 8. Make summaries incremental and separate memory learning

- [x] 8.1 Use transactionally assigned message positions for inserts and stable history reads; verify simultaneous writes receive unique ordered positions.
- [x] 8.2 Read only the next unsummarized batch and apply the shared summary input/output limits; verify messages 1-8 are not resent when summarizing 9-16 and oversized backlogs are covered without skipped messages.
- [x] 8.3 Save summary text and progress atomically with a per-conversation concurrency guard; verify generation failure preserves prior progress and repeated/overlapping jobs do not regress it.
- [x] 8.4 Save summary and learned-memory jobs with successful assistant-message persistence, and remove direct Mem0 calls from chat/summary generation; verify a Mem0 failure retries only memory work without another summary AI call.
- [x] 8.5 Derive job ownership from the saved conversation, skip disabled optional memory, and cancel deleted-conversation work; verify a forged owner ID or delayed deleted-resource job never sends private content to another user's memory.
- [x] 8.6 Document summary batching, progress, and independent memory retries; verify documented examples correspond to the summary and job tests.

## 9. Align connection settings and worker setup

- [x] 9.1 Add shared validated server configuration and use `CLIENT_URL` consistently in CORS/auth trust while keeping the backend auth base URL separate; verify allowed/unconfigured origin cases and browser access to `X-Conversation-Id`.
- [x] 9.2 Add startup checks for required features and production Inngest event/signing settings; verify local development remains supported and production rejects development mode or missing required settings without exposing secret values.
- [x] 9.3 Add a secret-free `.env.example` and update README commands for development, build, migrations, worker startup, recovery, and tests; verify every command points to an existing script and no real credentials are included.

## 10. Verify the completed flows together

- [x] 10.1 Run a stubbed end-to-end flow from login/session checks through source creation, indexing, streamed chat, citations, and artifact generation; verify a second user cannot access or mutate those resources.
- [x] 10.2 Run cross-feature recovery checks for process interruption, missed events, simultaneous retries, deletion during processing, and memory failure after summary success; verify no resource is silently stranded or republished.
- [x] 10.3 Run the full automated suite, `bun run typecheck`, `bun run build`, Prisma validation, and fresh/upgrade test-database migrations; record actual results and any pending live-service checks without claiming unperformed verification.

## Verification results

Verified on 15 November 2026:

- `bun run test:db`: **48 passed, 0 failed**. The runner created and removed its own local PostgreSQL cluster, applied both migrations, built the backend, and exercised database/HTTP/worker behavior with stubbed providers.
- Fresh migration and upgrade from the initial schema both passed, including tied message timestamps and summary-position backfill.
- The suite includes a separate check against the compiled backend under the actual Node runtime for client disconnect/cancellation.
- `bun run test`: **21 passed, 0 failed** in the fast unit mode; database tests/hooks were intentionally skipped without a supplied disposable test database.
- `bun run typecheck`, `bun run build` (inside the database runner), Prisma schema validation, and `git diff --check` passed.
- Regression coverage includes foreign memory IDs, malformed chat, all six artifact schemas, chunk-size bounds, PDF pages, queue delivery/acknowledgement failure, restart/lease recovery, duplicate and superseded workers, deletion during indexing, incremental summaries, and independent memory failure.

Pending deployment checks: apply the new migration to the intended application database, verify real Google OAuth and provider credentials/permissions, and register/verify hosted Inngest workers. No normal application database migration, live paid-provider call, or deployment was performed during implementation. Test provider responses are evidence of application behavior, not proof that real service credentials work.

# Tasks

Apply order **2 of 4**, backend only. Read design.md contract v1 before editing. Existing complete-backend-fixes code/jobs/migrations are the baseline; all tasks below are pending.

## 1. Native authentication support

- [ ] 1.1 Add a version-compatible Better Auth Expo server plugin to the existing auth instance with Google only; verify plugin loading/types and no enabled password registration.
- [ ] 1.2 Add explicit tsumugu callback trust while preserving CLIENT_URL browser CORS and session checks; test accepted native/browser origins, denied redirects, expired sessions and exposed conversation headers.
- [ ] 1.3 Document separate Google-server/native-app callback setup and safe environment names in README/.env.example; verify examples match installed APIs without editing actual credentials.

## 2. Durable identity and replay foundation

- [ ] 2.1 Add an additive Prisma migration for MobileWorkspaceBinding, MobileSourceBinding, ClientSubmission, artifact options and representation-cleanup job type; test fresh/upgrade migrations preserve existing sources/chats/jobs.
- [ ] 2.2 Add bound owner-aware binding/replay repositories and serialization rules; test unique keys, deleted-target tombstones surviving hard cleanup, nullable references and foreign-account isolation.
- [ ] 2.3 Extend workspace creation with optional clientCollectionKey resolution; test concurrent/replayed creates, unchanged existing titles, deleted binding 410 and legacy create 201 behavior.
- [ ] 2.4 Add owned mobile source-binding reads and static route ordering; verify live/deleted bindings are recoverable and foreign/workspace IDs return existing safe 404 behavior.
- [ ] 2.5 Document identity fields, status/error codes and the v1 request examples in README; verify HTTP fixtures match the documented bodies and responses.

## 3. Recoverable source submissions

- [ ] 3.1 Extend mobile upload/import validators with typed item/revision metadata and Idempotency-Key; test missing/invalid metadata, URL typing, content digests and unchanged legacy request contracts.
- [ ] 3.2 Implement PDF and URL fingerprint validation plus ClientSubmission reservation/replay; test equivalent/concurrent requests return one source and conflicting key reuse returns 409 before provider work.
- [ ] 3.3 Add deterministic PDF representation targets and expired-submission recovery using the existing recovery scheduler; inject interruption before upload, after upload, after commit and before response to verify bounded recovery/cleanup.
- [ ] 3.4 Commit accepted source, job, binding and replay result together; test transaction rollback and worker-notification failure leave no false accepted source or lost committed work.
- [ ] 3.5 Preserve per-source job/status behavior and mobile pre-acceptance failures for website/transcript extraction; test no-captions/empty-page/provider-outage responses without falsely ready sources.
- [ ] 3.6 Update submission/recovery/limit documentation and focused provider-wrapper tests; verify the 10 MiB multipart file contract and safe error responses.

## 4. Content replacement and guarded removal

- [ ] 4.1 Add the mobile-bound source content replacement endpoint with expectedRevision and existing-type validation; test changed PDF/URL updates retain source/workspace/conversation IDs.
- [ ] 4.2 Guard replacement commits against stale revisions, old jobs and deleted resources; test racing replacements and late workers cannot publish superseded content.
- [ ] 4.3 Add representation-only cleanup that cannot hard-delete a live replacement source; test provider failure, unused upload cleanup and old worker cancellation using existing leases/retries.
- [ ] 4.4 Add optional revision guards to single/bulk deletion and mark source bindings deleted in the logical-delete transaction; test all-or-nothing bulk conflicts and preservation of untracked web sources.
- [ ] 4.5 Add explicit deleted-source recreation and reject ordinary replay/re-add without approval; test tombstone recovery before/after hard cleanup and same-key ambiguous failures.
- [ ] 4.6 Document Replace original upload versus Reprocess saved content and remote deletion semantics; verify endpoint fixtures cover both operations distinctly.

## 5. Collection grounding and web provenance

- [ ] 5.1 Remove account-wide memory retrieval/learning from collection chat and cancel legacy queued collection-memory work safely; test configured Mem0 cannot export/inject collection content while manual memory APIs and conversation summaries remain intact.
- [ ] 5.2 Update chat/artifact prompts for Tsumugu, untrusted source boundaries and insufficient-evidence behavior; inspect captured model inputs for two workspaces and test the empty-retrieval/web-off path.
- [ ] 5.3 Reject explicitly requested unavailable web search before saving/generating and preserve search-off behavior; test WEB_SEARCH_UNAVAILABLE and zero unexpected search-provider calls.
- [ ] 5.4 Accumulate multi-call web citations with stable distinct labels alongside collection references; test saved references resolve results from every tool call.
- [ ] 5.5 Update grounding/memory/search documentation and regression fixtures; verify no claims that user-only memory ownership satisfies collection isolation.

## 6. Artifact generation options

- [ ] 6.1 Add type-specific optional topic/count/difficulty/detail validation and persisted normalized options; test supported values, invalid combinations and unchanged legacy requests.
- [ ] 6.2 Pass saved options through generation/retry and validate exact requested counts and insufficient-topic outcomes; test all six output shapes and existing semantic/source-selection checks.
- [ ] 6.3 Document the options matrix and saved response fields; verify examples are accepted by validators and retries preserve the original requested choices.

## 7. Integrated server acceptance

- [ ] 7.1 Run the full disposable-database suite, typecheck/build, Prisma validation, strict OpenSpec and whitespace checks; record actual totals and verify compatibility with old no-mobile-field clients.
- [ ] 7.2 Exercise authenticated v1 create/replay/replace/remove/chat/artifact flows across two accounts/workspaces with controlled providers and restart/delete races; verify no cross-collection context and no duplicate accepted resources.
- [ ] 7.3 Publish the implementation's final contract and migration/rollback record for the two dependent mobile changes; identify pending real OAuth/provider/hosted-worker checks without claiming production deployment or phone acceptance.

## Workflow follow-up

- Apply any intended development-database migration as a deliberate setup action; never reset the normal database or silently deploy.
- Review/verify before archive. Continue mobile work with integrate-expo-google-auth, then connect-mobile-ai-workflows; reconcile any contract changes in their planning artifacts first.

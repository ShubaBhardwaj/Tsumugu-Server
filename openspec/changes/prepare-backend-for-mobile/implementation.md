# Implementation and verification

Implemented on 15 November 2026 within `tsumugu_server` only. The initial backend working tree was clean. Prior `complete-backend-fixes` application work and both earlier migrations were preserved. No mobile/web files, real credentials or normal application database were changed. No deployment, commit or archive was performed.

## Delivered behavior

- Better Auth Expo server plugin 1.7.23 matches locked Better Auth 1.7.23. Google remains the only provider. Native callback trust is distinct from browser CORS; explicit origin checking remains enabled.
- Durable account/collection and workspace/item bindings preserve deletion evidence. Workspace resolution is serialized, retry-safe and never renames from stale input.
- Mobile PDF/URL submissions validate fingerprints, reserve a bounded durable operation before provider work, and atomically commit source/job/binding/replay result. Uncertain accepted requests replay; conflicting or active requests return distinct safe errors. Expired unaccepted work fails visibly and schedules representation cleanup through existing recovery.
- Content replacement retains source/workspace/history identity, cancels superseded source jobs, excludes old retrieval and cleans only obsolete representations. Guarded deletion validates all revisions before changing any resource. Recreating a deleted source requires explicit consent plus a fresh operation key.
- Collection chat neither reads nor exports account-wide learned memories. Legacy collection memory jobs cancel; manual memory APIs and conversation summaries remain. Grounding prompts delimit untrusted data and require an honest insufficient-evidence answer. Explicit but unconfigured outside search fails before history writes. Multiple searches retain distinct persisted web citation labels.
- Six existing artifact formats accept only their supported normalized options, persist them separately from metadata, pass them through retry, check exact requested counts, and fail unsupported-topic evidence checks.

## Final mobile contract

The concrete contract and examples are in [docs/mobile-api-v1.md](../../../docs/mobile-api-v1.md); native configuration is in README. Endpoint names and the planned additive v1 semantics are preserved. Implementation details for dependent phases are now explicit:

- Mobile replacements also carry `clientItemKey`; source responses expose `clientItemKey`/`contentRevision` at the top level. Deleted binding reads may have a null source ID.
- Request keys/item suffixes have bounded ASCII formats. Failed unaccepted operations are terminal under that key; review and use a fresh key after reconciliation. Active operations use `Retry-After: 5`. Additional safe codes cover expired/failed preparation and unavailable/empty extraction.
- Recoverable PDFs use server-signed deterministic Cloudinary targets with overwrite disabled. Server upload/create and destroy permissions must be verified. The existing legacy unsigned-preset flow remains intact.
- Saved citations expose a `label` string, numeric for collection sources and `W` prefixed for outside sources. Artifact responses include nullable `options`.
- A pre-acceptance replacement failure leaves the prior accepted revision intact; an accepted replacement whose indexing fails stays FAILED. Mobile must distinguish these outcomes.

`integrate-expo-google-auth` and `connect-mobile-ai-workflows` must read this final contract before apply and reconcile their client types/examples. Their planning artifacts were read but left untouched to respect the user's backend-only scope. No incompatible endpoint redesign was required.

## Migration and rollback

New migration: `prisma/migrations/20261115160000_prepare_backend_for_mobile/migration.sql`. It adds MobileWorkspaceBinding, MobileSourceBinding, ClientSubmission and SubmissionStatus, nullable artifact options, indexes/FKs and the REPRESENTATION_CLEANUP job enum. Existing data is not backfilled by title/URL or dropped. Prisma client was regenerated; generated added-line whitespace was normalized for `git diff --check`.

The disposable database runner applied all three migrations to a fresh database. The upgrade fixture created old sources, conversations/messages, artifact and pending job under the previous schema, then applied the new migration and verified preservation, null legacy options and binding uniqueness. Hard-cleanup tests verify nullable source/workspace references and surviving workspace tombstones.

Apply `bunx --no-install prisma migrate deploy` only against the deliberately selected development/deployment database as a separate setup action. It has not been applied to the normal development database here. Regenerate with `bunx --no-install prisma generate` when setting up a checkout. Do not reset a database to deploy this change.

Rollback must use a compatible application build retaining logical-delete handling, bindings, tombstones, submission recovery and representation cleanup. Preserve the additive tables/column/enum. Do not run the original pre-change server as a rollback while cleanup work is unfinished; do not drop evidence or restore deleted resources to simplify rollback.

## Automated verification

Final disposable run: **74 tests passed, 0 failed**, 440 assertions across five files. `bun run test:db` created/stopped/removed only its temporary local PostgreSQL cluster. External providers were controlled and unstubbed external fetches blocked. Tests include real Better Auth signed-cookie validation for valid/expired/revoked sessions alongside controlled HTTP identities.

Verified areas include concurrent workspace resolution; same/alternate-key submissions; active requests; changed-key conflicts; PDF bytes/hash/size/type validation; safe page/transcript failures; interrupted/expired preparation; transaction rollback; missed worker notifications; replacement races and stale workers; guarded removal; explicit recreation before/after hard cleanup; foreign-account/workspace rejection; captured two-workspace model inputs; no Mem0 export/injection; empty-retrieval prompts; unavailable search before persistence; multi-call web citations; six artifact shapes/options/retries; legacy requests; Node stream cancellation and prior background-job regressions.

Passed: `bun run typecheck`, `bun run build`, `bunx --no-install prisma validate`, `openspec validate prepare-backend-for-mobile --strict`, and `git diff --check`. The final database runner also rebuilt the backend before running all tests.

## Pending live acceptance

Real Google OAuth success/cancel on an Android development build; native SecureStore/current-cookie lifecycle; production callback and browser-origin configuration; Cloudinary signed-upload/create/destroy permissions and readable PDF delivery; actual OpenAI/Pinecone/Firecrawl/transcript/Tavily behavior; and hosted Inngest registration/recovery remain unverified. Automated provider fixtures do not establish live-service success, phone integration, or model factual accuracy. Account-wide old provider memories remain stored but are unused by collection chat.

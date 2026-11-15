# Proposal

## Why

The backend implements sources, RAG, chat, artifacts, and recoverable jobs, but it lacks native Expo authentication support and a retry-safe contract for a mobile collection's changing source snapshot. Its current account-wide learned memory and general-knowledge fallback also conflict with collection-only study.

## What Changes

- Add the Better Auth Expo server plugin and explicit trust for the existing `tsumugu` callback scheme while preserving the permitted web origin and Google-only login.
- Add additive mobile workspace/source identity and request-idempotency support, including recovery after an accepted response is lost and explicit handling of deleted resources.
- Support replacing submitted PDF/URL content and conditional removal of mobile-owned sources without duplicating unchanged sources or disturbing web-created sources.
- Retain existing source endpoints and per-source jobs; publish a concrete additive integration contract consumed by the final mobile change.
- Disable account-wide memory learning/retrieval for collection chat; enforce collection-grounded answers with explicit optional web search and separately identified web citations.
- Align artifact generation options already exposed in mobile with validated backend options; keep the six artifact outputs and existing clients compatible.

## Capabilities

### New Capabilities

- `expo-auth-server`: Google session support for Expo callbacks and existing browser clients.
- `mobile-source-submissions`: stable workspace/source bindings, safe request replay, content revisions, and guarded reconciliation.
- `collection-grounding`: workspace-only answer context, honest insufficient evidence, and explicit external-search provenance.
- `artifact-generation-options`: validated topic, quantity, difficulty, and detail settings for the existing six artifacts.

### Modified Capabilities

None in the durable inventory. Extend rather than replace the completed `complete-backend-fixes` work. Its pending migration/live-service checks remain independent prerequisites.

## Impact

- Apply order **2 of 4**, before mobile authentication; backend repository only. The local-library change is logically first, but backend tests need no phone library.
- Reuse Express controllers/validators/services/repositories, Prisma/PostgreSQL, Inngest, and current providers. Add migrations; do not rewrite prior migrations or reset an application database.
- Expected areas: auth/config, workspace/source/chat/artifact services and validators, identity/replay persistence, worker cleanup, provider wrappers, tests, README and environment example.
- The contract in this change's `design.md` is the planning authority for `integrate-expo-google-auth` and `connect-mobile-ai-workflows` in `../Tsumugu/`. Any contract change must be reconciled there before apply.
- No mobile/web code changes, deployment, credential edits, full library sync, OCR, or automatic indexing on local saves. Planning only; implementation requires a later apply request.

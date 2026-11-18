# Tasks

## 1. Provider configuration and models

- [x] 1.1 Add a compatible `@ai-sdk/google` dependency and a central provider factory with OpenAI and Gemini text/embedding defaults; verify `bun install` and `bun run typecheck` succeed.
- [x] 1.2 Validate `AI_PROVIDER` and only the selected provider's key at startup; verify config tests cover default OpenAI, Gemini-only, missing key, and unknown provider without exposing credentials.
- [x] 1.3 Route chat model selection and workspace model updates through provider-specific allowlists; verify tests reject explicit wrong-provider models and safely map a stored `gpt-4o-mini` preference to the Gemini default.
- [x] 1.4 Add `AI_PROVIDER` and `GEMINI_API_KEY` placeholders to `.env.example` with a deployment note; verify the sample contains no credential and says the runtime change must be deployed first.

## 2. Embedding and source indexing

- [x] 2.1 Implement Gemini document and query embeddings at 1,536 dimensions with their respective retrieval task types; verify adapter tests cover dimensions, task types, and no OpenAI call in Gemini mode.
- [x] 2.2 Add deterministic embedding-profile namespaces while preserving legacy OpenAI workspace namespaces; verify Pinecone tests cover separation, index dimension mismatch, and profile-aware query routing.
- [x] 2.3 Stamp successful source indexing with an embedding profile, exclude mismatched sources from retrieval, and add `needsReindex` to source responses; verify tests cover legacy OpenAI sources, provider switches, successful reprocessing, and failed reprocessing.
- [x] 2.4 Update reprocessing and source/workspace cleanup to remove obsolete vectors from all known namespaces without leaving searchable stale runs; verify job and deletion tests cover both providers and same-source identity.
- [x] 2.5 Document source reprocessing and provider-switch behavior in backend setup guidance; verify the documented steps match the source API and `needsReindex` response.

## 3. Generation and failure handling

- [x] 3.1 Route streamed chat and conversation summaries through the selected text provider; verify tests show Gemini mode completes those paths without an OpenAI request and preserves saved response shapes.
- [x] 3.2 Route summary, takeaways, flashcards, quiz, mind map, report, and topic-evidence generation through the selected provider; verify artifact tests cover every type and existing saved formats.
- [x] 3.3 Map invalid-key, quota, and transient provider failures to safe job/stream outcomes with bounded retry where appropriate; verify tests show no fallback, no fabricated success, and no credential or source-text leakage.
- [x] 3.4 Document free-tier eligibility, data-handling caution, quota behavior, and the fact that OCR is still separate; verify the guidance links to current official Google documentation.

## 4. Cross-path verification

- [x] 4.1 Run `bun run typecheck` and the existing `bun test` suite after implementation; verify both pass or record and resolve any provider-related regression.
- [ ] 4.2 Exercise a disposable text-bearing source in a Gemini-only test deployment, then verify indexing, a retrieved chat answer, conversation summary, and every study artifact while OpenAI credentials are absent; record results without private source content.
- [ ] 4.3 Switch the test deployment back to OpenAI and verify Gemini vectors are never queried as OpenAI vectors and Gemini-indexed sources report `needsReindex` until reprocessed.

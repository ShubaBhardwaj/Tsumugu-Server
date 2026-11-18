# Design

## Context

The current backend uses `text-embedding-3-small` with 1,536-dimensional Pinecone vectors and OpenAI chat models. Its source vectors live in namespaces named by workspace ID. Source processing, retrieval, chat, conversation memory, and study artifact generation each reach OpenAI through different modules. `OPENAI_API_KEY` is currently required in production, and workspace model preferences may contain OpenAI model names. See the proposal for the reason for adding Gemini.

## Goals / Non-Goals

**Goals:**

- Keep the OpenAI deployment path compatible by default, including its existing Pinecone namespaces and saved workspace preferences.
- Make a Gemini-only test deployment work without an OpenAI key for both indexing and generated text.
- Make provider switches visible in source readiness without mixing embedding spaces or silently using a different provider.

**Non-Goals:**

- Per-user or per-request provider switching, automatic fallback between providers, or automatic reindexing on deployment.
- OCR for image-only PDFs, changes to authentication, or a new client-visible conversation or artifact format.

## Decisions

### Select one provider per server deployment

`AI_PROVIDER` accepts `openai` or `gemini` and defaults to `openai`. Startup validation requires `OPENAI_API_KEY` only for OpenAI or `GEMINI_API_KEY` only for Gemini. An unknown value fails startup. A single provider factory supplies the language model and embedding operations used by all AI paths. Add a compatible `@ai-sdk/google` package for Gemini text generation and embeddings; keep the current OpenAI adapter. Never retry a Gemini failure through OpenAI.

This is a server setting rather than a workspace setting because source indexes are built by background jobs and a per-workspace choice would introduce mixed-provider job and retrieval states before the backend has provider-aware persistence.

### Use a 1,536-dimensional Gemini embedding profile

Use `gemini-2.5-flash-lite` as the initial Gemini text default and `gemini-embedding-001` for embeddings, requesting `outputDimensionality: 1536`. Use retrieval-document task type when indexing chunks and retrieval-query task type for questions, and keep the same choice for every call within each path. The OpenAI defaults remain `gpt-4o-mini` and `text-embedding-3-small` at 1,536 dimensions. A provider profile identifier includes provider, model, and dimension; any future model or dimension change creates a new profile.

Matching Pinecone dimensions allow the existing index to be reused, but equal length does not make the vector spaces compatible. A second index would consume an extra index allowance and is unnecessary for isolation.

### Isolate vectors by embedding profile and workspace

Keep the existing OpenAI namespace exactly equal to `workspaceId` so deployed vectors are found as before. Use a deterministic Gemini namespace containing the Gemini profile and `workspaceId`. Source and vector metadata record the profile and successful index run. Existing READY sources with no profile stamp are treated as legacy OpenAI sources. Retrieval queries only the active namespace and checks source ownership, the active profile, and successful run identity before returning citations.

A source response adds `needsReindex`, computed from the active profile and successful source index metadata. A source can remain saved while `needsReindex` is true; clients must not offer it as searchable under the current provider. Reprocessing keeps the source ID, replaces its chunks and vectors, and stamps the new profile only after a successful index. It removes obsolete vectors from known namespaces for that source. Failure cannot stamp readiness. Source and workspace deletion clear all known provider namespaces, including legacy OpenAI. Switching back to OpenAI after Gemini reprocessing requires reprocessing again; the switch never interprets Gemini vectors as OpenAI vectors.

The alternative of using one namespace and filtering metadata is rejected because a missed filter could return incompatible vectors. The alternative of preserving all old provider indexes is deferred because the current Source and SourceChunk records represent one successful index run.

### Centralize provider-specific model rules

The provider factory owns an allowlist and default for each provider. Explicit model values supplied in chat or workspace update requests are validated against the active provider and rejected with a 400 validation error if unsupported. When a workspace has a stored model from the other provider, chat uses the active provider default at runtime; the stored preference and saved conversation history are not rewritten. Conversation summaries and all six study artifact paths use the active provider default.

### Surface provider failures without leaking credentials

Map authentication, quota/rate limit, and transient provider errors to safe application errors. Background jobs may use bounded retries for transient or rate-limited calls, but an invalid key fails without retrying indefinitely. Failed indexing must not report active-profile readiness; failed generation must not save fabricated content. Log provider, operation, and safe error category, never keys, authorization headers, or private source text.

## Risks / Trade-offs

- **Gemini model availability or free-tier quota changes** → Keep model names centralized, document that eligibility and limits vary, and verify the chosen models in a disposable test deployment before relying on them.
- **Existing Pinecone index has a different dimension** → Check its dimension before running Gemini indexing and fail with a clear configuration error rather than writing incompatible vectors.
- **Old sources appear READY in the database after a switch** → Compute `needsReindex` in source responses and exclude them from active-profile retrieval until explicitly reprocessed.
- **Reprocessing under Gemini removes the active OpenAI index** → Document that switching back requires reprocessing those sources under OpenAI.
- **Free-tier data handling may differ from paid use** → Use disposable test content and review Google's current data-use terms before submitting private user material.
- **Image-only PDFs still have no text extraction path** → Keep OCR outside this change and preserve the existing source failure behavior.

## Migration Plan

1. Add the provider abstraction, Gemini dependency, conditional configuration validation, model rules, and profile-aware vector handling. Keep `AI_PROVIDER` unset or `openai` during the first deployment.
2. Run provider-specific tests and existing OpenAI tests. Verify the existing OpenAI source/query/chat flow still uses legacy namespaces.
3. Put `GEMINI_API_KEY` and `AI_PROVIDER=gemini` in the test server's environment, deploy/restart the new code, and process a disposable text-bearing source. Verify indexing, chat, summary, and each study artifact without an OpenAI key.
4. Reprocess saved sources that report `needsReindex`. Monitor safe failures and free-tier quotas. For rollback, set `AI_PROVIDER=openai`, redeploy/restart, and reprocess sources last indexed under Gemini.

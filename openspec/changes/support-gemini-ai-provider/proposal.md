# Proposal

## Why

The backend currently requires an OpenAI key for both source embeddings and generated answers. A server-selected Gemini path will let development and test deployments use an eligible Gemini API free tier without depending on an OpenAI key.

## What Changes

- Add one explicit server-wide AI provider choice: `openai` remains the default; `gemini` uses a Gemini API key for embeddings, chat, conversation summaries, and all six study artifact types.
- Keep the existing authenticated API and saved conversation/artifact formats. Validate requested and saved model names against the selected provider, with a safe default when an old workspace stores an OpenAI model.
- Keep each provider/model embedding space isolated in Pinecone. Existing OpenAI vectors are never queried with Gemini embeddings; previously indexed sources require explicit reprocessing for Gemini and must not be presented as searchable under it until then.
- Validate the selected provider's key at startup and report provider failures safely. Do not silently fall back to a different paid provider when the Gemini free-tier quota or key fails.
- Document configuration, switching/reindexing, free-tier limits, and deployment checks. Gemini support does not add OCR; image-only PDFs still need a separate change.

## Capabilities

### New Capabilities

- `ai-provider-selection`: Server-wide model selection, provider-specific embedding isolation, and safe behavior when switching or when a provider is unavailable.

### Modified Capabilities

None. This backend has no synced baseline capability specs yet.

## Impact

- Backend AI configuration and validation, embedding adapter, Pinecone namespace handling, chat/model validators, conversation summaries, study generation, and provider-related tests.
- Adds the compatible `@ai-sdk/google` provider dependency; keeps the current OpenAI implementation available.
- Adds example settings for `AI_PROVIDER` and `GEMINI_API_KEY` in `.env.example`. The deployed server needs a new key and a redeploy/restart after implementation; updating environment variables alone cannot enable Gemini.
- Source responses gain an additive `needsReindex` indicator so mobile clients can distinguish saved sources from sources searchable under the active provider. Clients must not send an OpenAI-only model while Gemini is selected.

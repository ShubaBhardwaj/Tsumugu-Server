# Spec Delta

## Purpose

Allows a backend deployment to choose an AI provider for both generation and retrieval while preserving source ownership, saved history, and truthful indexing status.

## ADDED Requirements

### Requirement: Explicit provider configuration
The server SHALL select OpenAI or Gemini for all AI operations using one server-wide setting, default to OpenAI when unset, and require only the selected provider's key at startup.

#### Scenario: Existing deployment without provider setting
- **WHEN** the server starts with no provider selection and a valid OpenAI key
- **THEN** it uses the existing OpenAI models and behavior

#### Scenario: Gemini-only test deployment
- **WHEN** the server starts with Gemini selected and a Gemini key but no OpenAI key
- **THEN** startup succeeds without requiring OpenAI credentials

#### Scenario: Missing or unknown provider configuration
- **WHEN** the selected provider is unknown or its required key is absent
- **THEN** startup fails with a setting name and without revealing a credential

### Requirement: Consistent AI provider use
The server SHALL use the selected provider for source and query embeddings, streamed chat, conversation summaries, and every study artifact generation path without falling back to another provider.

#### Scenario: Gemini source and chat flow
- **WHEN** Gemini is selected and a text source is processed and queried
- **THEN** indexing, retrieval query embeddings, and generated chat use Gemini without an OpenAI request

#### Scenario: Gemini study generation
- **WHEN** Gemini is selected and a supported study artifact or conversation summary is generated
- **THEN** the selected Gemini text model produces the output under the existing saved schema

### Requirement: Provider-valid chat model selection
The server SHALL accept only models supported by its selected provider for explicit chat or workspace model updates and SHALL use the selected provider's default when an older workspace stores a model from another provider.

#### Scenario: Old workspace after switch
- **WHEN** Gemini is selected and a workspace still stores `gpt-4o-mini`
- **THEN** chat uses the configured Gemini default without rewriting saved conversations

#### Scenario: Wrong-provider request
- **WHEN** Gemini is selected and a client explicitly requests `gpt-4o`
- **THEN** the request is rejected with a validation error before a model call

### Requirement: Isolated embedding spaces and truthful source readiness
The server SHALL keep vectors from different embedding providers or models separate, SHALL never query old vectors with the new embedding profile, and SHALL identify existing sources that need reprocessing before they are searchable under the active profile.

#### Scenario: Switch from OpenAI to Gemini
- **WHEN** a deployment switches to Gemini while an OpenAI-indexed source remains saved
- **THEN** its old vectors remain intact, are excluded from Gemini retrieval, and the source response indicates that reindexing is needed

#### Scenario: Reprocess under Gemini
- **WHEN** an owner reprocesses that source and Gemini indexing succeeds
- **THEN** it becomes searchable under Gemini with the same source identity and its active-profile readiness is reported

#### Scenario: Roll back to OpenAI
- **WHEN** the deployment switches back to OpenAI
- **THEN** Gemini vectors are not interpreted as OpenAI vectors and sources last indexed under Gemini are marked as needing OpenAI reprocessing

### Requirement: Safe provider failures
The server SHALL surface invalid keys, quota exhaustion, and temporary provider failures as safe failed or retryable operations without logging secrets or treating unfinished indexing or generation as success.

#### Scenario: Gemini free-tier quota exhausted
- **WHEN** Gemini rejects an embedding or generation request due to a rate or quota limit
- **THEN** the affected job or stream reports failure or retryable status without an OpenAI fallback or fabricated output

#### Scenario: Invalid Gemini key
- **WHEN** Gemini rejects a configured key
- **THEN** the error does not expose the key or private source content

# Spec Delta

## Purpose

Let the app manage a user's conversations and receive streamed answers grounded in that user's workspace sources.

## ADDED Requirements

### Requirement: Conversation APIs are available within owned workspaces
The system SHALL provide conversation create, list, message-history, and delete APIs under `/api/workspaces/:workspaceId/conversations`. All operations SHALL require a session and workspace ownership.

#### Scenario: Owner manages a conversation
- **WHEN** an owner creates a conversation, lists conversations, loads its messages, and deletes it
- **THEN** creation returns HTTP 201, reads return HTTP 200, and deletion returns HTTP 204
- **AND** message history is in stable chronological order

#### Scenario: Cross-workspace or cross-user access
- **WHEN** a user supplies a workspace they do not own or a conversation from a different workspace
- **THEN** the response is HTTP 404 and no conversation data is returned or changed

#### Scenario: Missing session
- **WHEN** a conversation or chat request has no valid session
- **THEN** the response is HTTP 401

### Requirement: Chat requests contain valid messages
The system SHALL reject malformed message structures, unsupported parts, client-supplied system instructions, unsupported model values, and requests without a final user message containing nonblank text. Documented message and request-size limits SHALL be enforced before saving messages or calling AI services.

#### Scenario: Empty message object
- **WHEN** a chat request contains `messages: [{}]`
- **THEN** the response is HTTP 400 and no conversation, message, or AI request is created

#### Scenario: Supported chat payload
- **WHEN** the request contains valid user and assistant message history and a final user message with text
- **THEN** the message structure is accepted for chat processing

#### Scenario: Oversized request
- **WHEN** a request exceeds the documented request-size limit
- **THEN** the response is HTTP 413 before AI processing begins

### Requirement: Chat streams answers and identifies its conversation
The system SHALL expose `POST /api/workspaces/:workspaceId/chat`, accept an optional conversation ID, and stream the reply in the existing UI-message format. The response SHALL expose `X-Conversation-Id` to the permitted frontend.

#### Scenario: First message
- **WHEN** the owner sends a valid chat request without a conversation ID
- **THEN** a conversation is created and its ID is returned with the streamed response

#### Scenario: Continue a conversation
- **WHEN** the owner sends a valid request with an existing conversation ID from that workspace
- **THEN** the reply is associated with that conversation and uses relevant workspace context

### Requirement: Saved chat history matches successful responses
The system SHALL persist the user message and completed assistant reply with its source references. An aborted or failed reply SHALL NOT be saved as a successfully completed assistant message.

#### Scenario: Completed answer with sources
- **WHEN** the model completes an answer using retrieved material
- **THEN** the saved assistant message includes the answer and matching citation metadata

#### Scenario: Interrupted stream
- **WHEN** the client disconnects or generation fails before completion
- **THEN** no completed assistant message is recorded
- **AND** an error is communicated through the appropriate HTTP or stream response when the connection is still available

### Requirement: Optional services do not prevent basic chat
The system SHALL allow basic workspace chat when optional web search or user memory is disabled. A memory-provider outage SHALL NOT discard an otherwise valid chat request or answer.

#### Scenario: Memory search fails
- **WHEN** memory lookup is unavailable while workspace retrieval is working
- **THEN** chat continues without personal-memory context and the failure is recorded for diagnosis

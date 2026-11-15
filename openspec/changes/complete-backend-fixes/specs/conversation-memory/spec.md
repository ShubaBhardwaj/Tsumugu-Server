# Spec Delta

## Purpose

Keep long conversations useful without repeatedly summarizing old messages or making saved summaries depend on memory-service availability.

## ADDED Requirements

### Requirement: Summaries use only new messages
The system SHALL build an updated summary from the previous saved summary and messages after its saved progress position. It SHALL use stable message order and a documented input limit, splitting large backlogs into bounded batches.

#### Scenario: More messages arrive after a summary
- **WHEN** messages 1 through 8 are already summarized and messages 9 through 16 are available
- **THEN** the next summary uses the previous summary and messages 9 through 16 without resending messages 1 through 8

#### Scenario: Backlog exceeds the input budget
- **WHEN** unsummarized messages exceed one summary request's input limit
- **THEN** they are covered in ordered bounded batches without silently skipping messages

### Requirement: Summary text and progress are saved together
The system SHALL save the new summary and the last covered message position atomically. A failed generation SHALL leave the previous summary and position unchanged.

#### Scenario: Summary generation fails
- **WHEN** generation fails before the new summary is saved
- **THEN** the existing summary remains usable and the same new messages remain eligible for retry

#### Scenario: No new messages
- **WHEN** a summary job finds no messages after the saved position
- **THEN** it completes without an AI call

### Requirement: Overlapping summaries do not lose progress
The system SHALL serialize summary updates per conversation and SHALL prevent a delayed or repeated job from replacing a newer summary with an older one.

#### Scenario: Two summary requests overlap
- **WHEN** two summary jobs cover the same conversation
- **THEN** saved progress advances without duplicate coverage or regression

### Requirement: Memory learning is independent from summarization
The system SHALL save memory-learning work separately from summary work. A memory-service failure SHALL NOT undo a saved summary, fail the completed chat reply, or require another summary-generation call.

#### Scenario: Memory provider fails after a reply
- **WHEN** an assistant reply has been saved but memory learning is unavailable
- **THEN** the reply and any completed summary stay saved while only memory learning is retried

#### Scenario: Memory learning is disabled
- **WHEN** no memory provider is configured in development
- **THEN** chat and summary generation continue without creating permanently failing memory jobs

### Requirement: Background work respects conversation ownership and deletion
The system SHALL derive the conversation's owner from saved application data before learning memories. Deleted conversations or workspaces SHALL cancel pending summary and memory-learning work.

#### Scenario: Event contains another user ID
- **WHEN** a queued request contains a user ID inconsistent with the conversation owner
- **THEN** no conversation content is learned into that other user's memory

#### Scenario: Conversation was deleted
- **WHEN** a delayed summary or memory job refers to a deleted conversation
- **THEN** it finishes as cancelled without calling the AI or memory provider

# Spec Delta

## Purpose

Let workspace owners request, view, retry, and delete useful study tools whose content and source references are valid.

## ADDED Requirements

### Requirement: Learning artifacts have authenticated APIs
The system SHALL expose create, list, get, delete, and failed-generation retry operations under `/api/workspaces/:workspaceId/artifacts`. Every operation SHALL verify the session, workspace owner, and artifact's workspace.

#### Scenario: Owner requests a study tool
- **WHEN** the owner requests a supported tool using valid ready sources
- **THEN** HTTP 202 returns the artifact ID, durable job ID, and `PENDING` status
- **AND** the owner can read its later status and content

#### Scenario: Another user's artifact
- **WHEN** a user requests an artifact outside their owned workspace
- **THEN** HTTP 404 is returned without exposing or changing it

#### Scenario: Read and delete operations
- **WHEN** the owner lists or retrieves artifacts, or deletes an owned artifact
- **THEN** reads return HTTP 200 and deletion returns HTTP 204
- **AND** a deleted artifact cannot reappear after a delayed worker runs

### Requirement: Only valid selected sources are used
The system SHALL support SUMMARY, TAKEAWAYS, FLASHCARDS, QUIZ, MINDMAP, and REPORT. Explicit source selections SHALL contain only ready, nondeleted sources with text from the same workspace. Invalid selections SHALL be rejected before a generation request is saved.

#### Scenario: Source is missing or belongs elsewhere
- **WHEN** any explicitly selected source is unavailable to the workspace
- **THEN** HTTP 400 identifies the selection as invalid and no generation job is created

#### Scenario: Selected source is not ready
- **WHEN** any explicitly selected source is pending, failed, deleted, or has no usable text
- **THEN** HTTP 400 explains that the selection cannot be used

#### Scenario: Selection is omitted
- **WHEN** source IDs are omitted
- **THEN** ready, nondeleted sources with text are selected
- **AND** an empty usable selection produces HTTP 400

### Requirement: Generated tools pass content validation
The system SHALL validate generated content before marking an artifact `READY`. Quiz answer indexes SHALL refer to existing options. Mind-map IDs SHALL be unique and every edge SHALL refer to existing nodes. Required text fields SHALL be nonblank.

#### Scenario: Quiz answer points outside its options
- **WHEN** a generated question has two options and a correct-answer index of 5
- **THEN** the output is rejected and is not stored as a ready quiz

#### Scenario: Mind-map connection is broken
- **WHEN** a generated edge refers to a missing node or repeats an edge ID
- **THEN** the output is rejected and is not stored as a ready mind map

#### Scenario: Valid tool
- **WHEN** generated content satisfies its tool-specific structure and checks
- **THEN** the artifact becomes `READY` with that validated content

### Requirement: Source references describe material actually used
The system SHALL save the IDs of sources whose text was included in the model input. If the input limit excludes a source, that source SHALL NOT be reported as used. A partially included source SHALL be identified as truncated in artifact metadata.

#### Scenario: Context reaches the input limit
- **WHEN** selected material exceeds the generation input limit
- **THEN** the saved references exclude sources contributing no text and the artifact records that context was truncated

### Requirement: Failed generation is visible and retryable
The system SHALL show generation failure with a safe error message and SHALL allow the owner to retry a failed artifact without creating another artifact. Concurrent retry requests SHALL not create competing active jobs.

#### Scenario: Owner retries a failed tool
- **WHEN** the owner requests a retry for a failed artifact
- **THEN** HTTP 202 identifies the new or already-active retry job for the same artifact

#### Scenario: Source disappears before processing
- **WHEN** a previously selected source is deleted before generation begins
- **THEN** the artifact fails with an actionable message rather than silently using unrelated sources

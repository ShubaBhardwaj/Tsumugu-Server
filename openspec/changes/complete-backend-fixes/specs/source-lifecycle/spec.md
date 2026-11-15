# Spec Delta

## Purpose

Make adding and deleting study material reliable, including its saved text, AI-search copies, and uploaded PDF files.

## ADDED Requirements

### Requirement: Text and Markdown creation saves a real source
The system SHALL save valid TEXT and MARKDOWN requests in the owned workspace and create their processing job together. The existing create-source endpoint SHALL return HTTP 201 with the saved source and job identifier.

#### Scenario: Owner adds text
- **WHEN** the owner submits a valid title and nonblank TEXT content
- **THEN** a real source ID and `PENDING` status are returned and a recoverable processing job exists

#### Scenario: Owner adds Markdown
- **WHEN** the owner submits valid MARKDOWN content
- **THEN** the original Markdown is saved and the same processing flow is requested

#### Scenario: Invalid content or ownership
- **WHEN** content is blank or the user does not own the workspace
- **THEN** the response is HTTP 400 or HTTP 404 respectively and neither a source nor a job is created

### Requirement: Deleted material becomes unavailable immediately
The system SHALL preserve existing successful HTTP 204 deletion responses. After accepting a source or workspace deletion, it SHALL hide the deleted resources from reads, chat retrieval, and new artifact generation, even while external cleanup is pending.

#### Scenario: Source still has search vectors
- **WHEN** a source is deleted but its external vectors have not yet been removed
- **THEN** its text is excluded from all new retrieval results and citations

#### Scenario: Workspace deletion
- **WHEN** the owner deletes a workspace
- **THEN** its sources, conversations, and artifacts are no longer accessible through the API

### Requirement: Related copies are cleaned up reliably
The system SHALL retain enough information to remove deleted source chunks, source vectors, and any uploaded PDF. Workspace deletion SHALL also remove its vector namespace. Cleanup failures SHALL remain recoverable and SHALL NOT make deleted resources visible again.

#### Scenario: Cleanup provider is temporarily unavailable
- **WHEN** vector or file deletion fails after a deletion request was accepted
- **THEN** cleanup is retried from a durable record and the source stays unavailable

#### Scenario: Cleanup is repeated
- **WHEN** the same cleanup runs again after some copies were already removed
- **THEN** missing copies are treated as already cleaned and the remaining cleanup continues

### Requirement: Processing cannot restore a deleted resource
The system SHALL cancel or safely finish active processing before final cleanup. Late workers SHALL NOT restore deleted rows, ready status, vectors, or usable artifacts.

#### Scenario: Delete during indexing
- **WHEN** a source is deleted while an indexing job is running
- **THEN** new answers exclude it immediately and cleanup removes any vectors written by that job before cleanup completes

### Requirement: Bulk deletion verifies the whole selection
The system SHALL verify ownership and membership of every requested source before accepting a bulk deletion. An invalid selection SHALL NOT partially delete otherwise valid sources.

#### Scenario: Mixed valid and invalid IDs
- **WHEN** a bulk-delete request includes an unavailable or foreign source
- **THEN** the request is rejected and none of the selected sources are marked deleted

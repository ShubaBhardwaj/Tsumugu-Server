# Spec Delta

## Purpose

Let an owned mobile collection submit and update its sources reliably without duplicating work after interrupted requests or deleting unrelated web-managed sources.

## ADDED Requirements

### Requirement: Workspace identity is stable for a client binding
An authenticated client SHALL be able to create or recover its workspace by an account-scoped stable binding key. Replay SHALL return the same live workspace without title matching or automatic title changes. A deleted binding target SHALL require explicit recreation.

#### Scenario: Creation response is lost
- **WHEN** a client retries workspace creation with the same key after the server committed it
- **THEN** the same owned workspace is returned without a second workspace

#### Scenario: Workspace was deleted
- **WHEN** the same key identifies a previously deleted workspace
- **THEN** a deleted-resource response is returned instead of silently rebuilding it

### Requirement: Mobile source submission has replay protection
PDF and supported URL submissions SHALL accept stable client-item and content-revision identities with an idempotency key. Repeated or concurrent equivalent requests SHALL resolve to one accepted source/job. Reusing a key for different input SHALL be rejected.

#### Scenario: Duplicate upload request
- **WHEN** two equivalent requests submit the same item and revision
- **THEN** one source identity and current job are returned without duplicate saved sources

#### Scenario: Conflicting replay
- **WHEN** a previously used idempotency key is supplied with changed content
- **THEN** HTTP 409 identifies the conflict without overwriting the accepted content

### Requirement: Source revisions can be replaced explicitly
The owner SHALL be able to replace a source's PDF bytes or saved URL content using an expected prior revision. Replacement SHALL preserve source identity and workspace history, invalidate obsolete retrieval, and expose processing/failure state. Older requests SHALL NOT overwrite a newer revision.

#### Scenario: Phone original changed
- **WHEN** a new PDF revision is submitted with the matching prior revision
- **THEN** the new bytes are processed under the existing source ID and old chunks cannot be retrieved as the new revision

#### Scenario: Concurrent revision conflict
- **WHEN** replacement specifies a prior revision that is no longer current
- **THEN** HTTP 409 requires reconciliation and no newer source content is overwritten

### Requirement: Reconciliation is limited to the client's known sources
The server SHALL expose mobile identity/revision fields for owned source recovery. Conditional removal SHALL verify workspace membership and the expected revision. An absent client item SHALL NOT authorize deletion of a web-created source or an untracked mobile source.

#### Scenario: Source added on web
- **WHEN** a mobile Analyze update removes a formerly submitted phone item
- **THEN** only its explicitly identified source is removed and a separate web-created source remains usable

#### Scenario: Remote source changed
- **WHEN** a removal uses an obsolete expected revision
- **THEN** the removal is rejected without deleting current content

### Requirement: Source transport retains existing compatibility
Existing clients without mobile identity fields SHALL retain their successful API contracts. Mobile PDF uploads SHALL remain limited to one PDF of at most 10 MiB per request. Readiness SHALL distinguish accepted work from completed processing and safe failures.

#### Scenario: Legacy text source
- **WHEN** an existing client submits a valid TEXT source without mobile metadata
- **THEN** the existing create/status/job behavior remains available

#### Scenario: Invalid mobile upload
- **WHEN** a mobile upload is oversized or not an allowed PDF
- **THEN** it is rejected before indexing and no ready source is claimed

### Requirement: External representations remain recoverable
Interrupted or failed submission/replacement SHALL preserve enough information to recover accepted work and clean up unused uploaded representations. Provider failures SHALL NOT leave an unbounded invisible in-progress operation or republish stale/deleted content.

#### Scenario: Process stops after provider upload
- **WHEN** the process stops between an external PDF upload and final source acceptance
- **THEN** the saved operation can resume or schedule cleanup without creating another accepted source

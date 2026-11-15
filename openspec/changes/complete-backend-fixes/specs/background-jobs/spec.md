# Spec Delta

## Purpose

Keep accepted background work recoverable when notifications fail, the server restarts, or a job is delivered more than once.

## ADDED Requirements

### Requirement: Accepted work has a durable job record
The system SHALL save a source or artifact request and its background job in one database transaction. Accepting the request SHALL NOT depend on immediate notification delivery. The response SHALL identify the saved job.

#### Scenario: Notification service is unavailable
- **WHEN** the database accepts a source or artifact request but immediate event delivery fails
- **THEN** the request remains saved with recoverable pending work and the response identifies that work

#### Scenario: Database transaction fails
- **WHEN** the request and its job cannot both be saved
- **THEN** neither is committed as an accepted request

### Requirement: Undelivered and interrupted jobs are recovered
The system SHALL retry pending notifications with a bounded delay and recover interrupted jobs after their worker lease expires. Restarting the server SHALL NOT lose accepted work. Exhausted retries SHALL produce a visible failed state with a safe reason.

#### Scenario: Process stops before sending the event
- **WHEN** a request commits and the process stops before notifying the worker
- **THEN** a later recovery pass discovers the job and delivers it

#### Scenario: Worker stops during processing
- **WHEN** a worker stops without completing or renewing its lease
- **THEN** the job becomes eligible for recovery without remaining processing forever

#### Scenario: Delivery keeps failing
- **WHEN** event delivery exhausts the documented retry policy
- **THEN** the job and its source or artifact show a retryable failure rather than an unexplained pending state

### Requirement: Duplicate and stale events cannot duplicate results
The system SHALL recognize the saved job identity and current processing run before work begins or commits. Completed, cancelled, or superseded jobs SHALL NOT overwrite current results or create duplicate application records.

#### Scenario: Accepted event is delivered twice
- **WHEN** two deliveries refer to one job
- **THEN** only one active worker may commit that job's results

#### Scenario: Old job runs after a retry
- **WHEN** a newer retry has replaced a failed processing run
- **THEN** the older job cannot mark the resource ready or replace the newer output

### Requirement: Owners can inspect and retry their jobs
The system SHALL provide authenticated job status and retry operations. Only the recorded owner SHALL see a job's safe status or request its retry. Retrying a failed source or artifact job SHALL reuse the original source or artifact.

#### Scenario: Retry after delivery failure
- **WHEN** the owner retries a failed processing job
- **THEN** HTTP 202 returns the new or existing active job without creating another source or artifact

#### Scenario: Another user's job
- **WHEN** a user supplies a job ID belonging to another user
- **THEN** HTTP 404 is returned and the job is unchanged

### Requirement: Deletion cleanup survives resource removal
The system SHALL retain cleanup targets and ownership until external deletion completes. Removing or hiding the parent resource SHALL NOT cascade away its unfinished cleanup record.

#### Scenario: Workspace no longer appears in the API
- **WHEN** workspace deletion has been accepted and external cleanup is still pending
- **THEN** the saved cleanup job remains available for recovery until its copies are removed

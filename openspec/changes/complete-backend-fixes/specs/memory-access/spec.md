# Spec Delta

## Purpose

Protect each person's saved memories so only their owner can change or delete them through Tsumugu.

## ADDED Requirements

### Requirement: Memory changes require a signed-in user
The system SHALL require a valid session for listing, creating, updating, and deleting memories.

#### Scenario: Request without a session
- **WHEN** a request reaches a memory endpoint without a valid session
- **THEN** the response is HTTP 401 and no memory is changed

### Requirement: Only the owner can update a memory
The system SHALL verify the memory's owner against the signed-in user before updating it. Missing memories, unknown ownership, and another user's memories SHALL receive the same HTTP 404 response.

#### Scenario: Owner updates their memory
- **WHEN** a signed-in user updates a memory belonging to them with valid text
- **THEN** the updated memory is returned with HTTP 200

#### Scenario: Another user supplies the memory ID
- **WHEN** a signed-in user supplies the ID of another user's memory
- **THEN** the response is HTTP 404 and the memory remains unchanged

#### Scenario: Ownership is absent
- **WHEN** a memory record has no verifiable owner
- **THEN** the update is rejected and no write is sent to the memory provider

### Requirement: Only the owner can delete a memory
The system SHALL verify ownership before deletion and SHALL return HTTP 204 only after the owned memory is deleted.

#### Scenario: Owner deletes their memory
- **WHEN** a signed-in user deletes a memory belonging to them
- **THEN** the response is HTTP 204 and that memory is removed

#### Scenario: Another user tries deletion
- **WHEN** a signed-in user tries to delete another user's memory or a nonexistent memory
- **THEN** the response is HTTP 404 and no deletion is sent to the memory provider

### Requirement: Failed ownership checks do not permit a write
The system SHALL reject a memory change if the ownership lookup fails. It SHALL return a clear service-unavailable response without exposing credentials or another user's content.

#### Scenario: Memory provider is unavailable
- **WHEN** the provider cannot return the memory needed to check ownership
- **THEN** the response is HTTP 503 and no update or deletion is attempted

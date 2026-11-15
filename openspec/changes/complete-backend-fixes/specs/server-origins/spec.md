# Spec Delta

## Purpose

Make frontend access and background-worker setup consistent, understandable, and safe to configure without exposing secrets.

## ADDED Requirements

### Requirement: Login and API access agree on the frontend
The system SHALL use the same configured frontend origin for credentialed API access and authentication trust. The authentication base URL SHALL continue to identify the backend, independently of the frontend origin.

#### Scenario: Configured frontend calls the backend
- **WHEN** a request comes from the configured frontend origin
- **THEN** API access and authentication apply a consistent allowed-origin policy

#### Scenario: Unexpected frontend origin
- **WHEN** a request comes from an unconfigured origin
- **THEN** credentialed browser access is not allowed and authentication does not trust that origin

#### Scenario: Browser reads the conversation ID
- **WHEN** the permitted frontend receives a streamed chat reply
- **THEN** it can read the `X-Conversation-Id` response header

### Requirement: Production worker configuration is explicit
The system SHALL reject production startup when development worker mode is enabled or required event-delivery and signature-verification settings are missing. Development mode SHALL have a documented local worker startup procedure.

#### Scenario: Development mode is used in production
- **WHEN** production startup detects local worker development mode
- **THEN** startup fails with a clear configuration error before accepting requests

#### Scenario: Production signing settings are absent
- **WHEN** production startup lacks required worker signing or event-delivery configuration
- **THEN** startup fails and identifies the missing setting by name without printing its secret value

### Requirement: Missing feature configuration has clear behavior
The system SHALL identify missing settings for required features at startup. Optional web search and memory learning SHALL have documented disabled behavior. User requests SHALL NOT receive provider credentials or raw sensitive configuration in errors.

#### Scenario: Optional service is disabled
- **WHEN** optional memory or web-search settings are absent in development
- **THEN** basic chat remains available and the disabled behavior is documented

### Requirement: Setup instructions match the application
The project SHALL provide a secret-free environment example and instructions for installation, development, building, migrations, worker registration, job recovery, and automated tests using the existing package manager.

#### Scenario: New developer follows setup instructions
- **WHEN** a developer follows the README with their own test-service settings
- **THEN** the documented commands point to existing scripts and distinguish local startup from production startup

#### Scenario: Environment example is inspected
- **WHEN** the example configuration is opened
- **THEN** it contains variable names and safe placeholders without real credentials

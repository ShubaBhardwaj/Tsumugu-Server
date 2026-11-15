# Spec Delta

## Purpose

Allow the Android app to establish the same owned backend sessions as the web client through Google's existing authentication provider.

## ADDED Requirements

### Requirement: Google authentication supports the native callback
The server SHALL support the configured Tsumugu native callback scheme and the existing allowed web frontend. Google SHALL remain the sole account creation/sign-in provider; adding native support SHALL NOT enable password registration.

#### Scenario: Native Google callback
- **WHEN** an allowed Android Google flow completes
- **THEN** the callback can return to the app and establish a valid server session

#### Scenario: Existing web login
- **WHEN** the configured browser frontend signs in with Google
- **THEN** existing cookie authentication and permitted browser access continue to work

### Requirement: Authentication trust is explicit
The server SHALL distinguish allowed browser origins from native callback destinations and reject untrusted redirects. Production SHALL NOT trust arbitrary origins or development-only Expo wildcard callbacks.

#### Scenario: Untrusted callback
- **WHEN** authentication receives an unapproved callback scheme or origin
- **THEN** it refuses that destination without weakening session or origin checks

### Requirement: Protected APIs accept only valid sessions
Valid native session credentials SHALL authorize the same owner-checked API routes as browser sessions. Missing, revoked, expired, or foreign credentials SHALL NOT authorize AI operations.

#### Scenario: Native API request
- **WHEN** a native client sends its valid session to an owned workspace endpoint
- **THEN** the endpoint returns the owned resource using the existing authorization rules

#### Scenario: Expired session
- **WHEN** the same request uses an expired session
- **THEN** it returns HTTP 401 without source processing or AI generation

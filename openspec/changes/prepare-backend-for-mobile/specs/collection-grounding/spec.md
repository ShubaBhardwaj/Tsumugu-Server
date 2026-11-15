# Spec Delta

## Purpose

Keep study answers grounded in the active workspace and distinguish an explicit search of outside websites from the collection's submitted sources.

## ADDED Requirements

### Requirement: Study context never crosses workspaces
Collection chat SHALL use only authorized active-workspace sources and that conversation's own history/summary. Account-wide learned study memory SHALL NOT be searched, injected, or learned by collection chat until workspace isolation is implemented.

#### Scenario: Same user has two subjects
- **WHEN** a student asks an Operating Systems question after a DBMS conversation
- **THEN** DBMS sources and learned study facts are absent from the Operating Systems model context

#### Scenario: Memory provider is configured
- **WHEN** a collection chat completes while account-wide memory credentials exist
- **THEN** it does not create cross-collection learning work or inject account-wide memories

### Requirement: Missing collection evidence is stated honestly
With external search off, factual study answers SHALL be supported by the active workspace's submitted sources and own conversation context. Insufficient evidence SHALL produce a clear limitation rather than a general-knowledge answer represented as source-grounded.

#### Scenario: Nothing relevant retrieved
- **WHEN** a student asks a question unsupported by the collection and web search is off
- **THEN** the response explains insufficient material and invents neither an answer attributed to documents nor citations

### Requirement: Outside search requires explicit enablement
External web search SHALL run only when requested explicitly and available. Saved website-source ingestion SHALL NOT enable outside search. An enabled-but-unavailable search SHALL have a truthful client-visible result.

#### Scenario: Saved article exists
- **WHEN** a workspace contains a website source and a chat request does not enable web search
- **THEN** only submitted source context and owned conversation context are used without outside search

#### Scenario: Search is unavailable
- **WHEN** the client explicitly enables search but the optional service is disabled
- **THEN** the response indicates unavailability before generation instead of silently claiming that search was performed

### Requirement: Citation references retain their provenance
Completed answers SHALL retain distinguishable collection and outside-web references. Multiple web searches within one answer SHALL preserve stable, noncolliding labels and all referenced results. Source excerpts SHALL be treated as data rather than permission-changing instructions.

#### Scenario: Two searches in one answer
- **WHEN** an answer cites results from two tool calls
- **THEN** its saved citation list identifies results from both calls and each displayed label resolves consistently

#### Scenario: Malicious source instructions
- **WHEN** retrieved text asks the assistant to ignore collection boundaries
- **THEN** it does not authorize another workspace, enable outside search, or change ownership rules

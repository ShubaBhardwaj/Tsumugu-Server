# Spec Delta

## Purpose

Prepare searchable document pieces with predictable sizes and correct page references, including when processing is retried.

## ADDED Requirements

### Requirement: Every chunk respects the configured size
The system SHALL split oversized paragraphs, sentences, words, and uninterrupted text until every nonempty chunk fits the configured maximum. The size SHALL be a positive integer and overlap SHALL be an integer from zero up to, but excluding, the size.

#### Scenario: Oversized paragraphs
- **WHEN** two 1,200-character paragraphs are processed with a 1,000-character maximum
- **THEN** every returned chunk is at most 1,000 characters and no meaningful source text is lost

#### Scenario: Invalid overlap
- **WHEN** overlap equals or exceeds the chunk size
- **THEN** processing rejects the configuration without entering a loop

#### Scenario: Empty input
- **WHEN** source text contains only whitespace
- **THEN** no chunks are generated and the source cannot become ready

### Requirement: PDF chunks retain their original page numbers
The system SHALL preserve one-based PDF page numbers in searchable chunks and citation metadata. Existing combined text SHALL NOT cause PDF page extraction to be skipped. Empty pages SHALL NOT renumber later pages.

#### Scenario: Upload already extracted combined text
- **WHEN** a PDF has saved combined text and an available original file
- **THEN** processing obtains its page boundaries and stores the correct page number with every PDF chunk

#### Scenario: Empty middle page
- **WHEN** a three-page PDF has an empty second page
- **THEN** text from the last page is labeled page 3

#### Scenario: Original PDF cannot be read
- **WHEN** page boundaries cannot be obtained from the original PDF
- **THEN** processing reports a clear failure instead of inventing page numbers

### Requirement: Reprocessing replaces the previous search index
The system SHALL allow the owner to request source reprocessing. It SHALL remove obsolete vectors, preserve the source ID, and expose only chunks from the current successful processing run. Repeated delivery of one job SHALL NOT create duplicate chunks or competing results.

#### Scenario: Source now produces fewer chunks
- **WHEN** a source is reprocessed into fewer chunks than its earlier run
- **THEN** retrieval contains no leftover chunks from the earlier run

#### Scenario: Duplicate event
- **WHEN** the same processing job is delivered more than once
- **THEN** it produces one final chunk set and one final ready state

#### Scenario: Old worker finishes late
- **WHEN** a superseded worker attempts to finish after a newer run was requested
- **THEN** its output cannot replace or become visible alongside the newer run's output

### Requirement: Processing failures have useful status
The system SHALL expose `PENDING`, `PROCESSING`, `READY`, or `FAILED` with safe failure details and the current job ID. A failed or incomplete run SHALL NOT supply material to chat retrieval.

#### Scenario: Embedding or indexing fails
- **WHEN** processing exhausts its retry policy without completing
- **THEN** the source becomes `FAILED`, its error is visible to the owner, and the owner can request a retry

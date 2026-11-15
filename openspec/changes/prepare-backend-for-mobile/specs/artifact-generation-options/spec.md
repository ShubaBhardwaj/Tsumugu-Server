# Spec Delta

## Purpose

Make study-tool generation honor supported user choices while retaining the existing six artifact formats and validated source boundaries.

## ADDED Requirements

### Requirement: Supported artifact options are accepted and saved
Artifact requests SHALL support a bounded optional topic, flashcard/quiz count and difficulty, and summary/takeaway detail level. Unsupported type-option combinations SHALL be rejected before generation. Accepted options SHALL persist through retry and be visible with the saved artifact.

#### Scenario: Ten medium quiz questions
- **WHEN** the owner requests a quiz with count 10 and medium difficulty
- **THEN** the generation request and saved result identify those choices and a ready quiz contains exactly ten valid questions

#### Scenario: Invalid count
- **WHEN** a requested count lies outside the supported values
- **THEN** HTTP 400 rejects it without an artifact or job

### Requirement: Existing artifact clients remain compatible
Omitting options SHALL preserve the existing request contract and type-specific defaults. SUMMARY, TAKEAWAYS, FLASHCARDS, QUIZ, MINDMAP, and REPORT SHALL retain their existing output shapes and source-validation rules.

#### Scenario: Old request shape
- **WHEN** an owner submits only type and valid sourceIds
- **THEN** the request remains valid and produces the existing type-specific content format

### Requirement: Options do not authorize unrelated material
Topic and difficulty choices SHALL NOT broaden source access or permit invented collection evidence. Generated outputs SHALL pass semantic validation and the requested count check before becoming ready.

#### Scenario: Requested topic lacks support
- **WHEN** a selected topic is unsupported by the selected ready sources
- **THEN** the tool reports an actionable insufficient-material failure rather than inventing content or silently using another workspace

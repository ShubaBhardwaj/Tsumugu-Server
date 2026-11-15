# Proposal

## Why

Tsumugu already has much of its backend logic, but some features cannot be reached by the app and several flows can save incorrect data, expose another user's memory, or leave work stuck. This change completes the seven fixes from the backend review so users can safely add material, ask questions, and generate study tools.

## What Changes

1. **Protect saved memories.** Check that a memory belongs to the signed-in user before changing or deleting it.
2. **Connect the existing features to the app.** Add authenticated APIs for conversations, streamed chat, and learning artifacts such as quizzes and flashcards.
3. **Finish adding and deleting sources.** Enable text and Markdown creation. Hide deleted sources immediately and reliably remove their database chunks, search vectors, and uploaded files.
4. **Process documents correctly.** Keep chunks within the chosen size, preserve PDF page numbers, and safely rebuild an old index when a source is reprocessed.
5. **Check data before using or saving it.** Reject malformed chat messages, invalid quiz answers, broken mind-map connections, and invalid source selections.
6. **Summarize only new chat messages.** Use the previous summary with a bounded batch of new messages. Retry memory saving separately so a memory-service failure does not regenerate a successful summary.
7. **Recover missed background jobs and align connection settings.** Save each job in PostgreSQL with the request, retry missed notifications, expose failed-job retry actions, and use the same frontend origin for CORS and login.

Add focused automated tests and update setup instructions. This proposal authorizes planning only; implementation and deployment are separate work.

## Capabilities

### New Capabilities

There are no existing OpenSpec capability specs. These new specs describe the behavior being completed, including behavior that already has partial code:

- `memory-access`: Only the owner can change or delete a saved memory.
- `workspace-chat`: Authenticated conversation APIs and validated streaming chat.
- `learning-artifacts`: Authenticated study-tool APIs and valid generated content.
- `source-lifecycle`: Text/Markdown creation, deletion, and cleanup of related data.
- `source-indexing`: Bounded chunks, PDF page citations, and safe reprocessing.
- `conversation-memory`: Incremental summaries and separately retried memory learning.
- `background-jobs`: Durable job records, delivery recovery, and safe retries.
- `server-origins`: Consistent frontend access settings and clear worker setup.

### Modified Capabilities

None. The project currently has no durable capability specs to modify.

## Impact

- Reuse Express routes, controllers, services, repositories, Prisma/PostgreSQL, Inngest, Pinecone, Cloudinary, OpenAI, and Mem0. Keep Bun as the package manager and test runner.
- Add chat and artifact APIs; preserve existing workspace, source, and memory URLs and their successful response codes. Invalid requests and unauthorized access will be rejected consistently.
- Plan a database migration for durable job records, deletion markers, and stable message positions. Do not edit or run migrations during this proposal.
- Add tests and a secret-free environment example; update the README. Do not change real credentials, frontend code, hosting, providers, model choices, or billing settings.

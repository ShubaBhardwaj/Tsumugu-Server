# Tsumugu backend

Express/TypeScript, Prisma/PostgreSQL, Better Auth, Inngest, OpenAI, Pinecone, Cloudinary, Firecrawl, and optional Tavily/Mem0. Bun is the package manager. Business logic stays in services; controllers validate input and repositories handle saved data.

## Local setup

1. Run `bun install`.
2. Copy `.env.example` to your own `.env` and supply your development settings. Never commit real keys.
3. Run `bunx --no-install prisma generate`, then `bunx --no-install prisma migrate deploy` against your intended development database.
4. Run `bun run dev`.
5. Run `bunx inngest-cli@latest dev -u http://localhost:8080/api/inngest` in another terminal. The CLI download is needed only for local worker development. Use your configured port if it differs.

`CLIENT_URL` is the frontend origin, defaulting to `http://localhost:3001` in development. `BETTER_AUTH_URL` is the backend auth base URL; do not use it as the frontend origin. Google sign-in and API sessions use Better Auth cookies. Protected endpoints require a valid session. Cross-user or wrong-workspace records return 404; missing sessions return 401.

Production uses `bun run build` and `bun run start`. Set `NODE_ENV=production`, explicit `CLIENT_URL`, Inngest event/signing keys, and all enabled core provider settings. Production rejects `INNGEST_DEV=true`. Register `/api/inngest` with the production Inngest environment. The two registered functions execute jobs and recover pending work once a minute. Do not deploy the old server over the new schema's marked-deleted records; see the change design's migration/rollback instructions.

## APIs

Workspace base: `/api/workspaces/:workspaceId`.

| Method/path                                     | Success                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `GET/POST /api/workspaces`                      | 200 list / 201 create                                      |
| `GET/PATCH/DELETE /api/workspaces/:workspaceId` | 200 read/update / 204 delete                               |
| `GET/POST /sources`                             | 200 list / 201 saved source with `jobId`                   |
| `GET/DELETE /sources/:sourceId`                 | 200 read / 204 delete                                      |
| `POST /sources/upload`                          | 201 PDF; multipart field `file`, maximum 10 MiB            |
| `POST /sources/import/website`                  | 201; JSON `url` and optional `title`                       |
| `POST /sources/import/youtube`                  | 201; JSON `url` and optional `title`                       |
| `POST /sources/bulk-delete`                     | 204; JSON `sourceIds`; all IDs checked before changing any |
| `POST /sources/:sourceId/reprocess`             | 202, same source and new/active `jobId`                    |
| `GET/POST /conversations`                       | 200 list / 201 create; optional `title`                    |
| `GET /conversations/:conversationId/messages`   | 200, stable ordered history and saved citations            |
| `DELETE /conversations/:conversationId`         | 204; pending conversation jobs cancelled                   |
| `POST /chat`                                    | 200, AI SDK UI-message stream with `X-Conversation-Id`     |
| `GET/POST /artifacts`                           | 200 list / 202 accepted with artifact ID and `jobId`       |
| `GET/DELETE /artifacts/:artifactId`             | 200 read/status / 204 delete                               |
| `POST /artifacts/:artifactId/retry`             | 202, same artifact with new/active job                     |
| `GET /api/jobs/:jobId`                          | 200, owner's safe job status                               |
| `POST /api/jobs/:jobId/retry`                   | 202, failed-job retry; reuses the source/artifact          |
| `GET/POST /api/memory`                          | 200 list / 201 create; JSON `memory`                       |
| `PATCH/DELETE /api/memory/:memoryId`            | 200 update / 204 delete after owner lookup                 |

Memory ownership comes from the provider's saved owner, never editable metadata. A foreign, missing, or unverifiable memory returns 404. A failed provider lookup returns 503 and sends no update/deletion.

Text source example:

```json
{
  "type": "TEXT",
  "title": "Biology",
  "content": "Cells are the basic units of life."
}
```

Use `MARKDOWN` for Markdown content. Source status progresses through `PENDING`, `PROCESSING`, `READY`, or `FAILED`. Read the source's `jobId` for progress and safe errors. The worker extracts PDF pages, splits text into at most 1,000-character pieces (100-character overlap), generates embeddings, and indexes the current run. An inaccessible original PDF fails with a re-upload/retry message. Reprocessing keeps the source ID and replaces obsolete chunks. Existing ready legacy vectors are checked against live sources until reprocessed.

Chat example:

```json
{
  "messages": [
    {
      "id": "user-message-1",
      "role": "user",
      "parts": [{ "type": "text", "text": "Explain the main concept" }]
    }
  ],
  "model": "gpt-4o-mini",
  "webSearch": false
}
```

Send the returned conversation ID as `conversationId` to continue. Supported models remain `gpt-4o-mini` and `gpt-4o`. UI messages require IDs, user/assistant roles, and supported parts. Text, step boundaries, and validated `tool-web_search` assistant parts are supported. The final message must be user text. The server uses owned persisted history, not submitted assistant text, as authoritative history. Limits: 256 KiB JSON body, 100 UI messages, 8,000 text characters per message. Malformed data returns 400; oversized JSON returns 413 before AI calls. The permitted browser can read `X-Conversation-Id`. Failures after streaming begins are stream errors; interrupted answers are not saved as complete.

Artifact example:

```json
{ "type": "QUIZ", "title": "Cell quiz", "sourceIds": ["your-ready-source-id"] }
```

Types: `SUMMARY` (`markdown`), `TAKEAWAYS` (`items`), `FLASHCARDS` (`cards` with `front/back`), `QUIZ` (`questions` with `question/options/correctIndex/explanation`), `MINDMAP` (`nodes/edges`), and `REPORT` (`markdown/sections`). Quiz indexes start at zero and must point to an existing option. Graph IDs are unique and edge endpoints must exist. Required text is nonblank. Invalid generated output cannot become ready content. Omit `sourceIds` for all usable ready sources; an explicit empty/invalid selection returns 400. Saved references include only source text actually sent to the model; metadata records input truncation at the 120,000-character context limit.

## Deletion and recovery

Successful deletion still returns 204. The resource disappears from reads and new AI retrieval immediately. Durable cleanup then removes search vectors, chunks, and uploaded PDFs, waiting for active processing to acknowledge cancellation. Provider failures retain the cleanup record for retry. Existing separately generated artifacts are retained when just a source is deleted; deleting a whole workspace removes its artifacts and conversations too.

Every accepted source/artifact request is saved together with its job in one database transaction. A missed worker notification does not lose the request. Jobs use `PENDING`, `DISPATCHED`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `CANCELLED`. Startup and the minute recovery schedule recover missed notifications and expired leases. Delivery starts at a 30-second delay, doubles to a maximum of 15 minutes, and fails visibly after eight attempts. Source execution has at most four attempts, other normal jobs three. An execution has a ten-minute deadline so a hung provider cannot keep it processing forever. Cleanup waiting on cancellation does not consume the execution failure limit. Logical job IDs, delivery generations, worker leases, and current-run checks prevent stale workers from publishing results.

After repairing local worker/database setup, run `bun run jobs:recover`. The command reconciles old pending resources that lack jobs and retries due work; it does not make paid AI calls itself. Inspect a job through its owner-only status endpoint and retry failed work through its retry endpoint. An existing active retry is returned when requests race. Exactly-once external API billing is not guaranteed after an uncertain network/process failure.

## Conversation summaries and optional services

After each eight saved messages, a summary job uses the previous summary plus only messages after the saved position. Input is bounded to 24,000 characters; larger backlogs are processed in order. Summary output is at most 2,000 characters and 250 words. Text and covered position are saved together. Memory learning is a separate durable job for a completed exchange: a Mem0 outage does not regenerate a successful summary. Missing optional Mem0/Tavily settings disable their features. A transient memory-search outage allows chat to continue without personal-memory context.

## Verification

- `bun run test`: unit tests and provider guards. Database/HTTP tests are skipped unless a disposable `TEST_DATABASE_URL` is explicitly provided.
- `bun run test:db`: creates a fresh temporary local PostgreSQL cluster, applies migrations, runs all tests including upgrade fixtures and HTTP/worker flows, then stops and removes only that cluster. It never uses your normal `DATABASE_URL`. PostgreSQL binaries default to `/opt/homebrew/opt/postgresql@15/bin`; set `PG_BIN` elsewhere.
- `bun run typecheck`, `bun run build`, and `bunx --no-install prisma validate`: compiler/build/schema checks.

Tests use stubbed auth/provider responses and block unstubbed external fetches. Database guards reject remote hosts and database names outside `tsumugu_test` / `tsumugu_test_*`. Integration tests truncate their disposable database, so do not point them at a database containing wanted data. Live Google OAuth, external provider credentials/permissions, and hosted Inngest registration require separate smoke verification and are not proven by stubbed tests.

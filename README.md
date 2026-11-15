# Tsumugu Server

**Turn a collection of sources into a place to study.** Tsumugu's backend handles source ingestion, grounded chat, learning artifacts, authentication, and recoverable background work for web and mobile clients.

<p>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-API-3178C6?logo=typescript&amp;logoColor=white">
  <img alt="Bun" src="https://img.shields.io/badge/Bun-package%20manager-14151A?logo=bun&amp;logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Prisma-4169E1?logo=postgresql&amp;logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-deployment-2496ED?logo=docker&amp;logoColor=white">
</p>

> [!NOTE]
> This repository contains the **backend only**. The mobile application and its later authentication/integration work live separately.

## What it does

| Area | Capability |
| --- | --- |
| Sources | Save text and Markdown; import websites, YouTube videos, and PDFs; track processing and reprocessing. |
| Study | Chat with citations from a workspace's sources and generate summaries, takeaways, flashcards, quizzes, mind maps, and reports. |
| Accounts | Google sign-in through Better Auth, with browser sessions and an Expo-compatible native callback. |
| Reliability | Durable jobs, retries, recovery, and cleanup for interrupted processing. |
| Mobile contract | Stable collection/source bindings, idempotent submissions, content replacement, and explicit deletion semantics. |

**Stack:** Express 5, TypeScript, Prisma/PostgreSQL, Better Auth, Inngest, OpenAI, Pinecone, Cloudinary, Firecrawl, and optional Tavily/Mem0. Bun manages packages; the production build runs on Node.js. Controllers validate requests, services hold business logic, and repositories manage persistence.

## Contents

- [Run locally](#run-locally)
- [Deploy on a VPS](#deploy-on-a-vps)
- [API overview](#apis)
- [Deletion and recovery](#deletion-and-recovery)
- [Native authentication and mobile contract](#native-authentication-and-mobile-contract)
- [Verification](#verification)

## Run locally

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env` and fill in your development settings. Keep real credentials out of Git.
3. Generate the Prisma client with `bunx --no-install prisma generate`.
4. Apply migrations to the intended development database with `bunx --no-install prisma migrate deploy`.
5. Start the API with `bun run dev`. Check `http://localhost:8080/` for `{"status":"ok"}`.
6. For local background workers, run `bunx inngest-cli@latest dev -u http://localhost:8080/api/inngest` in another terminal. The CLI download is needed only for local worker development. Adjust the URL if you change `PORT`.

`CLIENT_URL` is the frontend origin, defaulting to `http://localhost:3001` in development. `BETTER_AUTH_URL` is the backend auth base URL; do not use it as the frontend origin. Google sign-in and API sessions use Better Auth cookies. Protected endpoints require a valid session. Cross-user or wrong-workspace records return 404; missing sessions return 401.

Production uses `bun run build` and `bun run start`. Set `NODE_ENV=production`, explicit `CLIENT_URL`, Inngest event/signing keys, and all enabled core provider settings. Production rejects `INNGEST_DEV=true`. Register `/api/inngest` with the production Inngest environment. The two registered functions execute jobs and recover pending work once a minute. Do not deploy the old server over the new schema's marked-deleted records; see the change design's migration/rollback instructions.

## Deploy on a VPS

The included [Dockerfile](Dockerfile) builds the API and generates the Prisma client. [Docker Compose](docker-compose.yml) loads production settings from the VPS `.env`, attaches the container to the external `proxy-network`, and checks the `/` health endpoint. At startup, the container applies pending Prisma migrations before starting Node.js. The hosted PostgreSQL URL comes from the **VPS `.env` at runtime**; the build-time URL in the Dockerfile is only a placeholder for client generation.

### First-time VPS setup

1. Install Docker and the Compose plugin on the VPS. Clone this repository into a permanent directory that the deployment SSH user can access. If the repository is private, configure the VPS to read it from GitHub.
2. Put a production `.env` in that directory, using [.env.example](.env.example) as a checklist. Set the hosted `DATABASE_URL`, public `BETTER_AUTH_URL`, frontend `CLIENT_URL`, provider credentials, and production Inngest keys there. Set `INNGEST_DEV=false`. Do not commit `.env`.
3. Ensure your reverse proxy and this Compose service use the same external Docker network, named `proxy-network` in the supplied Compose file. Route your API domain to the `tsumugu-backend` service on port `8080`.
4. Start the service from the repository directory:

   ```bash
   docker compose up -d --build --wait --wait-timeout 180
   docker compose ps
   ```

The database migration runs against the hosted database configured on the VPS. Back up production data and review new migrations before deploying schema changes. If startup fails, inspect `docker compose logs tsumugu-backend`; the container health check expects `{"status":"ok"}` from `/`.

### Automatic deployment

The [GitHub Actions workflow](.github/workflows/deploy.yml) runs on pushes to `main` and can also be started manually from the Actions tab. It SSHs into the VPS, runs `git pull --ff-only origin main`, then rebuilds and waits for the Compose service.

In this repository's **Settings → Secrets and variables → Actions**, configure:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `VPS_HOST` | VPS public IP address or hostname |
| Secret | `VPS_USER` | SSH user with access to the checkout and Docker |
| Secret | `VPS_SSH_KEY` | Complete private key corresponding to the public key installed in that user's `~/.ssh/authorized_keys` |
| Variable | `VPS_APP_DIR` | Absolute path of the repository checkout on the VPS |

Check the path with `pwd` inside the VPS checkout. Verify that the SSH user can run `git pull` and `docker compose` there. The GitHub secrets grant access to the VPS; they do **not** replace the application's `.env` on the VPS. Keep the private key out of the repository and never add it under GitHub's **Deploy keys** page.

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

After each eight saved messages, a summary job uses the previous summary plus only messages after the saved position. Input is bounded to 24,000 characters; larger backlogs are processed in order. Summary output is at most 2,000 characters and 250 words. Text and covered position are saved together. Collection chat does not search or learn account-wide Mem0 memories, even when configured. Legacy collection MEMORY jobs are cancelled; manual memory APIs and existing provider data remain available. Conversation summaries stay scoped to their own conversation.

Chat uses only active-workspace sources and owned persisted conversation context. Source excerpts and tool results are untrusted data. Missing evidence must produce an honest limitation. Outside search runs only with explicit `webSearch: true`; an unconfigured service returns 503 `WEB_SEARCH_UNAVAILABLE` before creating a conversation or saving a user turn. Completed history citations include `label`: numeric strings for collection references and `W1`, `W2`, etc. for outside web references. Labels accumulate across tool calls; outside results are not imported as sources.

## Native authentication and mobile contract

The server uses `@better-auth/expo` **1.7.23**, matching Better Auth **1.7.23**, following the [official Expo integration](https://better-auth.com/docs/integrations/expo). Google remains the sole login provider. No password registration or alternative JWT flow is enabled.

Configure the Google **web OAuth client** redirect URI as `<BETTER_AUTH_URL>/api/auth/callback/google`. This server callback is separate from the app return URL, for example `tsumugu://auth/callback`. The auth instance trusts `CLIENT_URL` and the `tsumugu` native scheme, with no arbitrary production origin or Expo wildcard. The plugin itself adds `exp://` only in development. Browser CORS retains only `CLIENT_URL`, credentials and exposed `X-Conversation-Id`; native callback schemes are not CORS origins.

The later mobile auth phase should use the Better Auth React client with `expoClient`, the existing `tsumugu` scheme, and SecureStore. For custom API requests, retrieve the current cookie using `authClient.getCookie()`, attach the `Cookie` header and use native `credentials: "omit"`. Browsers keep credentialed cookies. `BETTER_AUTH_URL` must be reachable from the phone and match the OAuth setup; a phone's localhost is not the development computer. Only the API base URL belongs in mobile public configuration. Live Google login/cancellation and phone cookie handling remain separate verification gates.

See [Mobile API contract v1](docs/mobile-api-v1.md) for exact identity fields, fingerprint fixtures, request/response examples, errors, replacement/recreation semantics and the artifact options matrix. The same endpoints continue to accept legacy requests without mobile metadata. Mobile Analyze is client orchestration over per-source jobs, not a new batch endpoint. It must occur only after the user's explicit consent.


## Verification

- `bun run test`: unit tests and provider guards. Database/HTTP tests are skipped unless a disposable `TEST_DATABASE_URL` is explicitly provided.
- `bun run test:db`: creates a fresh temporary local PostgreSQL cluster, applies migrations, runs all tests including upgrade fixtures and HTTP/worker flows, then stops and removes only that cluster. It never uses your normal `DATABASE_URL`. PostgreSQL binaries default to `/opt/homebrew/opt/postgresql@15/bin`; set `PG_BIN` elsewhere.
- `bun run typecheck`, `bun run build`, and `bunx --no-install prisma validate`: compiler/build/schema checks.

Tests exercise real Better Auth session validation and controlled authentication/provider responses and block unstubbed external fetches. Database guards reject remote hosts and database names outside `tsumugu_test` / `tsumugu_test_*`. Integration tests truncate their disposable database, so do not point them at a database containing wanted data. Live Google OAuth, external provider credentials/permissions, and hosted Inngest registration require separate smoke verification and are not proven by stubbed tests.

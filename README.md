# Xport

Xport exports X posts, threads, user timelines, and articles — as Markdown or JSON — from a web app, a direct link, or a CLI.

- **Live app:** [xport.frixaco.com](https://xport.frixaco.com)
- **CLI:** [`@frixaco/xport` on npm](https://www.npmjs.com/package/@frixaco/xport)

Xport is built around **resumable export jobs**. A browser creates a PostgreSQL-backed job, the server runs a disposable in-process worker to fetch pages from the upstream X data API, and each page writes progress, cursors, credits, and fetched posts back to Postgres. If the process dies or the browser reloads, the job can be resumed from its `jobId` and stored `next_cursor`.

## Demo

| Home                                                             | Stopped user fetch                                                                    | Article fetch                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ![Xport home page screenshot](./web/public/readme/home-page.png) | ![Xport stopped user fetch screenshot](./web/public/readme/stop-early-user-fetch.png) | ![Xport article fetch screenshot](./web/public/readme/article-fetch.png) |

## Features

- Export threads from a tweet URL or ID.
- Export user posts and replies from `@`/username or profile URL.
- Export X articles from article tweet URLs.
- Export from the terminal with the [`xport` CLI](https://www.npmjs.com/package/@frixaco/xport).
- Preview fetched content and media before export.
- Download Markdown and JSON where supported.
- Stop long-running fetches and export partial results.
- Resume background exports from a `jobId` URL.
- Start exports from direct links such as `xport.frixaco.com/x.com/...` and `xport.frixaco.com/twitter.com/...`.

## Architecture

![Resumable backend architecture](./web/public/readme/resumable-backend.svg)

- **Web app:** TanStack Start, TanStack Router, React, shadcn/ui, Tailwind, Nitro.
- **API:** server routes under `web/src/routes/api`.
- **Jobs:** PostgreSQL-backed fetch jobs and tweet snapshots.
- **Billing:** better-auth and Polar credits.
- **CLI:** server-backed TypeScript CLI in `cli/src`.
- **Shared core:** pure parsing, normalization, credit, and export-formatting helpers in `core`.
- **Workspace:** pnpm workspaces.

The upstream X data API is only reachable server-side, through `X_API_URL` and `X_API_KEY`.

The main backend state machine lives in `web/src/lib/fetch-job.ts`: create, claim, fetch, store, charge, stop, resume, complete, and fail. A runner claims work with an internal `runner_id`, writes progress only while it owns the job, and clears `runner_id` when the job reaches `completed`, `stopped`, or `failed`.

Routes:

- `/` - main export UI.
- `/x.com/<path>` and `/twitter.com/<path>` - direct-export redirects.
- `/auth-error` and `/checkout/success` - utility redirects.
- `/api/*` - server API routes.

### Production safeguards

- Job status, tweets, stop actions, and checkout status are available only to the authenticated owner. Unknown and cross-user resource IDs receive the same not-found response.
- Browser mutations require a same-origin request (CSRF protection); bearer-authenticated CLI requests remain supported. Client errors use stable public codes — raw upstream payloads, provider diagnostics, and persisted job exception messages stay server-side.
- Abuse is bounded: at most two queued or running jobs per account (serialized in PostgreSQL), 30 export preflights per minute per account, 30-second upstream timeouts, a 100-page/15-minute runner cap that preserves partial results, and one-hour retention for terminal jobs (expired rows are removed opportunistically during job creation).

## Exports

| Source        | Formats        | Filename                         |
| ------------- | -------------- | -------------------------------- |
| Thread        | Markdown, JSON | `<username>-thread.<ext>`        |
| User timeline | Markdown, JSON | `<username>-user-posts.<ext>`    |
| User replies  | Markdown, JSON | `<username>-replies.<ext>`       |
| Partial       | Markdown, JSON | Adds `-partial` before extension |
| Article       | Markdown       | `<sanitized-article-title>.md`   |

## Local Development

Requirements: Node.js 24.x, pnpm 11.x, PostgreSQL.

```bash
pn install
pn run db:migrate
pn run dev
```

The app needs environment variables to boot — see [Environment](#environment). The minimal set to sign in and run an export: `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, one OAuth provider (GitHub or Google), and `X_API_URL`/`X_API_KEY`. PostHog and Polar are optional; without Polar credits, grants can be issued locally with `pn --filter web run credits:grant -- <email> <credits> "reason"`.

Useful commands:

```bash
pn run build
pn run check
pn run lint
pn run format
pn run db:generate
pn run db:migrate
```

## Environment

Required:

- `DATABASE_URL` - PostgreSQL connection string.
- `BETTER_AUTH_URL` - origin used for auth; must match the deployed domain in production.
- `BETTER_AUTH_SECRET` - auth secret.
- `X_API_URL`, `X_API_KEY` - upstream X data API; server-side only.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - at least one OAuth provider for sign-in.

Optional:

- `SITE_URL` - canonical origin for SEO metadata; falls back to `BETTER_AUTH_URL`, then `http://localhost:3000`.
- Polar (billing) - `POLAR_ENV`, `POLAR_ACCESS_TOKEN` or `SANDBOX_POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_CREDITS_50_CREDITS_PRODUCT_ID` or `SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID`, `POLAR_CREDITS_500_CREDITS_PRODUCT_ID` or `SANDBOX_POLAR_CREDITS_500_CREDITS_PRODUCT_ID`. In production, signup credits are granted by the Polar `onCustomerCreated` webhook.
- PostHog (analytics) - `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST`. Omitted safely when unset.

## Deployment

Production runs on Railway at `https://xport.frixaco.com`.

Railway uses `railway.json`:

- Build: `pn build`
- Start: `pn start`
- Healthcheck: `/`

```bash
railway service xport-web
railway up --detach
railway service status
railway logs
```

Database schema is managed with Drizzle:

- Schema: `web/src/db/schema.ts`
- Migrations: `web/migrations/`
- Generate migrations: `pn run db:generate`
- Apply migrations: `pn run db:migrate`

## CLI

The CLI (`cli/src`, published as [`@frixaco/xport`](https://www.npmjs.com/package/@frixaco/xport)) calls the deployed or local Xport server APIs; Social API credentials stay server-side.

Install from npm:

```bash
npm install -g @frixaco/xport
xport login
xport export --format markdown --out . "https://x.com/burakeregar/status/2020852442230120752"
xport posts --format markdown --out . "@frixaco"
xport replies --format markdown --out . "@frixaco"
xport stop <jobId>
```

Prepare the npm package locally:

```bash
pn --filter @frixaco/xport build
pn --filter @frixaco/xport pack --pack-destination /tmp
```

Workspace usage:

```bash
pn --filter @frixaco/xport xport login
pn --filter @frixaco/xport xport whoami
pn --filter @frixaco/xport xport credits
pn --filter @frixaco/xport xport export --format markdown --out . "https://x.com/burakeregar/status/2020852442230120752"
pn --filter @frixaco/xport xport export --format json --stdout "@frixaco"
pn --filter @frixaco/xport xport posts --format markdown --out . "@frixaco"
pn --filter @frixaco/xport xport replies --format json --stdout "@frixaco"
pn --filter @frixaco/xport xport stop <jobId>
pn --filter @frixaco/xport xport logout
```

CLI export options must come before the input: `xport export [options] <input>` is the only supported form. Thread and user exports print `Job ID: <uuid>` to stderr as soon as the resumable job is created, and `xport stop <jobId>` stops that job from another terminal. Auth uses the Better Auth device code flow; tokens are stored at `~/.config/xport/config.json` with `0600` permissions. For automation, set `XPORT_TOKEN`; for local servers, set `XPORT_BASE_URL`.

Older local extraction scripts in `cli/` talk to the upstream API directly and read `cli/.env`; see `cli/.env.example`.

## License

MIT.

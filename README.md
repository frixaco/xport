# Xport

Xport is a web app and CLI for exporting X (Twitter) posts, threads, and articles.

### Web App

- paste a tweet URL/ID to fetch the thread context
- paste `@username`, username, or profile URL to fetch all posts of a user
- paste an article tweet URL/ID to fetch article content
- preview content inline with media handling in the app while it's being exported
- download exports as `Markdown`, `JSON`, `Text`, `CSV`
- copy to clipboard
- stop long-running fetches and still export partial results
- resume background fetch jobs after tab close via `jobId` in the URL
- direct-export links: open `xport.frixaco.com/x.com/...` or `xport.frixaco.com/twitter.com/...` to start immediately

## Demo

| Home                                                         | Stop-Early `@frixaco` Run                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| ![Xport home page screenshot](./public/readme/home-page.png) | ![Xport stop-early fetch run screenshot](./public/readme/stop-early-user-fetch.png) |

## How It Works

- **Input parsing** — a single parser normalizes tweet IDs, usernames, and Twitter/X URL variants, then routes to thread, user, or article flows.
- **Fetching** — articles use a single request; threads and user timelines run as background jobs that loop through pages with cursor-based pagination.
- **Progress tracking** — job state and fetched tweets are persisted in PostgreSQL. The UI polls for updates and can resume from where things left off. Stop requests are cooperative.
- **Partial exports** — stopped or failed jobs still produce exports from whatever was fetched. Filenames include `-partial` so you know.
- **Credit metering** — operations require credits, checked before each request. Usage is tracked via Polar through better-auth.

## TODO

- [ ] Add Redis-backed rate limiting (per-user + per-IP) on `/api/fetch-jobs`, fetch APIs, polling APIs, and auth APIs
- [ ] Enforce fetch-job concurrency caps (per-user + global) with `429` backpressure
- [ ] Add hard fetch loop guards: max pages/job, max tweets/job, max runtime/job, and upstream request timeouts
- [ ] Add CSRF/origin checks for mutating endpoints (`POST /api/fetch-jobs`, `POST /api/fetch-jobs/[jobId]/stop`)
- [ ] Lock down `GET /api/checkout/status` to authenticated owner access (or signed token)
- [ ] Stop returning raw upstream error details to clients; log detailed payloads server-side only
- [ ] Add retention cleanup for expired rows in `xport_fetch_jobs` and `xport_fetch_tweets`
- [ ] Put Cloudflare in front of Railway (WAF, bot mitigation, API rate-limit rules)

## Architecture

- **UI** (Next.js client components) — input detection, polling, result normalization, export generation
- **API** (App Router, Node.js runtime) — validated request contracts, structured errors
- **Domain** — fetch-loop orchestration, retry policy, stop semantics
- **Data** (PostgreSQL) — job metadata, tweet payload snapshots
- **Billing** (better-auth + Polar) — balance checks, metered usage events
- **Social API proxy** — server-side calls via `X_API_URL` with private key

## Fetch Jobs

Thread and user-timeline fetches run as background jobs: the server creates a job row, loops through pages via cursor, persists tweets incrementally, and charges credits as it goes. The UI polls for progress. Jobs end in `completed`, `stopped`, or `failed`. Stopped/failed jobs with stored data still produce exports.

The UI persists the job id as `?jobId=<uuid>` in the URL so you can close the tab and reopen later to resume polling and export the same job.

## Direct Export Links

You can skip the input box by using deep links that embed the source X/Twitter path into the Xport path. Xport will redirect to home and immediately start exporting.

Examples:

- `https://xport.frixaco.com/x.com/javarevisited/article/2020886352838225926`
- `https://xport.frixaco.com/x.com/burakeregar/status/2020852442230120752`
- `https://xport.frixaco.com/twitter.com/burakeregar/status/2020852442230120752`

## Exports

| Type                | Formats                        |
| ------------------- | ------------------------------ |
| Thread / User posts | Markdown, JSON, Text, CSV      |
| Article             | Markdown (+ copy to clipboard) |

Filenames: `<username>-thread.<ext>`, `<username>-user-posts.<ext>`, or sanitized article title. Partial runs get a `-partial` suffix.

## Auth & Billing

Sign in with GitHub or Google. Credits are managed through Polar — two packs available: 125 credits ($1) and 1250 credits ($10). Threads and user fetches cost `max(1, ceil(tweetCount / 20))` credits; articles and user-info lookups cost 1 credit.

## SEO

Home page (`/`) is the main indexed surface with canonical, Open Graph, JSON-LD, robots, and sitemap. `/auth-error` and `/checkout/success` are utility redirects back to home.

## Local Development

Prereqs:

- Node.js 20+
- PostgreSQL
- OAuth credentials (GitHub/Google)
- Polar credentials + product IDs
- `X_API_URL` and `X_API_KEY`

Install + run:

```bash
pnpm install
pnpm run db:migrate
pnpm run dev
```

Useful commands:

```bash
pnpm run build
pnpm run check
pnpm run lint
pnpm run db:migrate
pnpm run db:generate
```

## Required Environment Variables

Core runtime:

- `DATABASE_URL`
- `X_API_URL` — Social API base URL
- `X_API_KEY` (or `API_KEY`)
- `BETTER_AUTH_URL`
- `SITE_URL` (recommended)

OAuth:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Polar:

- `POLAR_ENV`
- `POLAR_ACCESS_TOKEN` / `SANDBOX_POLAR_ACCESS_TOKEN`
- `POLAR_CREDITS_50_CREDITS_PRODUCT_ID` / `SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID` ($1 credits pack)
- `POLAR_CREDITS_500_CREDITS_PRODUCT_ID` / `SANDBOX_POLAR_CREDITS_500_CREDITS_PRODUCT_ID` ($10 credits pack)

## Deployment (Railway)

Production target: `https://xport.frixaco.com`

Runtime:

- Node `24.x` (from root `package.json` `engines`)
- pnpm `10.x`
- Build command: `pnpm build`
- Start command: `pnpm start`

App output:

- TanStack Start + Nitro
- server entry: `web/.output/server/index.mjs`

Typical flow:

```bash
railway link
railway service xport-web
railway up --detach
railway logs
```

Set/update env:

```bash
railway variable set KEY="value"
```

Public app env names:

- `SITE_URL`
- `PUBLIC_POSTHOG_KEY`
- `PUBLIC_POSTHOG_HOST`

Run commands with deployed env:

```bash
railway run -- pnpm run db:migrate
```

## Quality Checks

```bash
pnpm run check   # oxfmt + oxlint via filter
pnpm run lint    # oxlint
pnpm run format  # oxfmt --write
```

For end-to-end behavior, validate live flows on `xport.frixaco.com`:

- article fetch + markdown download/copy
- complete thread fetch + all export formats
- user fetch stop-early + partial exports
- network polling cadence + stop response correctness
- Railway logs + DB job state consistency

## CLI

```bash
pnpm run fetch-thread -- <tweet-url-or-id>
pnpm run fetch-article -- <tweet-url-or-id>
pnpm run fetch-posts-by-username -- <username>
pnpm run fetch-user-info -- <username>
pnpm exec tsx json-to-text.ts <input.json>
```

See `cli/` for all available scripts.

## License

MIT License.

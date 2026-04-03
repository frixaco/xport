Use pnpm for package management.

## Product Baseline

- Follow `README.md` for extra context.
- Current product surface is the home page (`/`) plus API routes.
- Direct-export utility entrypoints: `/<x.com|twitter.com>/<...>` redirects to home and starts export immediately.
- `/auth-error` and `/checkout/success` are utility redirect pages, not SEO pages.
- API access must stay server-side via API route proxies (use `X_API_URL` env).
- Use both "Twitter" and "X" in user-facing copy where relevant.

## Codebase Conventions

- Framework: Next.js App Router. Prefer server components by default; use client components only when needed.
- UI: shadcn/ui + Tailwind. Prefer existing components; keep styling consistent.
- Prefer shared utility modules for formatting and parsing logic.
- URL parsing: centralize in a single module (avoid duplicating parser logic in UI components).
- API calls: route through a shared API client module or API routes.

## SEO & Metadata Scope (Current)

- Require metadata on the home page (`/`) and future public indexed pages.
- Home page SEO baseline is implemented: metadata, canonical, JSON-LD, OG image route, robots, sitemap.
- `auth-error` and `checkout/success` do not require metadata/canonical.
- Canonical + structured data remain required for dedicated public pages (`/thread`, `/export`, `/article`) once implemented.
- Titles for public indexed pages should follow `SPEC.md` and include both "Twitter" and "X".

## Commands

- `pnpm run db:migrate` — apply pending better-auth migrations
- `pnpm run db:generate` — generate SQL schema from auth config

## Deployment

- **Hosting:** Railway (long-running Node.js process, not serverless)
- **Domain:** `xport.frixaco.com` (CNAME → Railway)
- **Database:** PostgreSQL on Railway (same project, private networking)
- **Previous:** Vercel (removed — serverless incompatible with background fetch jobs)

### Railway CLI

- `railway link` — link local dir to Railway project
- `railway service xport-web` — select the web service
- `railway variable set KEY="value"` — set env vars
- `railway up --detach` — deploy from local (use for manual deploys)
- `railway logs` — view deploy/runtime logs
- `railway run -- <cmd>` — run command with Railway env vars locally

### Migrations

- better-auth migrations: `pnpm run db:migrate`
- Custom SQL migrations (e.g. fetch jobs tables): `railway run -- node -e "const fs=require('fs');const{Pool}=require('pg');const sql=fs.readFileSync('migrations/<file>.sql','utf8');const pool=new Pool({connectionString:process.env.DATABASE_URL});pool.query(sql).then(()=>{console.log('done');pool.end()}).catch(e=>{console.error(e);pool.end();process.exit(1)})"`
- Migration files live in `migrations/`

### Env Vars

- Managed via `railway variable set` (not .env on server)
- `.env` is local dev only
- `BETTER_AUTH_URL` must match the public domain (`https://xport.frixaco.com`)
- OAuth callback URLs (GitHub, Google) must point to the Railway domain

## Testing

E2E testing is done via Chrome MCP against the live deployment at `https://xport.frixaco.com`.

### Pre-deploy

- `pnpm run check` — typecheck passes
- `pnpm run lint` — lint passes (warnings OK, no errors)

### Export regression test (Chrome MCP)

Test these 3 inputs:

- `https://x.com/javarevisited/article/2020886352838225926`
- `https://x.com/burakeregar/status/2020852442230120752`
- `@frixaco` (stop early)

Also validate direct-export deep links (should auto-start and land on `/?jobId=...` for background jobs):

- `https://xport.frixaco.com/x.com/javarevisited/article/2020886352838225926`
- `https://xport.frixaco.com/x.com/burakeregar/status/2020852442230120752`

For each run:

1. Fetch input to terminal state (or stop early for `@frixaco`).
2. Download each available format.
3. Verify downloaded file naming + content accuracy.
4. Check server logs + DB rows for same run.

Filename expectations:

- user posts: `<username>-user-posts.<type>`
- thread: `<username>-thread.<type>`
- stopped/failed-with-results user or thread: add `-partial` suffix
- article: `<sanitized-article-title>.md`

#### Scenario: Article

1. Submit article URL; wait for content render.
2. Download Markdown; verify filename matches sanitized article title.
3. Verify Markdown content accuracy (frontmatter, source link, body sections/media).
4. Click `Copy Markdown`; verify clipboard content matches downloaded Markdown content.
5. Check logs + DB rows (no fetch-job rows expected for article route).

#### Scenario: Thread (complete)

1. Submit thread URL; wait for terminal `completed`.
   - Verify the URL includes `jobId` during the run; reload should resume the same job.
2. Download all thread formats (`Markdown`, `JSON`, `Text`, `CSV`).
3. Verify filenames use `<username>-thread.<type>` (no `-partial` on complete runs).
4. Verify post counts/content across files match fetched thread results.
5. Check logs + DB rows.

#### Scenario: User posts (`@frixaco`, stop early)

1. Start fetch; once counters increase, click `Stop`.
2. Verify terminal state is `stopped`/partial in UI.
   - Verify the URL includes `jobId`; reload should show the stopped job and allow exporting.
3. Download all user formats (`Markdown`, `JSON`, `Text`, `CSV`).
4. Verify filenames use `<username>-user-posts-partial.<type>`.
5. Verify each file contains the same number of posts as fetched/stored at stop time.
6. Check logs + DB rows.

### Network verification (Chrome MCP)

- `list_network_requests` with `resourceTypes: ["fetch"]`:
  - `/api/auth/customer/state` polls at ~15s intervals
  - `/api/fetch-jobs/[id]/status` polls only while active
  - stop request (`POST /api/fetch-jobs/[id]/stop`) returns `200`
  - no unexpected non-200s for tested flows

### Server logs + DB verification

- Logs: `railway logs`
  - no unhandled exceptions/crashes for tested flows
  - startup `Ready in Xms` present after deploy
  - "Failed to find Server Action" after deploy can be stale clients
- Jobs table: `xport_fetch_jobs`
  - `railway run -- node -e "const{Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});pool.query(\"SELECT id,request_type,status,stop_requested,pages_fetched,raw_fetched_tweets,stored_tweets,charged_credits,created_at FROM xport_fetch_jobs ORDER BY created_at DESC LIMIT 10\").then(r=>{console.log(JSON.stringify(r.rows,null,2));pool.end()}).catch(e=>{console.error(e);pool.end();process.exit(1)})"`
  - stopped run: `status='stopped'`, `stop_requested=true`
  - completed run: `status='completed'`
  - failed partial run (if occurs): `status='failed'` with `stored_tweets > 0` and exported filenames include `-partial`

---

## cli — Xport CLI Scripts

Helper scripts to extract and process X.com (Twitter) data using Node.js/TypeScript.

### Project Structure

```
cli/
├── fetch-thread.ts             # Thread + media downloader (Obsidian format)
├── fetch-article.ts            # Twitter article/note fetcher
├── fetch-posts-by-username.ts  # User timeline scraper (incremental)
├── fetch-user-info.ts          # User profile info fetcher
├── fetch-bookmarks.ts          # OAuth2 bookmarks fetcher
├── fetch-posts.ts              # User posts fetcher (legacy)
├── fetch-replies.ts            # User replies fetcher
├── fetch-followings.ts         # User following list fetcher
├── fetch-user-tweets-via-mentions.ts # Tweets via @mentions
├── json-to-text.ts             # JSON → Markdown converter
├── count.ts                    # Utility: count posts in posts.json
```

### Environment Variables

Required in `cli/.env`:

- `API_KEY` - Social API key (for thread/article/posts endpoints)
- `X_API_URL` - Base URL for the social API
- `X_CLIENT_ID` - Twitter OAuth2 client ID (bookmarks only)
- `X_CLIENT_SECRET` - Twitter OAuth2 client secret (bookmarks only)
- `X_CONSUMER_KEY`, `X_SECRET_KEY`, `X_BEARER_TOKEN` - Twitter app credentials

### CLI Scripts

```bash
pnpm run fetch-thread -- <tweet-url-or-id>
pnpm run fetch-article -- <tweet-url-or-id>
pnpm run fetch-posts-by-username -- <username>
pnpm run fetch-user-info -- <username>
pnpm run fetch-bookmarks
pnpm exec tsx json-to-text.ts <input.json>
```

### API Endpoints

| Endpoint                        | Used By                    |
| ------------------------------- | -------------------------- |
| `/twitter/tweet/thread_context` | fetch-thread.ts            |
| `/twitter/article`              | fetch-article.ts           |
| `/twitter/user/last_tweets`     | fetch-posts-by-username.ts |
| `/twitter/user/info`            | fetch-user-info.ts          |

### Conventions

- All scripts use Node.js runtime (no Bun)
- Rate limiting: 500ms-1000ms delay between API calls
- Error handling: log API response, throw descriptive error
- Filenames: sanitized from content or use tweet ID fallback
- Output: `data/` directory for all exported files

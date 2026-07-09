# Agent Instructions

Use pnpm.

## Product

- Xport exports X (ex-Twitter) posts, threads, user timelines, and articles.
- Core product: resumable PostgreSQL-backed export jobs. The active worker is an in-process async runner; Postgres is the durable source of truth.
- Main public page: `/`.
- API routes: `/api/*`.
- Direct-export routes `/<x.com|twitter.com>/<...>` redirect to `/` with `input=<source-url>` and auto-start export.
- Utility redirects: `/auth-error` and `/checkout/success`.
- Keep Social API calls server-side through API routes using `X_API_URL` and `X_API_KEY`.
- Use `X (ex-Twitter)` in user-facing copy when referring to the platform.

## Code

- Framework: TanStack Start with file-based routing and Nitro output.
- Prefer server-side route hooks (`beforeLoad`, `loader`) unless client behavior is required.
- UI: shadcn/ui + Tailwind. Reuse existing components and styles.
- URL parsing belongs in `web/src/lib/url-parser.ts`.
- Shared formatting/export logic belongs in shared utility modules, not components.
- API behavior should go through shared API modules or API routes.
- Never call `redirect()` from a route `component` when an HTTP redirect is required. Throw it from `beforeLoad` or `loader`.

Redirect-only route pattern:

```tsx
export const Route = createFileRoute("/some-route")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
```

## Resumable Jobs

- Fetch jobs are stored in `xport_fetch_jobs`; fetched posts are stored in `xport_fetch_tweets`.
- Job URLs use `jobId` as the durable browser handle.
- Background runners are started opportunistically by API requests, not by a permanent server loop.
- Runners claim work with `runner_id`.
- Only the current `runner_id` may update progress, charged credits, or terminal status.
- Stale `running` jobs are reclaimable when `updated_at` is older than the runner stale window.
- Terminal jobs must clear `runner_id`.

## SEO

- `/` needs metadata, canonical URL, and JSON-LD.
- Utility redirects do not need page metadata.
- If `/thread`, `/article`, or `/export` become real public pages, add canonical metadata and structured data.

## Commands

```bash
pn run dev
pn run build
pn run check
pn run lint
pn run format
pn run db:generate
pn run db:migrate
```

CLI commands from repo root:

```bash
pn --filter cli fetch-thread -- <tweet-url-or-id>
pn --filter cli fetch-article -- <tweet-url-or-id>
pn --filter cli fetch-posts-by-username -- <username>
pn --filter cli fetch-user-info -- <username>
pn --filter cli fetch-bookmarks
pn --filter cli exec tsx json-to-text.ts <input.json>
```

## Deployment

- Hosting: Railway.
- Domain: `xport.frixaco.com`.
- Database: PostgreSQL.
- Runtime: Node.js, pnpm 11.x.
- Build/start are defined in `railway.json`.
- Production env vars are managed in Railway, not committed files.
- `BETTER_AUTH_URL` must match `https://xport.frixaco.com`.
- `BETTER_AUTH_SECRET` must be set outside local throwaway runs.
- OAuth callback URLs must point to the production domain.

```bash
railway service xport-web
railway variable set KEY="value"
railway up --detach
railway service status
railway logs
railway run -- <cmd>
railway connect Postgres
```

Database schema is managed with Drizzle:

- Edit schema in `web/src/db/schema.ts`.
- Generate migrations with `pn run db:generate`.
- Apply migrations with `pn run db:migrate`.
- Keep generated migration files in `web/migrations/`.

After deploy, wait for `railway service status` to show `SUCCESS` before testing.

## Testing

Before deploy:

```bash
pn run check
pn run lint
```

Regression inputs:

- Article: `https://x.com/javarevisited/article/2020886352838225926`
- Thread: `https://x.com/burakeregar/status/2020852442230120752`
- User posts: `@frixaco` and stop early
- Direct article: `https://xport.frixaco.com/x.com/javarevisited/article/2020886352838225926`
- Direct thread: `https://xport.frixaco.com/x.com/burakeregar/status/2020852442230120752`

Expected filenames:

- Thread: `<username>-thread.<type>`
- User posts: `<username>-user-posts.<type>`
- Partial thread/user result: add `-partial`
- Article: `<sanitized-article-title>.md`

Check:

- Exports download in every available format.
- Exported counts/content match fetched results.
- Stopped jobs remain exportable.
- Direct-export URLs redirect to `/?input=...` and auto-start.
- Background jobs add `jobId` and resume after reload.
- Resumable jobs clear `runner_id` after completion, stop, or failure.
- No unexpected non-200 document/fetch requests.
- Railway logs have no unhandled runtime errors.

DB spot check:

```sql
SELECT id, request_type, status, runner_id, stop_requested, pages_fetched, raw_fetched_tweets, stored_tweets, charged_credits, created_at
FROM xport_fetch_jobs
ORDER BY created_at DESC LIMIT 10;
```

## CLI

- CLI scripts live in `cli/`.
- CLI env goes in `cli/.env`; see `cli/.env.example`.
- Keep scripts Node.js/TypeScript.
- Rate-limit upstream calls.
- Write generated data under script-local `data/` paths.

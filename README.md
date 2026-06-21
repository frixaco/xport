# Xport

Xport exports Twitter/X posts, threads, user timelines, and articles from a web app, with CLI scripts for local data extraction.

## Features

- Fetch threads from a tweet URL or ID.
- Fetch user posts from `@username`, username, or profile URL.
- Fetch Twitter/X articles from article tweet URLs.
- Preview fetched content and media before export.
- Export Markdown, JSON, Text, and CSV where supported.
- Stop long-running fetches and export partial results.
- Resume background jobs from the `jobId` URL parameter.
- Start exports from direct links like `xport.frixaco.com/x.com/...` and `xport.frixaco.com/twitter.com/...`.

## Demo

| Home                                                             | Stopped User Fetch                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ![Xport home page screenshot](./web/public/readme/home-page.png) | ![Xport stopped user fetch screenshot](./web/public/readme/stop-early-user-fetch.png)   |

## Architecture

- **Web:** TanStack Start, TanStack Router, React, shadcn/ui, Tailwind, Nitro output.
- **API routes:** server-side proxies under `web/src/routes/api`.
- **Data:** PostgreSQL for auth, fetch jobs, and fetched tweet snapshots.
- **Billing:** better-auth + Polar credits.
- **CLI:** Node.js/TypeScript scripts in `cli`.
- **Package manager:** pnpm workspaces.

Private Social API access stays server-side through `X_API_URL` and `X_API_KEY`.

## Routes

- `/` - main export UI.
- `/x.com/<path>` and `/twitter.com/<path>` - direct-export redirects.
- `/auth-error` and `/checkout/success` - utility redirects.
- `/thread`, `/article`, and `/export` - reserved utility redirects.
- `/api/*` - server API routes.

## Exports

| Source     | Formats                   | Filename                         |
| ---------- | ------------------------- | -------------------------------- |
| Thread     | Markdown, JSON, Text, CSV | `<username>-thread.<ext>`        |
| User posts | Markdown, JSON, Text, CSV | `<username>-user-posts.<ext>`    |
| Partial    | Markdown, JSON, Text, CSV | Adds `-partial` before extension |
| Article    | Markdown                  | `<sanitized-article-title>.md`   |

## Local Development

Requirements:

- Node.js 24.x
- pnpm 11.x
- PostgreSQL
- GitHub/Google OAuth credentials
- Polar credentials
- Social API credentials

```bash
pn install
pn run db:migrate
pn run dev
```

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

Core:

- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `SITE_URL`
- `X_API_URL`
- `X_API_KEY`

OAuth:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Polar:

- `POLAR_ENV`
- `POLAR_ACCESS_TOKEN` or `SANDBOX_POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- `POLAR_CREDITS_50_CREDITS_PRODUCT_ID` or `SANDBOX_POLAR_CREDITS_50_CREDITS_PRODUCT_ID`
- `POLAR_CREDITS_500_CREDITS_PRODUCT_ID` or `SANDBOX_POLAR_CREDITS_500_CREDITS_PRODUCT_ID`

Signup credits are granted from the Polar `customer.created` webhook. New customers receive 50 credits when the Polar webhook endpoint named `Xport Signup Credits` is enabled. Disabling that endpoint is the only operational toggle.

Analytics:

- `PUBLIC_POSTHOG_KEY`
- `PUBLIC_POSTHOG_HOST`

## Deployment

Production: `https://xport.frixaco.com`

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
- Migrations: `web/drizzle/`
- Generate after schema changes: `pn run db:generate`
- Apply migrations: `pn run db:migrate`

## CLI

CLI scripts read `cli/.env`; see `cli/.env.example`.

```bash
pn --filter cli fetch-thread -- <tweet-url-or-id>
pn --filter cli fetch-article -- <tweet-url-or-id>
pn --filter cli fetch-posts-by-username -- <username>
pn --filter cli fetch-user-info -- <username>
pn --filter cli fetch-bookmarks
pn --filter cli exec tsx json-to-text.ts <input.json>
```

## License

MIT License.

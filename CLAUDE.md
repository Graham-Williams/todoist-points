# CLAUDE.md — Todoist Points

Guidance for Claude Code / agents working in this repo.

## What this is

A personal gamification layer for Todoist: earn points for completed tasks (valued by **label**), spend them on rewards. Local-first, single-user (Graham). Pilot project for a PM-style autonomous coding workflow — Graham describes features in plain English, agents implement, Graham reviews the **running app** (behavior, not diffs) and merges.

## Stack

- Next.js + TypeScript + Tailwind CSS
- SQLite via `better-sqlite3` (local file, gitignored)
- Todoist unified API v1 (`https://api.todoist.com/api/v1`), auth via `TODOIST_API_TOKEN` env var

## Earning model (important)

Points are assigned **per Todoist label**, NOT by priority. The app reads the user's labels and lets him assign a point value to each. A completed task awards points based on its label(s) — specifically the **max** of its labels' values. A no-label task (or one whose labels are all worth 0) earns 0 points and is **routed to a manual review queue** instead of being awarded automatically (see "Review queue (0-point completions)").

## Run / test

> Keep this section updated as the project gains commands.

First-time setup:
1. `npm install`
2. `cp .env.example .env` and set `TODOIST_API_TOKEN` to your real token (`.env` is gitignored).

Commands:
- Dev server: `npm run dev` → http://localhost:3000
- Production build: `npm run build` — note the config uses `output: "standalone"`, so serve the build with `node .next/standalone/server.js` (`next start` doesn't support standalone output); in production it runs in Docker (see Deployment section)
- Lint: `npm run lint`

The SQLite DB is created automatically at `./data/todoist-points.db` on first run (schema self-initializes). Both `.env` and `data/` are gitignored — never commit them.

### App structure
- `src/lib/db.ts` — better-sqlite3 connection + schema init (`label_points`, `ledger`, `rewards`, `processed_completions`, `sync_state`, `pending_review`). All tables use `CREATE TABLE IF NOT EXISTS`, so adding a table auto-migrates existing DBs on next boot.
- `src/lib/todoist.ts` — server-only Todoist v1 client (labels via `{results,next_cursor}`; completed tasks via `/tasks/completed/by_completion_date` returning `{items,next_cursor}`).
- `src/lib/queries.ts` — ledger/stats/rewards read helpers, plus the review-queue helpers (`getPendingReview`, `getPendingReviewCount`, `awardPendingReview`, `discardPendingReview`).
- Pages: `/` (dashboard), `/labels` (point config), `/rewards` (store), `/review` (manual review of 0-point completions).
- `src/app/AutoSync.tsx` — `"use client"` component. **Rendered once, globally, in the layout header (`src/app/layout.tsx`)** so a single auto-sync loop drives every page (no per-page instances — that would double-fire). Auto-syncs on mount and every 15s while the tab is visible (paused when hidden; also syncs immediately when the tab regains focus) via `POST /api/sync`. Overlapping syncs are guarded by an in-flight ref. Shows a subtle status ("Syncing…" / "Last synced: <relative time>") and keeps a manual "Sync now" button.
- **Global sync → per-view refresh:** after each **successful** sync, AutoSync dispatches a browser event `window.dispatchEvent(new CustomEvent("todoist:synced"))`. Every data-driven view listens for it and refetches (listener added on mount, removed on unmount):
  - `src/app/DashboardRefresh.tsx` — `"use client"` no-render helper on the dashboard (a server component); calls `router.refresh()` on the event to re-run `getStats()`.
  - `/labels`, `/rewards`, `/review` pages — each `"use client"`, re-run their `load()` on the event.
  - `src/app/ReviewNavLink.tsx` — refetches its badge count on the event (in addition to mount + tab focus) so the amber count updates immediately after a sync.
- `src/app/ReviewNavLink.tsx` — `"use client"` nav link rendered in the server layout; fetches `/api/review` on mount, on tab focus, and on `todoist:synced` to show a count badge of items awaiting review.
- API routes under `src/app/api/`: `labels`, `sync`, `rewards`, `rewards/[id]` (PATCH name/cost/active + DELETE), `rewards/[id]/redeem`, `dashboard`, `review` (GET list), `review/[id]/award` (POST), `review/[id]/discard` (POST).
- **Editable reward cost:** the `/rewards` page supports inline editing of a reward's cost — an "Edit" button reveals a number input + Save/Cancel; client validates an integer ≥ 1, PATCHes `{ cost }`, then refetches rewards + balance (controls disabled while in flight). The PATCH route validates `cost` as a positive integer (rejects non-finite/`< 1` with a 400), consistent with add-reward validation.

### Points model (as built)
Multi-label task = **max** of its labels' point values (single label = that value; no labels = 0). Sync is idempotent via `processed_completions` (keyed on Todoist completion id), so re-syncing never double-counts. Earn read queries also filter `points > 0` defensively. Redeem checks `balance >= cost` before recording a negative ledger entry.

### Review queue (0-point completions)
A completion that earns **0 points** (no labels, or all its labels are worth 0) is **no longer dropped silently**. During sync, in the same transaction that marks it processed, it is inserted (`INSERT OR IGNORE`) into the `pending_review` table so the user can later assign it a point value or discard it. The earn (>0) path is unchanged. The `/api/sync` response includes a `pendingReview` total count.

`pending_review` schema: `(completion_id TEXT PRIMARY KEY, content TEXT NOT NULL, labels TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))` — `labels` is a JSON-array string of the task's label names.

On the `/review` page, **Assign N** records a normal `earn` ledger row (`source_id` = completion id, description = `"<content> (manual review)"`) and removes the queue row; **Discard** just removes the queue row. Either way the completion stays in `processed_completions`, so it is never re-queued — this is **"going forward only"** (no backfilling of history; only newly-synced 0-point completions enter the queue).

**Assigning 0 = discard.** The award API route (`review/[id]/award`) accepts an integer in **[0, 100000]**. `points === 0` routes to `discardPendingReview` (drop from the queue, no ledger row, balance unchanged) and returns `{ ok, newBalance }`; `points >= 1` awards as normal. `awardPendingReview` keeps its own `>= 1` guard (defense in depth) and runs in a transaction, so 0 can never create a ledger row. The review input has `min={0}` with a "0 = discard" hint; the separate Discard button still exists. Default input value is 1.

## Deployment / self-hosting

Production runs in **Docker** on Graham's Ubuntu home server (Tailscale SSH `graham@100.101.1.28`, app dir `~/todoist-points`), reachable ONLY at **https://todoist-points.graham-williams.com** through the existing Cloudflare Tunnel + Cloudflare Access (one-time PIN). Full runbook: **`DEPLOY.md`**. Key facts:

- `next.config.mjs` uses `output: "standalone"`; the multi-stage `Dockerfile` (node:24-bookworm-slim, **digest-pinned** on all three FROM lines, non-root `node` user) runs `node server.js` on port 3000 and asserts better-sqlite3's native addon made it into the standalone output.
- **In-app Cloudflare Access JWT verification + origin pin** (`src/middleware.ts`, mirroring km-tracker): when `CF_ACCESS_AUD` **and** `CF_ACCESS_TEAM_DOMAIN` are both set, every request (pages and `/api`, nothing exempt) must carry a valid Access JWT (`Cf-Access-Jwt-Assertion` header, `CF_Authorization` cookie fallback) — RS256 verified via WebCrypto against the team JWKS (fetched from `https://<team>/cdn-cgi/access/certs`, cached in-module for 1h, refetched on kid miss), plus `aud`/`iss`/`exp`/`nbf` checks; failures get a 403. When `APP_HOST` is set, non-GET/HEAD requests with a mismatched `Origin` (when present) or `Host` also get a 403 (CSRF/origin pin). With the env vars unset (local dev) the middleware is a no-op. Edge runtime, **no new npm dependencies**. Consequence: an unauthenticated in-network request returning **403 is the healthy signal** (used by the DEPLOY.md sanity check).
- **`DB_PATH` env var** (added for this) points the SQLite file anywhere; default stays `./data/todoist-points.db` for local dev. Compose sets `DB_PATH=/data/todoist-points.db` with `./data` bind-mounted at `/data`.
- `docker-compose.yml`: single service **named `todoist-points`** — that name is the DNS alias the tunnel ingress targets (`http://todoist-points:3000`), don't rename it. It joins the **external** network `km-tracker_default` (created by the km-tracker compose project, where the cloudflared connector lives). `TODOIST_API_TOKEN` and `CF_ACCESS_AUD` come from a box-local gitignored `.env` (`chmod 600`; the AUD is the Access app's Audience tag from the Cloudflare Zero Trust dashboard/API); compose hardcodes `CF_ACCESS_TEAM_DOMAIN=blue-dream-0427.cloudflareaccess.com` and `APP_HOST=todoist-points.graham-williams.com`.
- **Never add `ports:`** — a published host port would expose the app on the LAN and bypass Cloudflare Access at the edge (the in-app JWT check is a backstop, not a substitute).
- Tunnel ingress + Access app live in the Cloudflare API (remotely-managed tunnel), not on the box.
- Redeploy: `git pull && docker compose up -d --build` from `main`.

## Git workflow (matches Graham's global rules)

- **Feature / non-protected branches:** commit and push freely.
- **`main` is protected:** never push or merge to it directly. Changes land on `main` ONLY via a PR that Graham reviews and merges himself after looking at the running app.
- Note: agents run with Graham's GitHub credentials, so the "only Graham merges" guarantee is workflow-enforced, not a hard technical lock — respect it.

## Security gate

Before **any** `git push`, a parallel panel of skeptical security subagents must run and come back clean. The panel covers, at minimum:
- **Secrets / PII** — no tokens, credentials, `.env`, DB files, or personal task/label data in committed source.
- **Injection / auth / vuln** — SQL injection, unsafe input handling, missing auth/authorization, unsafe deserialization, etc.
- **Dependency / supply-chain** — risky or compromised packages, lockfile integrity, suspicious transitive deps.
- **Data exposure** — endpoints or logs leaking data that shouldn't be exposed.

Each panelist reviews adversarially and must report clean before push is allowed. **Re-run the full panel on every change** — a prior clean result does not carry over to new commits.

## Secret & data safety (this repo is PUBLIC)

- NEVER commit `.env` or the SQLite database — both are gitignored. Use `.env.example` (placeholders only) for documentation.
- Never hardcode the Todoist token or real personal task/label data into committed source.
- The real token comes from the environment at runtime.

## Self-maintenance

When you add or change a capability, integration, dependency, command, or architectural decision here, update THIS file before considering the task done. This is how context persists for the next agent/session.

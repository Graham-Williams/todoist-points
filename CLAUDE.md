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
- `src/lib/db.ts` — better-sqlite3 connection + schema init (`label_points`, `ledger`, `rewards`, `processed_completions`, `sync_state`, `pending_review`, `task_point_overrides`). All tables use `CREATE TABLE IF NOT EXISTS`, so adding a table auto-migrates existing DBs on next boot.
- `src/lib/todoist.ts` — server-only Todoist v1 client (labels via `{results,next_cursor}`; completed tasks via `/tasks/completed/by_completion_date` returning `{items,next_cursor}`; **active dated tasks** via `getActiveDatedTasks()` — `GET /tasks` paginated `{results,next_cursor}`, filtered to those with a `due` object).
- `src/lib/queries.ts` — ledger/stats/rewards read helpers, plus the review-queue helpers (`getPendingReview`, `getPendingReviewCount`, `awardPendingReview`, `discardPendingReview`).
- Pages: `/` (dashboard), `/labels` (point config), `/rewards` (store), `/review` (manual review of 0-point completions).
- **Favicon + apple-touch-icon** (green-check brand mark, emerald `#10b981`) are provided via the App Router icon **file convention** — `src/app/icon.svg` (SVG favicon) and `src/app/apple-icon.tsx` (180×180 apple-touch-icon rendered at build time via `ImageResponse` from `next/og`, no new deps). Next auto-injects the `<link rel="icon">` / `<link rel="apple-touch-icon">` tags; `layout.tsx` metadata needs no `icons` entry.
- `src/app/AutoSync.tsx` — `"use client"` component. **Rendered once, globally, in the layout header (`src/app/layout.tsx`)** so a single auto-sync loop drives every page (no per-page instances — that would double-fire). Auto-syncs on mount and every 15s while the tab is visible (paused when hidden; also syncs immediately when the tab regains focus) via `POST /api/sync`. Overlapping syncs are guarded by an in-flight ref. Shows a subtle status ("Syncing…" / "Last synced: <relative time>") and keeps a manual "Sync now" button.
- **Global sync → per-view refresh:** after each **successful** sync, AutoSync dispatches a browser event `window.dispatchEvent(new CustomEvent("todoist:synced"))`. Every data-driven view listens for it and refetches (listener added on mount, removed on unmount):
  - `src/app/DashboardRefresh.tsx` — `"use client"` no-render helper on the dashboard (a server component); calls `router.refresh()` on the event to re-run `getStats()`.
  - `/labels`, `/rewards`, `/review` pages — each `"use client"`, re-run their `load()` on the event.
  - `src/app/ReviewNavLink.tsx` — refetches its badge count on the event (in addition to mount + tab focus) so the amber count updates immediately after a sync.
- `src/app/ReviewNavLink.tsx` — `"use client"` nav link rendered in the server layout; fetches `/api/review` on mount, on tab focus, and on `todoist:synced` to show a count badge of items awaiting review.
- API routes under `src/app/api/`: `labels`, `sync`, `rewards`, `rewards/[id]` (PATCH name/cost/active + DELETE), `rewards/[id]/redeem`, `dashboard`, `review` (GET list), `review/[id]/award` (POST), `review/[id]/discard` (POST), `ledger/[id]` (DELETE — remove an earning; PATCH — edit an earning's points; see below), `upcoming` (GET — active dated tasks left-joined with saved overrides), `upcoming/[id]` (PUT — upsert an override `{points}`; DELETE — clear it).
- **Earning controls (edit points + remove):** each row in the dashboard "Recent earnings" list has an inline control cluster (`src/app/EarningControls.tsx`, `"use client"`, one per row, props `{ id, points }`) rendering **`Edit · Remove`** on the right — unobtrusive slate text, emerald/rose accents. Both actions dispatch the global `todoist:synced` event on success so `DashboardRefresh` re-runs `getStats()` (balance + list update via the existing machinery); controls disable while a request is in flight, and errors show a subtle inline message with a Dismiss.
  - **Edit** reveals a number input pre-filled with the current `points` + Save/Cancel (mirrors the `/rewards` inline-cost edit). Client-validates an integer in [1, 100000] (Save disabled otherwise), then `PATCH /api/ledger/<id>` with `{ points }` → `updateEarningPoints(id, points)` in `queries.ts` (`UPDATE ledger SET points = ? WHERE id = ? AND type = 'earn'`). **Scope: earnings only, points only** — not the description, not redemptions. Editing touches ONLY the ledger row's `points`; it does NOT touch `processed_completions`/`source_id`/`description`/`type`/`created_at`, so sync never re-awards. The PATCH route validates `id` (positive int → 400) and `points` (integer [1,100000] → 400, matching the review-award validation style), 404s if no such earn row, 500 on error.
  - **Remove** is a two-step confirm (Remove → Confirm/Cancel; no native `confirm()`). On confirm it calls `DELETE /api/ledger/<id>` → `deleteEarning(id)`. The route validates `id` as a positive int (400 otherwise), 404s if no such earn row, 500 on error. **Scope: earnings only** — there is deliberately no remove control on redemptions (that would be a refund, different semantics). **CRITICAL INVARIANT:** removing an earning deletes the `ledger` row ONLY and leaves `processed_completions` intact. The earning's `source_id` is the Todoist completion id, which stays in `processed_completions` from sync; the sync loop skips any completion already there (`src/app/api/sync/route.ts`: `if (alreadyProcessed.get(task.id)) continue;`), so leaving that row is exactly what prevents the removed earning from being re-awarded on the next 15s sync.
  - Both `deleteEarning` and `updateEarningPoints` guard with `... WHERE id = ? AND type = 'earn'`, so neither can ever touch a `redeem` row (a redeem id 404s). Manual-review awards are equally safe to edit/remove (they're `earn` rows, in `processed_completions` too). (This component replaced the former `RemoveEarningButton.tsx`, folding its two-step-confirm remove logic in alongside the new Edit.)
- **Editable reward cost:** the `/rewards` page supports inline editing of a reward's cost — an "Edit" button reveals a number input + Save/Cancel; client validates an integer ≥ 1, PATCHes `{ cost }`, then refetches rewards + balance (controls disabled while in flight). The PATCH route validates `cost` as a positive integer (rejects non-finite/`< 1` with a 400), consistent with add-reward validation.

### Points model (as built)
Multi-label task = **max** of its labels' point values (single label = that value; no labels = 0). Sync is idempotent via `processed_completions` (keyed on Todoist completion id), so re-syncing never double-counts. Earn read queries also filter `points > 0` defensively. Redeem checks `balance >= cost` before recording a negative ledger entry.

### Review queue (0-point completions)
A completion that earns **0 points** (no labels, or all its labels are worth 0) is **no longer dropped silently**. During sync, in the same transaction that marks it processed, it is inserted (`INSERT OR IGNORE`) into the `pending_review` table so the user can later assign it a point value or discard it. The earn (>0) path is unchanged. The `/api/sync` response includes a `pendingReview` total count.

`pending_review` schema: `(completion_id TEXT PRIMARY KEY, content TEXT NOT NULL, labels TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))` — `labels` is a JSON-array string of the task's label names.

On the `/review` page, **Assign N** records a normal `earn` ledger row (`source_id` = completion id, description = `"<content> (manual review)"`) and removes the queue row; **Discard** just removes the queue row. Either way the completion stays in `processed_completions`, so it is never re-queued — this is **"going forward only"** (no backfilling of history; only newly-synced 0-point completions enter the queue).

**Assigning 0 = discard.** The award API route (`review/[id]/award`) accepts an integer in **[0, 100000]**. `points === 0` routes to `discardPendingReview` (drop from the queue, no ledger row, balance unchanged) and returns `{ ok, newBalance }`; `points >= 1` awards as normal. `awardPendingReview` keeps its own `>= 1` guard (defense in depth) and runs in a transaction, so 0 can never create a ledger row. The review input has `min={0}` with a "0 = discard" hint; the separate Discard button still exists. Default input value is 1.

### Upcoming — manual point pre-assignment (`task_point_overrides`)
The `/review` page has a second section, **"Upcoming"**, listing **uncompleted** Todoist tasks that have a **due date** (from `getActiveDatedTasks()`). Each row shows the content, a "Due <date>" chip, label chips, a points input, **Save**, and (when a value is saved) **Clear**. Saving pre-assigns a point value that is **remembered** — it re-displays on reload because `GET /api/upcoming` left-joins the live task list with saved overrides. The section fetches on mount and re-fetches on the `todoist:synced` event like the rest of the app.

`task_point_overrides` schema: `(task_id TEXT PRIMARY KEY, points INTEGER NOT NULL, content TEXT, created_at TEXT DEFAULT (datetime('now')))` — keyed by the **ACTIVE Todoist task id**. Query helpers in `queries.ts`: `getTaskOverridesMap()`, `getTaskOverride(taskId)`, `upsertTaskOverride(taskId, points, content)` (validates points is an integer in [1,100000]; `ON CONFLICT` updates), `deleteTaskOverride(taskId)`. Save = `PUT /api/upcoming/[id] {points}` → upsert; Clear = `DELETE /api/upcoming/[id]`. **Clearing is a DELETE, never a 0-point upsert** — 0/blank is not a valid override.

**ID linkage (verified empirically 2026-07-08):** the Todoist unified API v1 `/tasks/completed/by_completion_date` returns the **full task object**, whose `id` **equals** the active task's `id` (there is NO separate `task_id`/`v2_task_id`; confirmed by creating→completing→re-fetching a throwaway task and matching ids). So an override keyed on the active id matches a completion directly on `completedTask.id`.

**Sync precedence (manual override > label points), in `src/app/api/sync/route.ts`:** for each not-yet-processed completion, the loop checks `task_point_overrides` by `task.id` **before** the label-max computation. If an override exists it awards **exactly** that value (ledger row described `"<content> (pre-assigned)"`, `source_id` = completion id as usual), **bypasses `pending_review` even for a no-label task**, and **deletes the override row within the same transaction** (lifecycle: an override is one-shot — it fires once, then the row is stale because that id won't be an active task again, so it is removed). If no override, the existing label-max / pending-review logic runs unchanged. **Idempotency preserved:** the `alreadyProcessed` guard runs FIRST, so re-syncing a stale window never re-awards or re-deletes; `markProcessed` still runs for every task.

## Deployment / self-hosting

Production runs in **Docker** on Graham's Ubuntu home server (Tailscale SSH `graham@100.101.1.28`, app dir `~/todoist-points`), reachable ONLY at **https://todoist-points.graham-williams.com** through the existing Cloudflare Tunnel + Cloudflare Access (one-time PIN). Full runbook: **`DEPLOY.md`**. Key facts:

- `next.config.mjs` uses `output: "standalone"`; the multi-stage `Dockerfile` (node:24-bookworm-slim, **digest-pinned** on all three FROM lines, non-root `node` user) runs `node server.js` on port 3000 and asserts better-sqlite3's native addon made it into the standalone output.
- **In-app Cloudflare Access JWT verification + origin pin** (`src/middleware.ts`, mirroring km-tracker): when `CF_ACCESS_AUD` **and** `CF_ACCESS_TEAM_DOMAIN` are both set, every request (pages and `/api`, nothing exempt) must carry a valid Access JWT (`Cf-Access-Jwt-Assertion` header, `CF_Authorization` cookie fallback) — RS256 verified via WebCrypto against the team JWKS (fetched from `https://<team>/cdn-cgi/access/certs`, cached in-module for 1h, refetched on kid miss), plus `aud`/`iss`/`exp`/`nbf` checks; failures get a 403. When `APP_HOST` is set, non-GET/HEAD requests with a mismatched `Origin` (when present) or `Host` also get a 403 (CSRF/origin pin). With the env vars unset (local dev) the middleware is a no-op. Edge runtime, **no new npm dependencies**. Consequence: an unauthenticated in-network request returning **403 is the healthy signal** (used by the DEPLOY.md sanity check).
- **`DB_PATH` env var** (added for this) points the SQLite file anywhere; default stays `./data/todoist-points.db` for local dev. Compose sets `DB_PATH=/data/todoist-points.db` with `./data` bind-mounted at `/data`.
- `docker-compose.yml`: single service **named `todoist-points`** — that name is the DNS alias the tunnel ingress targets (`http://todoist-points:3000`), don't rename it. It joins the **external** network `km-tracker_default` (created by the km-tracker compose project, where the cloudflared connector lives). `TODOIST_API_TOKEN` and `CF_ACCESS_AUD` come from a box-local gitignored `.env` (`chmod 600`; the AUD is the Access app's Audience tag from the Cloudflare Zero Trust dashboard/API); compose hardcodes `CF_ACCESS_TEAM_DOMAIN=blue-dream-0427.cloudflareaccess.com` and `APP_HOST=todoist-points.graham-williams.com`.
- **Never add `ports:`** — a published host port would expose the app on the LAN and bypass Cloudflare Access at the edge (the in-app JWT check is a backstop, not a substitute).
- Tunnel ingress + Access app live in the Cloudflare API (remotely-managed tunnel), not on the box.
- Redeploy: `git pull && docker compose up -d --build` from `main`.

### Off-box backups (issue #6, mirrors km-tracker)

The points ledger DB is the **source of truth** (spends/rewards/review decisions aren't re-derivable from Todoist), so it's backed up off-box. `scripts/backup.sh` runs on the **host** (not the container) via a systemd timer:

- Consistent snapshot via SQLite's **online backup API** (`python3` stdlib, WAL-safe — never a raw `cp` of the live DB), with a `PRAGMA integrity_check` on each snapshot.
- **Local tier:** deduped-by-sha256 snapshots in `data/backups/` (`todoist-points_<UTC>.db`), pruned to the newest `LOCAL_RETENTION` (default 100).
- **Off-box tier:** `rclone copy` to Google Drive (`gdrive:todoist-points-backups`, reusing the box's existing `gdrive` remote that km-tracker set up) — throttled to every `DRIVE_PUSH_INTERVAL_MIN` min (default 15) and only when the DB changed; recent ring buffer pruned to `DRIVE_RETENTION` (default 50), plus a `daily/` long-tail tier (one snapshot/UTC-day, `DAILY_RETENTION` default 30).
- **Fail-safe:** local snapshot always runs; if rclone isn't configured yet it warns and **exits 0** (won't flap the systemd unit), non-zero only when a configured remote actually errors. Never overwrites a good backup with an empty one.
- Config: `.env.backup` (gitignored; copy from committed `.env.backup.example` — **no secrets**, the rclone OAuth token lives only in `~/.config/rclone/rclone.conf`). Units: `deploy/todoist-points-backup.{service,timer}` (installed manually on the box, run as `<user>`, assume repo at `/home/<user>/todoist-points` — set `User=`/`ExecStart` before installing). Full install/verify/restore steps in **`DEPLOY.md` → Automated backups**.

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

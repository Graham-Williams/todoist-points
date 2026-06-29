# CLAUDE.md — Todoist Points

Guidance for Claude Code / agents working in this repo.

## What this is

A personal gamification layer for Todoist: earn points for completed tasks (valued by **label**), spend them on rewards. Local-first, single-user (Graham). Pilot project for a PM-style autonomous coding workflow — Graham describes features in plain English, agents implement, Graham reviews the **running app** (behavior, not diffs) and merges.

## Stack

- Next.js + TypeScript + Tailwind CSS
- SQLite via `better-sqlite3` (local file, gitignored)
- Todoist unified API v1 (`https://api.todoist.com/api/v1`), auth via `TODOIST_API_TOKEN` env var

## Earning model (important)

Points are assigned **per Todoist label**, NOT by priority. The app reads the user's labels and lets him assign a point value to each. A completed task awards points based on its label(s) — specifically the **max** of its labels' values. A no-label task (or one whose labels are all worth 0) earns 0 points and is ignored entirely (see "Points model (as built)").

## Run / test

> Keep this section updated as the project gains commands.

First-time setup:
1. `npm install`
2. `cp .env.example .env` and set `TODOIST_API_TOKEN` to your real token (`.env` is gitignored).

Commands:
- Dev server: `npm run dev` → http://localhost:3000
- Production build: `npm run build` (then `npm run start` to serve the build)
- Lint: `npm run lint`

The SQLite DB is created automatically at `./data/todoist-points.db` on first run (schema self-initializes). Both `.env` and `data/` are gitignored — never commit them.

### App structure
- `src/lib/db.ts` — better-sqlite3 connection + schema init (`label_points`, `ledger`, `rewards`, `processed_completions`, `sync_state`).
- `src/lib/todoist.ts` — server-only Todoist v1 client (labels via `{results,next_cursor}`; completed tasks via `/tasks/completed/by_completion_date` returning `{items,next_cursor}`).
- `src/lib/queries.ts` — ledger/stats/rewards read helpers.
- Pages: `/` (dashboard), `/labels` (point config), `/rewards` (store).
- API routes under `src/app/api/`: `labels`, `sync`, `rewards`, `rewards/[id]`, `rewards/[id]/redeem`, `dashboard`.

### Points model (as built)
Multi-label task = **max** of its labels' point values (single label = that value; no labels = 0). A completion that earns **0 points** (no labels, or all its labels are worth 0) is **ignored entirely**: it is never recorded in the ledger and never displayed anywhere (dashboard, earnings, totals, counts, balance). It is still marked processed so it's skipped on future syncs — there is no retroactive scoring (intended). The app is effectively oblivious to non-pointed tasks. Sync is idempotent via `processed_completions` (keyed on Todoist completion id), so re-syncing never double-counts. Earn read queries also filter `points > 0` defensively. Redeem checks `balance >= cost` before recording a negative ledger entry.

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

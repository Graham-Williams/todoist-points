# Todoist Points

A personal gamification layer for [Todoist](https://todoist.com): earn points for completing tasks — valued by the **label** on each task — and spend those points on rewards you define.

Built as the pilot project for a product-manager-style autonomous coding workflow.

## How points work

- You assign a point value to each of your Todoist **labels**.
- When you complete a task, it awards points based on its label(s).
- You define **rewards** (name + point cost) and redeem them to spend points.
- A dashboard shows your balance, recent earnings, and redemption history.

## Stack

- **Next.js** + **TypeScript** + **Tailwind CSS**
- **SQLite** (via `better-sqlite3`) for local persistence
- Reads Todoist via the Todoist unified API v1

## Running locally

> Filled in by the scaffold. In short: `npm install`, copy `.env.example` to `.env` and set `TODOIST_API_TOKEN`, then `npm run dev` and open http://localhost:3000.

## Configuration

Copy `.env.example` to `.env` and set:

- `TODOIST_API_TOKEN` — your Todoist API token (Settings → Integrations → Developer).

`.env` and the local SQLite database are gitignored and must never be committed.

## License

[MIT](./LICENSE) — use it for whatever you like. A reference back is appreciated but not required.

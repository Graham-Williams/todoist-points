# Todoist Points

A personal gamification layer for [Todoist](https://todoist.com): earn points for completing tasks and keeping daily habits, and spend those points on rewards you define.

Built as the pilot project for a product-manager-style autonomous coding workflow.

## How points work

- Complete tasks in Todoist as usual. Each completed task shows up in the app's **Review** tab, where you assign it a point value (or discard it).
- For tasks with a due date you can set the points ahead of time (Review → Upcoming); they're paid out automatically when you complete the task.
- Add daily **habits** and tick them off each day to earn their points; finishing every habit in a day earns a bonus. A habit can optionally cost points when you mark it not done, so your balance can dip below zero until you catch up.
- You define **rewards** (name + point cost) and redeem them to spend points.
- A dashboard shows your balance (which you can also set or reset), recent earnings and losses, and spending and adjustment history.

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

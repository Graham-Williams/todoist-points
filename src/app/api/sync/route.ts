import { NextResponse } from "next/server";
import { getCompletedTasks } from "@/lib/todoist";
import { getDb } from "@/lib/db";
import { getLabelPointsMap } from "@/lib/queries";

// POST: fetch completed tasks since the last sync and award points for any
// completion not already processed. Idempotent — re-syncing never double-counts.
export async function POST() {
  try {
    const db = getDb();

    // Determine the sync window. Default lookback: 90 days (API max ~3 months).
    const now = new Date();
    const lastSyncRow = db
      .prepare(`SELECT value FROM sync_state WHERE key = 'last_sync'`)
      .get() as { value: string } | undefined;

    const until = formatTodoistTs(now);
    let since: string;
    if (lastSyncRow?.value) {
      // Re-scan from a few hours before last sync to catch any stragglers;
      // processed_completions dedupes anyway.
      const from = new Date(lastSyncRow.value);
      from.setHours(from.getHours() - 6);
      since = formatTodoistTs(from);
    } else {
      const from = new Date(now);
      from.setDate(from.getDate() - 90);
      since = formatTodoistTs(from);
    }

    const completed = await getCompletedTasks(since, until);
    const pointsMap = getLabelPointsMap();

    const alreadyProcessed = db.prepare(
      `SELECT 1 FROM processed_completions WHERE completion_id = ?`
    );
    const markProcessed = db.prepare(
      `INSERT OR IGNORE INTO processed_completions (completion_id) VALUES (?)`
    );
    const insertLedger = db.prepare(
      `INSERT INTO ledger (type, points, source_id, description) VALUES ('earn', ?, ?, ?)`
    );
    const insertPendingReview = db.prepare(
      `INSERT OR IGNORE INTO pending_review
         (completion_id, content, labels, completed_at, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );

    let newlyProcessed = 0;
    let pointsAwarded = 0;

    const tx = db.transaction(() => {
      for (const task of completed) {
        if (alreadyProcessed.get(task.id)) continue;
        const labels = task.labels ?? [];
        // Multi-label task earns the MAX of its labels' point values
        // (single label = that value; no labels = 0).
        const earned = labels.reduce(
          (max, name) => Math.max(max, pointsMap[name] ?? 0),
          0
        );
        // Tasks that earn 0 points used to be invisible. Now, instead of
        // silently dropping them, we queue them for manual review so the user
        // can assign a points value or discard them ("going forward only" —
        // no retroactive scoring of history). They are still marked processed
        // so they are skipped on future syncs.
        if (earned > 0) {
          const labelDesc = labels.length ? ` [${labels.join(", ")}]` : "";
          insertLedger.run(earned, task.id, `${task.content}${labelDesc}`);
          newlyProcessed += 1;
          pointsAwarded += earned;
        } else {
          insertPendingReview.run(
            task.id,
            task.content,
            JSON.stringify(labels),
            task.completed_at ?? null
          );
        }
        markProcessed.run(task.id);
      }
      db.prepare(
        `INSERT INTO sync_state (key, value) VALUES ('last_sync', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(until);
    });
    tx();

    const pendingReview = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM pending_review`)
        .get() as { c: number }
    ).c;

    return NextResponse.json({
      ok: true,
      scanned: completed.length,
      newlyProcessed,
      pointsAwarded,
      pendingReview,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

// Todoist's by_completion_date interprets naive since/until in the ACCOUNT'S
// LOCAL timezone, NOT UTC. So we must emit LOCAL wall-clock components — using
// toISOString() (UTC) here shifts the window by the local offset and drops
// recently-completed tasks. last_sync is stored in this same local format, so
// `new Date(value)` (which parses a naive ISO string as local) round-trips
// correctly. Assumes the machine's timezone matches the Todoist account's.
function formatTodoistTs(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

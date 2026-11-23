import { NextResponse } from "next/server";
import { getCompletedTasks } from "@/lib/todoist";
import { getDb } from "@/lib/db";

// POST: fetch completed tasks since the last sync. For each completion not
// already processed: if points were set ahead of time (Review → Upcoming), award
// exactly that; otherwise queue it for manual review (Review → Completed).
// Labels play no part in scoring. Idempotent — re-syncing never re-awards or
// re-queues.
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

    const alreadyProcessed = db.prepare(
      `SELECT 1 FROM processed_completions WHERE completion_id = ?`
    );
    const markProcessed = db.prepare(
      `INSERT OR IGNORE INTO processed_completions (completion_id) VALUES (?)`
    );
    const insertPendingReview = db.prepare(
      `INSERT OR IGNORE INTO pending_review
         (completion_id, content, labels, completed_at, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );
    const insertLedger = db.prepare(
      `INSERT INTO ledger (type, points, source_id, description) VALUES ('earn', ?, ?, ?)`
    );
    // Points set ahead of time, keyed by the ACTIVE task id, which equals the
    // completed item's `id` here (verified 2026-07-08).
    const lookupOverride = db.prepare(
      `SELECT points FROM task_point_overrides WHERE task_id = ?`
    );
    const deleteOverride = db.prepare(
      `DELETE FROM task_point_overrides WHERE task_id = ?`
    );
    let newlyQueued = 0;
    let preassignedAwarded = 0;

    const tx = db.transaction(() => {
      for (const task of completed) {
        // Idempotency guard FIRST: a completion already processed is skipped
        // entirely, so re-syncing a stale window can never re-queue it — and a
        // completion that was awarded, discarded, or whose earning was removed
        // from the dashboard never comes back.
        if (alreadyProcessed.get(task.id)) continue;

        const override = lookupOverride.get(task.id) as
          | { points: number }
          | undefined;
        if (override) {
          // Pre-assigned: award EXACTLY that value, skip the review queue, and
          // delete the now-stale override in this same transaction. The
          // " (pre-assigned)" suffix is stripped for display (earningTitle).
          insertLedger.run(override.points, task.id, `${task.content} (pre-assigned)`);
          deleteOverride.run(task.id);
          preassignedAwarded += 1;
        } else {
          // Everything else goes to the review queue ("going forward only" —
          // no retroactive scoring of history). The pending_review.labels
          // column is kept for schema stability but is never displayed.
          const queued = insertPendingReview.run(
            task.id,
            task.content,
            JSON.stringify(task.labels ?? []),
            task.completed_at ?? null
          );
          newlyQueued += queued.changes;
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
      newlyQueued,
      preassignedAwarded,
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

// Server-side Todoist unified API v1 client. The token is read from the
// environment and must NEVER be exposed to the browser.

const BASE = "https://api.todoist.com/api/v1";

function token(): string {
  const t = process.env.TODOIST_API_TOKEN;
  if (!t) {
    throw new Error(
      "TODOIST_API_TOKEN is not set. Copy .env.example to .env and set it."
    );
  }
  return t;
}

async function apiGetText(
  path: string,
  params: Record<string, string> = {}
): Promise<string> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Todoist API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.text();
}

async function apiGet(
  path: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  return JSON.parse(await apiGetText(path, params));
}

// A Todoist `due` object (present only on tasks that have a due date/time).
export interface TodoistDue {
  date: string; // e.g. "2026-07-08" (or an ISO datetime for timed tasks)
  datetime?: string | null;
  string?: string; // the natural-language string the user typed, e.g. "Jul 8"
  is_recurring?: boolean;
  // Todoist also sends lang, timezone, etc.; /api/upcoming drops them.
}

export interface UpcomingTask {
  id: string;
  content: string;
  due: TodoistDue | null;
}

// Active (uncompleted) tasks for the Review page's Upcoming section: every task
// that has a due date, PLUS any task whose id is in `keepIds` even without one
// (the ids with points already saved, so an override on a task whose due date
// was later removed stays visible and clearable). `GET /tasks` paginates with
// { results, next_cursor }.
//
// ID LINKAGE (verified empirically 2026-07-08): the `id` returned here is the
// SAME id that later appears as `id` on the corresponding completed item from
// /tasks/completed/by_completion_date (that endpoint returns the full task
// object; there is no separate task_id). So an override keyed on this `id`
// matches a completion directly on `completedTask.id`. See the sync route.
export async function getUpcomingTasks(
  keepIds: ReadonlySet<string>
): Promise<UpcomingTask[]> {
  const out: UpcomingTask[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { limit: "200" };
    if (cursor) params.cursor = cursor;
    const page = (await apiGet("/tasks", params)) as {
      results: Array<{ id: string; content: string; due?: TodoistDue | null }>;
      next_cursor: string | null;
    };
    for (const t of page.results ?? []) {
      if (t.due || keepIds.has(t.id)) {
        out.push({ id: t.id, content: t.content, due: t.due ?? null });
      }
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

export interface CompletedTask {
  id: string;
  content: string;
  labels: string[];
  completed_at: string;
}

// Completed tasks endpoint paginates with { items, next_cursor }.
// `since`/`until` are required and use the format YYYY-MM-DDTHH:MM:SS.
export async function getCompletedTasks(
  since: string,
  until: string
): Promise<CompletedTask[]> {
  const out: CompletedTask[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { since, until, limit: "200" };
    if (cursor) params.cursor = cursor;
    const page = (await apiGet(
      "/tasks/completed/by_completion_date",
      params
    )) as { items: CompletedTask[]; next_cursor: string | null };
    out.push(...(page.items ?? []));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

// ---------------------------------------------------------------------------
// Recurring-task completions (activity log)
// ---------------------------------------------------------------------------
// /tasks/completed/by_completion_date does NOT return completions of recurring
// tasks (verified 2026-11-23), and every occurrence of a recurring task shares
// one task id anyway. The activity log does have them: one `completed` event
// per completion, each with its own event id. We take ONLY events whose
// extra_data.is_recurring === true from here; non-recurring completions also
// appear in the log but are handled by getCompletedTasks (keyed on task id),
// so taking them here too would double-count.

export interface RecurringCompletion {
  eventId: string; // unique per completion
  taskId: string; // the same for every occurrence
  content: string;
  completedAt: string; // ISO UTC, e.g. "2026-11-20T12:00:00.000000Z"
}

interface ActivityEvent {
  id?: string | number;
  event_type?: string;
  object_type?: string;
  object_id?: string;
  event_date?: string;
  extra_data?: { content?: unknown; is_recurring?: unknown } | null;
}

// Event ids are integers far beyond 2^53, sent as bare JSON numbers, so plain
// JSON.parse would round them (and could merge two events into one key). Keep
// the exact digits via the reviver's source text (Node 21+ / V8 11.4+).
function parseKeepingBigIds(text: string): unknown {
  return JSON.parse(text, ((key: string, value: unknown, ctx?: { source?: string }) =>
    key === "id" && typeof value === "number" && ctx?.source ? ctx.source : value
  ) as (key: string, value: unknown) => unknown);
}

// /activities `date_from` / `date_to` take an ISO datetime and a naive value
// is read as UTC (verified 2026-11-23), unlike by_completion_date's account-
// local since/until. So send explicit UTC ("…Z"). Pagination: { results,
// next_cursor }, `cursor` param, `limit` up to 100.
export function toActivityTs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const MAX_ACTIVITY_PAGES = 200;

export async function getRecurringCompletions(
  since: Date,
  until: Date
): Promise<RecurringCompletion[]> {
  const out: RecurringCompletion[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const params: Record<string, string> = {
      object_type: "item",
      event_type: "completed",
      date_from: toActivityTs(since),
      date_to: toActivityTs(until),
      limit: "100",
    };
    if (cursor) params.cursor = cursor;
    const page = parseKeepingBigIds(await apiGetText("/activities", params)) as {
      results?: ActivityEvent[];
      next_cursor?: string | null;
    };
    for (const e of page.results ?? []) {
      if (e.event_type !== "completed" || e.object_type !== "item") continue;
      if (e.extra_data?.is_recurring !== true) continue;
      if (e.id === undefined || e.id === null || !e.object_id || !e.event_date) continue;
      out.push({
        eventId: String(e.id),
        taskId: String(e.object_id),
        content:
          typeof e.extra_data.content === "string" ? e.extra_data.content : "(untitled task)",
        completedAt: e.event_date,
      });
    }
    cursor = page.next_cursor ?? undefined;
    // A repeating cursor (or a runaway page count) would loop forever; fail
    // instead, so the sync holds the recurring window and retries next run.
    if (cursor !== undefined) {
      if (seenCursors.has(cursor) || seenCursors.size >= MAX_ACTIVITY_PAGES) {
        throw new Error("Todoist /activities pagination did not terminate");
      }
      seenCursors.add(cursor);
    }
  } while (cursor);
  return out;
}

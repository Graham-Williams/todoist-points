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

async function apiGet(
  path: string,
  params: Record<string, string> = {}
): Promise<unknown> {
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
  return res.json();
}

export interface TodoistLabel {
  id: string;
  name: string;
  color?: string;
}

// Labels are paginated with { results, next_cursor }.
export async function getLabels(): Promise<TodoistLabel[]> {
  const out: TodoistLabel[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { limit: "200" };
    if (cursor) params.cursor = cursor;
    const page = (await apiGet("/labels", params)) as {
      results: TodoistLabel[];
      next_cursor: string | null;
    };
    out.push(...(page.results ?? []));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

// A Todoist `due` object (present only on tasks that have a due date/time).
export interface TodoistDue {
  date: string; // human date, e.g. "2026-07-08" (or an ISO datetime for timed tasks)
  string?: string; // the natural-language string the user typed, e.g. "Jul 8"
  is_recurring?: boolean;
}

export interface ActiveDatedTask {
  id: string;
  content: string;
  labels: string[];
  due: TodoistDue;
}

// Active (uncompleted) tasks that have a due date. The active-tasks endpoint
// paginates with { results, next_cursor } (same shape as /labels). We filter to
// tasks whose `due` object is present.
//
// ID LINKAGE (verified empirically 2026-07-08): the `id` returned here is the
// SAME id that later appears as `id` on the corresponding completed item from
// /tasks/completed/by_completion_date (that endpoint returns the full task
// object; there is no separate task_id/v2_task_id). So an override keyed on this
// `id` matches a completion directly on `completedTask.id`. See sync route.
export async function getActiveDatedTasks(): Promise<ActiveDatedTask[]> {
  const out: ActiveDatedTask[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { limit: "200" };
    if (cursor) params.cursor = cursor;
    const page = (await apiGet("/tasks", params)) as {
      results: Array<{
        id: string;
        content: string;
        labels?: string[];
        due?: TodoistDue | null;
      }>;
      next_cursor: string | null;
    };
    for (const t of page.results ?? []) {
      if (t.due) {
        out.push({
          id: t.id,
          content: t.content,
          labels: t.labels ?? [],
          due: t.due,
        });
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

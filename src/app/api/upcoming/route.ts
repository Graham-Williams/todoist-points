import { NextResponse } from "next/server";
import { getActiveDatedTasks, type TodoistDue } from "@/lib/todoist";
import {
  applyOrder,
  getOrderMap,
  getTaskOverridesMap,
  isCompletionProcessed,
} from "@/lib/queries";

// Only the due fields the Review page uses.
function trimDue(due: TodoistDue): TodoistDue {
  const out: TodoistDue = { date: due.date };
  if (due.datetime != null) out.datetime = due.datetime;
  if (due.string !== undefined) out.string = due.string;
  if (due.is_recurring !== undefined) out.is_recurring = due.is_recurring;
  return out;
}

// GET: uncompleted Todoist tasks that have a due date, left-joined with any
// points set ahead of time. Response: { tasks: [{ id, content, due,
// points|null }] } in the user's drag order (list 'upcoming').
//
// Excluded, because points set on them could never pay out (sync dedupes on
// the task id before the override lookup, and a task id is only ever counted
// once): recurring tasks, and tasks whose id is already in
// processed_completions (e.g. reopened after being completed).
export async function GET() {
  try {
    const tasks = await getActiveDatedTasks();
    const overrides = getTaskOverridesMap();
    const merged = tasks
      .filter((t) => !t.due.is_recurring && !isCompletionProcessed(t.id))
      .map((t) => ({
        id: t.id,
        content: t.content,
        due: trimDue(t.due),
        points: Object.hasOwn(overrides, t.id) ? overrides[t.id] : null,
      }));
    const ordered = applyOrder(merged, (t) => t.id, getOrderMap("upcoming"));
    return NextResponse.json({ tasks: ordered });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to load upcoming tasks" },
      { status: 500 }
    );
  }
}

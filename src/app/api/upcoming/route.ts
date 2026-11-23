import { NextResponse } from "next/server";
import { getActiveDatedTasks } from "@/lib/todoist";
import { applyOrder, getOrderMap, getTaskOverridesMap } from "@/lib/queries";

// GET: uncompleted Todoist tasks that have a due date, left-joined with any
// points set ahead of time. Response: { tasks: [{ id, content, due,
// points|null }] } in the user's drag order (list 'upcoming').
export async function GET() {
  try {
    const tasks = await getActiveDatedTasks();
    const overrides = getTaskOverridesMap();
    const merged = tasks.map((t) => ({
      id: t.id,
      content: t.content,
      due: t.due,
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

import { NextResponse } from "next/server";
import { getActiveDatedTasks } from "@/lib/todoist";
import { getTaskOverridesMap, applyOrder, getOrderMap } from "@/lib/queries";

// GET: list uncompleted Todoist tasks that have a due date, left-joined with any
// saved manual point override. Response: { tasks: [{ id, content, labels, due,
// points|null }] } — `points` is the pre-assigned override (null if none).
export async function GET() {
  try {
    const tasks = await getActiveDatedTasks();
    const overrides = getTaskOverridesMap();
    const merged = tasks.map((t) => ({
      id: t.id,
      content: t.content,
      labels: t.labels,
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

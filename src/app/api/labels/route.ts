import { NextResponse } from "next/server";
import { getLabels } from "@/lib/todoist";
import { getDb } from "@/lib/db";
import { getLabelPointsMap, applyOrder, getOrderMap } from "@/lib/queries";

// GET: list Todoist labels merged with their configured point values (0 default).
export async function GET() {
  try {
    const labels = await getLabels();
    const pointsMap = getLabelPointsMap();
    const merged = labels.map((l) => ({
      name: l.name,
      color: l.color ?? null,
      points: pointsMap[l.name] ?? 0,
    }));
    const ordered = applyOrder(merged, (l) => l.name, getOrderMap("labels"));
    return NextResponse.json({ labels: ordered });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to load labels" },
      { status: 500 }
    );
  }
}

// POST: persist point values. Body: { points: { [labelName]: number } }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { points?: Record<string, number> };
    const points = body.points ?? {};
    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO label_points (label_name, points) VALUES (?, ?)
       ON CONFLICT(label_name) DO UPDATE SET points = excluded.points`
    );
    const tx = db.transaction((entries: [string, number][]) => {
      for (const [name, val] of entries) {
        upsert.run(name, Math.trunc(Number(val) || 0));
      }
    });
    tx(Object.entries(points));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to save label points" },
      { status: 500 }
    );
  }
}

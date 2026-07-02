import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// PATCH: edit a reward (name, cost, active). Body may include any subset.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      name?: string;
      cost?: number;
      active?: boolean;
    };
    const db = getDb();
    const existing = db
      .prepare(`SELECT * FROM rewards WHERE id = ?`)
      .get(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (typeof body.name === "string") {
      sets.push("name = ?");
      values.push(body.name.trim());
    }
    if (body.cost !== undefined) {
      const cost = Math.trunc(Number(body.cost));
      if (!Number.isFinite(cost) || cost < 1) {
        return NextResponse.json(
          { error: "Cost must be a positive integer" },
          { status: 400 }
        );
      }
      sets.push("cost = ?");
      values.push(cost);
    }
    if (body.active !== undefined) {
      sets.push("active = ?");
      values.push(body.active ? 1 : 0);
    }
    if (sets.length) {
      values.push(id);
      db.prepare(`UPDATE rewards SET ${sets.join(", ")} WHERE id = ?`).run(
        ...values
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update reward" },
      { status: 500 }
    );
  }
}

// DELETE: remove a reward.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare(`DELETE FROM rewards WHERE id = ?`).run(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete reward" },
      { status: 500 }
    );
  }
}

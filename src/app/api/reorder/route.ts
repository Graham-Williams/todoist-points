import { NextResponse } from "next/server";
import { ORDER_LISTS, setOrder } from "@/lib/queries";

// POST: persist a manual drag order for one list. Body: { list, order }, where
// `list` is one of ORDER_LISTS and `order` is the full array of item keys in
// their new positions. Shared by the rewards / labels / review / upcoming lists.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      list?: unknown;
      order?: unknown;
    };
    const { list, order } = body;
    if (typeof list !== "string" || !ORDER_LISTS.has(list)) {
      return NextResponse.json({ error: "Invalid list" }, { status: 400 });
    }
    if (
      !Array.isArray(order) ||
      !order.every((k) => typeof k === "string")
    ) {
      return NextResponse.json({ error: "Invalid order" }, { status: 400 });
    }
    setOrder(list, order);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to save order" },
      { status: 500 }
    );
  }
}

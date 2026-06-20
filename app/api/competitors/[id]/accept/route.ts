import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { competitors } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { error: "Demo mode: write operations are disabled." },
      { status: 403 }
    );
  }

  const { id } = await params;

  const updated = await db
    .update(competitors)
    .set({
      status: "accepted",
      updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    })
    .where(
      and(
        eq(competitors.id, id),
        eq(competitors.status, "suggested"),
        isNull(competitors.deletedAt)
      )
    )
    .returning();

  if (updated.length === 0) {
    return NextResponse.json(
      { error: "Competitor not found, already accepted, or rejected." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, competitor: updated[0] });
}

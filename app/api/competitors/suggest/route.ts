import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { suggestCompetitors } from "@/lib/ai/analyzers/suggest-competitors";

export const runtime = "nodejs";

const BodySchema = z.object({ count: z.number().int().min(1).max(20).optional() });

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { error: "Demo mode: write operations are disabled. Clone the repo to use full functionality." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await suggestCompetitors(parsed.data.count ?? 10);
    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      excludedCount: result.excludedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { competitors } from "@/lib/db/schema";

export const runtime = "nodejs";

const AddSchema = z.object({
  name: z.string().min(1).max(200),
  metaPageUrl: z.string().url().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  websiteUrl: z.string().url().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { error: "Demo mode: write operations are disabled." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const inserted = await db
    .insert(competitors)
    .values({
      name: parsed.data.name.trim(),
      status: "manual",
      metaPageUrl: parsed.data.metaPageUrl,
      websiteUrl: parsed.data.websiteUrl,
    })
    .returning();

  return NextResponse.json({ ok: true, competitor: inserted[0] });
}

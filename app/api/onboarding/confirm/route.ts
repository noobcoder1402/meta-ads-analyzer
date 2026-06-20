import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { competitors } from "@/lib/db/schema";
import { CompanyProfileSchema } from "@/lib/ai/schemas";

export const runtime = "nodejs";

const ConfirmSchema = z.object({
  profile: CompanyProfileSchema,
  websiteUrl: z.string().min(1),
  metaPageUrl: z.string().optional().nullable(),
  country: z.string().min(1),
});

const PREFS_PATH = path.join(process.cwd(), "data", "preferences.json");
const COMPANY_MD_PATH = path.join(process.cwd(), "context", "company.md");

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { error: "Demo mode: write operations are disabled. Clone the repo to use full functionality." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { profile, websiteUrl, metaPageUrl, country } = parsed.data;

  const markdown = renderCompanyMarkdown(profile, websiteUrl);
  await fs.mkdir(path.dirname(COMPANY_MD_PATH), { recursive: true });
  await fs.writeFile(COMPANY_MD_PATH, markdown, "utf8");

  await savePreferences({ country });

  const existing = await db
    .select()
    .from(competitors)
    .where(eq(competitors.status, "self"))
    .limit(1);

  let selfId: string;
  if (existing[0]) {
    const updated = await db
      .update(competitors)
      .set({
        name: profile.company_name,
        websiteUrl,
        metaPageUrl: metaPageUrl ?? null,
        country,
        updatedAt: nowSql(),
        deletedAt: null,
      })
      .where(eq(competitors.id, existing[0].id))
      .returning();
    selfId = updated[0].id;
  } else {
    const inserted = await db
      .insert(competitors)
      .values({
        name: profile.company_name,
        status: "self",
        websiteUrl,
        metaPageUrl: metaPageUrl ?? null,
        country,
      })
      .returning();
    selfId = inserted[0].id;
  }

  return NextResponse.json({ ok: true, selfId });
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function renderCompanyMarkdown(
  profile: z.infer<typeof CompanyProfileSchema>,
  websiteUrl: string
): string {
  return `# ${profile.company_name}

> Auto-generated from ${websiteUrl}. Edit freely — manual edits are preserved on re-scrape.

## What we do

${profile.what_we_do}

## Who we serve

${profile.who_we_serve}

## How we're different

${profile.how_were_different}

## Goals

<!-- Optional. What are you trying to achieve? e.g., "Test founder-led content this quarter" -->
`;
}

async function savePreferences(prefs: { country: string }) {
  await fs.mkdir(path.dirname(PREFS_PATH), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(PREFS_PATH, "utf8");
    existing = JSON.parse(raw);
  } catch {
    // First write — fine.
  }
  const merged = { ...existing, defaultCountry: prefs.country };
  await fs.writeFile(PREFS_PATH, JSON.stringify(merged, null, 2), "utf8");
}

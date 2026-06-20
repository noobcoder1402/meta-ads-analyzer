import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCompetitorById, setCompetitorMetaPage } from "@/lib/db/queries";
import { buildCanonicalPageUrl } from "@/lib/scraper/resolve-meta-page";

export const runtime = "nodejs";

const Body = z.object({
  pageId: z.string().regex(/^\d{6,}$/, "page_id must be at least 6 digits"),
  country: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { error: "Demo mode: write operations are disabled." },
      { status: 403 }
    );
  }

  const { id } = await ctx.params;
  const competitor = await getCompetitorById(id);
  if (!competitor) {
    return NextResponse.json({ error: "Competitor not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const country = parsed.data.country ?? competitor.country ?? "US";
  const canonicalUrl = buildCanonicalPageUrl(parsed.data.pageId, country);

  await setCompetitorMetaPage({
    competitorId: id,
    pageId: parsed.data.pageId,
    canonicalUrl,
  });

  return NextResponse.json({ ok: true });
}

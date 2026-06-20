import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCompetitorById } from "@/lib/db/queries";
import { parseMetaPageInput } from "@/lib/scraper/parse-meta-page-input";
import { verifyMetaPage } from "@/lib/scraper/verify-meta-page";

// Playwright needs Node, not edge. Verify takes 10-30s so don't run on Vercel free.
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  input: z.string().min(1).max(2000),
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

  // 1. Parse the free-text input into a page_id (or detect vanity / invalid).
  const parseResult = parseMetaPageInput(parsed.data.input);
  if (parseResult.kind === "invalid") {
    return NextResponse.json({ error: parseResult.reason }, { status: 400 });
  }
  if (parseResult.kind === "vanity") {
    return NextResponse.json(
      {
        error:
          `That looks like a vanity URL (facebook.com/${parseResult.vanity}). ` +
          `Open Meta's Ad Library, navigate to that brand, and paste the URL from your address bar — it should contain "view_all_page_id=…".`,
      },
      { status: 400 }
    );
  }

  // 2. Verify by hitting Meta and confirming the page resolves with at least a page_name.
  const result = await verifyMetaPage(parseResult.pageId, country);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    candidate: {
      pageId: result.pageId,
      pageName: result.pageName,
      adCount: result.adCount,
      verified: result.verified,
      profilePictureUrl: result.profilePictureUrl,
      canonicalUrl: result.canonicalUrl,
    },
  });
}

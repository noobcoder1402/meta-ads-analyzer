import { NextRequest } from "next/server";
import { synthesizeCompetitor } from "@/lib/ai/analyzers/synthesize-competitor";
import { getCompetitorById } from "@/lib/db/queries";

// Anthropic SDK → Node runtime. One Sonnet call; well under the limit.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Trigger a competitor synthesis. Single Sonnet call, so plain JSON (not SSE) —
 * unlike scrape/analyze which stream per-item progress.
 *
 * Demo mode is blocked: synthesis writes to competitor_syntheses AND calls a paid
 * AI API. The deployed Vercel demo must never do either.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.DEMO_MODE === "true") {
    return Response.json(
      { error: "Demo mode: write operations are disabled." },
      { status: 403 }
    );
  }

  const { id } = await ctx.params;
  const competitor = await getCompetitorById(id);
  if (!competitor) {
    return Response.json({ error: "Competitor not found." }, { status: 404 });
  }

  try {
    const result = await synthesizeCompetitor({
      competitorId: id,
      competitorName: competitor.name,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown synthesizer error." },
      { status: 500 }
    );
  }
}

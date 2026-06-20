// Orchestrator: read a competitor's ads, run the pure scorer over each, and
// persist the results to performance_scores. This is the only file in lib/scoring/
// that does I/O — performance-score.ts and buckets.ts stay pure.
//
// Scoring is deterministic and free (no AI calls), so it's safe to re-run any
// time. The scraper calls this automatically after each successful scrape.

import { getAdsByCompetitor, upsertScore } from "@/lib/db/queries";
import { performanceScore, type ScoreBreakdown } from "./performance-score";

/** Compact human-readable summary of the breakdown, stored on the score row. */
function buildExplanation(b: ScoreBreakdown): string {
  return b.signals
    .map((s) => `${s.detail} (${s.points}/${s.max})`)
    .join(" · ");
}

/**
 * Score every ad for one competitor and upsert the rows. Returns how many ads
 * were scored. Pure-math + DB writes only — never throws on bad data (the scorer
 * clamps), but DB errors propagate to the caller, who decides how to handle them.
 */
export async function scoreCompetitorAds(competitorId: string): Promise<number> {
  const ads = await getAdsByCompetitor(competitorId);

  for (const ad of ads) {
    const breakdown = performanceScore({
      daysActive: ad.daysActive,
      placements: ad.placements ?? [],
      isActive: ad.isActive,
      lastSeenAt: ad.lastSeenAt,
    });

    await upsertScore({
      adId: ad.id,
      score: breakdown.score,
      longevityPts: breakdown.longevityPts,
      // variant signal was dropped (Meta doesn't expose a reliable variant count);
      // the column is unused legacy and always 0. See docs/scoring.md.
      variantPts: 0,
      placementPts: breakdown.placementPts,
      recencyPts: breakdown.recencyPts,
      explanation: buildExplanation(breakdown),
    });
  }

  return ads.length;
}

/**
 * Server-side loader — the single seam where the pure analysis functions meet the DB.
 *
 * Reads every active competitor's ads + the time of their latest successful scrape,
 * runs each through `analyzeCompetitor`, then folds them with `analyzeAcross`. Called
 * by the Insights page on every request (the "fresh analysis each time" model — no
 * analysis table, no cache). Importing the DB client makes this implicitly server-only.
 */
import { getActiveCompetitors, getAdsByCompetitor, getLatestSuccessfulScrapeAt } from "../db/queries";
import { analyzeCompetitor, analyzeAcross } from "./index";
import type { CompetitorAnalysis } from "./analyze-competitor";
import type { CrossAnalysis } from "./analyze-across";
import type { Ad } from "../db/schema";

/** A brand's raw ads + scrape reference — kept so the page can re-lens the mix tables to
 * the active/inactive segment without a second DB round-trip. */
export type BrandAds = {
  id: string;
  name: string;
  isSelf: boolean;
  ads: Ad[];
  latestScrapeAt: string | null;
};

export type CrossAnalysisBundle = {
  /** One per active competitor, `self` first (matches getActiveCompetitors order). */
  analyses: CompetitorAnalysis[];
  /** Raw ads per brand, same order as `analyses`. */
  brands: BrandAds[];
  cross: CrossAnalysis;
  /** True once at least one competitor has scraped ads — else the page shows an empty state. */
  hasAnyAds: boolean;
};

export async function loadCrossAnalysis(): Promise<CrossAnalysisBundle> {
  const competitors = await getActiveCompetitors();

  const data = await Promise.all(
    competitors.map(async (c) => {
      const [ads, latestScrapeAt] = await Promise.all([
        getAdsByCompetitor(c.id),
        getLatestSuccessfulScrapeAt(c.id),
      ]);
      const isSelf = c.status === "self";
      const analysis = analyzeCompetitor({
        competitorId: c.id,
        competitorName: c.name,
        isSelf,
        ads,
        latestScrapeAt,
      });
      const brand: BrandAds = { id: c.id, name: c.name, isSelf, ads, latestScrapeAt };
      return { analysis, brand };
    }),
  );

  const analyses = data.map((d) => d.analysis);
  return {
    analyses,
    brands: data.map((d) => d.brand),
    cross: analyzeAcross(analyses),
    hasAnyAds: analyses.some((a) => a.totalAds > 0),
  };
}

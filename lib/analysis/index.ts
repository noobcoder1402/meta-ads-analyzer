/**
 * Deterministic analysis layer — public surface.
 *
 * Zero AI. Pure functions over already-scraped ads + scores, recomputed on every read.
 * See docs/analysis.md for the full metric catalogue and docs/meta-ads-mechanics.md for
 * what Meta does / doesn't expose (so nothing here over-claims spend/reach/market-share).
 */
export { analyzeCompetitor } from "./analyze-competitor";
export type { CompetitorAnalysis, AnalyzeCompetitorInput } from "./analyze-competitor";
export { analyzeAcross } from "./analyze-across";
export type { CrossAnalysis, HeadToHeadRow, Gap } from "./analyze-across";
export {
  LONGEVITY_TIERS,
  COPY_SHORT_MAX,
  COPY_MEDIUM_MAX,
  longevityTierKey,
  isLive,
  creativeKey,
  distinctCreatives,
} from "./metrics";
export type { Phrase } from "./phrases";
export { topPhrases } from "./phrases";
export type { AnalysisAd, Tally, LongevityTier, MediaKind } from "./types";

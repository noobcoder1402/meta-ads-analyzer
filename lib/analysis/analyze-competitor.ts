/**
 * Per-competitor analysis composer — folds the pure metrics in `metrics.ts` + phrase
 * mining + language detection into one `CompetitorAnalysis` object the UI renders.
 *
 * Pure (no DB, no AI): pass in the competitor's ad rows and the latest scrape time; get
 * back the full analysis. Recomputed on every read (the "fresh analysis each time" model).
 */
import { aggregateLanguages, type CreativeLanguages } from "../lang/detect-languages";
import { topPhrases, type Phrase } from "./phrases";
import type { AnalysisAd, LongevityTier, Tally } from "./types";
import {
  advertiserContext,
  allCopy,
  copyLengthMix,
  creativeScaling,
  ctaMix,
  distinctCreatives,
  isLive,
  landingDomains,
  launchVelocity,
  longevityBreakdown,
  medianDaysActive,
  mediaMix,
  placementSpread,
  structureMix,
} from "./metrics";

export type CompetitorAnalysis = {
  competitorId: string;
  competitorName: string;
  isSelf: boolean;

  totalAds: number;
  liveCount: number;
  notLiveCount: number; // inactive (paused/ended) ads

  /** De-confounded volume (see metrics.creativeKey): distinct creatives behind the raw
   * entry counts, so build style (manual duplication vs DCO) doesn't distort comparison.
   * Still a FLOOR — DCO entries bundle internal variants we can't split. */
  distinctCreatives: number; // across all ads
  distinctLiveCreatives: number; // across live ads

  longevity: { tiers: LongevityTier[]; liveCount: number };
  /** Median run length (days_active) across ALL ads, live + paused. Null if no ads. */
  medianDaysActiveAll: number | null;

  /** Creative mix across all of the brand's ads (media kind, ad structure, copy length). */
  creative: {
    media: Tally[];
    structure: Tally[];
    copyLength: Tally[];
  };

  cta: Tally[];
  phrases: Phrase[];
  languages: CreativeLanguages;
  placements: Tally[];
  domains: Tally[];
  scaling: ReturnType<typeof creativeScaling>;
  advertiser: ReturnType<typeof advertiserContext>;
  velocity: ReturnType<typeof launchVelocity>;
};

export type AnalyzeCompetitorInput = {
  competitorId: string;
  competitorName: string;
  isSelf: boolean;
  ads: AnalysisAd[];
  /** Latest successful scrape start time ("YYYY-MM-DD HH:MM:SS"); null if never scraped. */
  latestScrapeAt?: string | null;
  /** Injected for testability; defaults to now. */
  now?: Date;
};

export function analyzeCompetitor(input: AnalyzeCompetitorInput): CompetitorAnalysis {
  const { ads, latestScrapeAt } = input;
  const now = input.now ?? new Date();

  const live = ads.filter((a) => isLive(a, latestScrapeAt));

  return {
    competitorId: input.competitorId,
    competitorName: input.competitorName,
    isSelf: input.isSelf,

    totalAds: ads.length,
    liveCount: live.length,
    notLiveCount: ads.length - live.length,

    distinctCreatives: distinctCreatives(ads),
    distinctLiveCreatives: distinctCreatives(live),

    longevity: longevityBreakdown(ads, latestScrapeAt),
    medianDaysActiveAll: medianDaysActive(ads),

    creative: {
      media: mediaMix(ads),
      structure: structureMix(ads),
      copyLength: copyLengthMix(ads),
    },

    cta: ctaMix(ads),
    phrases: topPhrases(ads.map(allCopy)),
    languages: aggregateLanguages(ads.map((a) => a.caption ?? a.title)),
    placements: placementSpread(ads),
    domains: landingDomains(ads),
    scaling: creativeScaling(ads),
    advertiser: advertiserContext(ads),
    velocity: launchVelocity(ads, now),
  };
}

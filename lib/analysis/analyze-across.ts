/**
 * Cross-competitor analysis — head-to-head summary + "self gap" (what rivals lean on
 * that the user's own `self` brand under-uses). Pure: folds already-computed
 * `CompetitorAnalysis` objects together; no DB, no AI.
 *
 * The self-gap is deliberately a SHARE comparison, never a spend/volume claim — Meta
 * gives us no spend, so "competitors run more video than you" is defensible but
 * "competitors outspend you on video" is not (see docs/meta-ads-mechanics.md).
 */
import type { CreativeLanguages } from "../lang/detect-languages";
import type { CompetitorAnalysis } from "./analyze-competitor";
import type { Tally } from "./types";

export type HeadToHeadRow = {
  competitorId: string;
  competitorName: string;
  isSelf: boolean;
  totalAds: number;
  liveCount: number;
  notLiveCount: number;
  /** De-confounded volume: distinct creatives among live ads (fairer than raw entries). */
  distinctLiveCreatives: number;
  topCta: string | null;
  topMedia: string | null;
  topLanguage: string | null;
};

/** A dimension where competitors out-index the user's own brand. */
export type Gap = {
  label: string;
  competitorShare: number; // mean share across non-self competitors (0–1)
  selfShare: number; // 0–1
  delta: number; // competitorShare − selfShare (positive = a gap)
};

export type CrossAnalysis = {
  headToHead: HeadToHeadRow[];
  selfPresent: boolean;
  gaps: { cta: Gap[]; media: Gap[]; language: Gap[]; placement: Gap[] };
};

/** Min share-points a competitor must out-index the user by for it to count as a gap. */
const GAP_MIN_DELTA = 0.1;

function tallyShares(tallies: Tally[]): Map<string, number> {
  return new Map(tallies.map((t) => [t.label, t.share]));
}
function languageShares(langs: CreativeLanguages): Map<string, number> {
  return new Map(langs.languages.map((l) => [l.label, l.share]));
}

function computeGaps(
  self: CompetitorAnalysis,
  competitors: CompetitorAnalysis[],
  shareOf: (a: CompetitorAnalysis) => Map<string, number>,
): Gap[] {
  if (competitors.length === 0) return [];
  const selfShares = shareOf(self);
  const compShares = competitors.map(shareOf);

  const labels = new Set<string>();
  for (const m of compShares) for (const label of m.keys()) labels.add(label);

  return [...labels]
    .map((label) => {
      const competitorShare =
        compShares.reduce((sum, m) => sum + (m.get(label) ?? 0), 0) / competitors.length;
      const selfShare = selfShares.get(label) ?? 0;
      return { label, competitorShare, selfShare, delta: competitorShare - selfShare };
    })
    .filter((g) => g.delta >= GAP_MIN_DELTA)
    .sort((a, b) => b.delta - a.delta);
}

export function analyzeAcross(analyses: CompetitorAnalysis[]): CrossAnalysis {
  const headToHead: HeadToHeadRow[] = analyses.map((a) => ({
    competitorId: a.competitorId,
    competitorName: a.competitorName,
    isSelf: a.isSelf,
    totalAds: a.totalAds,
    liveCount: a.liveCount,
    notLiveCount: a.notLiveCount,
    distinctLiveCreatives: a.distinctLiveCreatives,
    topCta: a.cta[0]?.label ?? null,
    topMedia: a.creative.media[0]?.label ?? null,
    topLanguage: a.languages.languages[0]?.label ?? null,
  }));

  const self = analyses.find((a) => a.isSelf);
  const competitors = analyses.filter((a) => !a.isSelf);

  const gaps = self
    ? {
        cta: computeGaps(self, competitors, (a) => tallyShares(a.cta)),
        media: computeGaps(self, competitors, (a) => tallyShares(a.creative.media)),
        language: computeGaps(self, competitors, (a) => languageShares(a.languages)),
        placement: computeGaps(self, competitors, (a) => tallyShares(a.placements)),
      }
    : { cta: [], media: [], language: [], placement: [] };

  return { headToHead, selfPresent: !!self, gaps };
}

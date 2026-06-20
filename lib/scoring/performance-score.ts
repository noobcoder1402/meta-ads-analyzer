// Performance scoring — see docs/scoring.md for the rationale behind every weight.
//
// Meta's public Ad Library exposes no spend, impressions, or conversion data, so
// performance can't be measured — only inferred. Every signal answers one question:
// "would the advertiser keep this ad running if it weren't working?"
//
// THREE signals only. A fourth ("variant count" — how many near-identical creatives
// an advertiser split-tests) would be a strong signal, but Meta does not reliably
// expose it: `cards[]` conflates carousel slides with DCO format variants, and
// `collation_count` is null/1 in practice. Rather than ship a 4th signal that's
// structurally always 0 (which silently capped every real score at 80/100), the
// 20 points it used to hold were redistributed into longevity/placement/recency so
// the 0-100 scale means what it says. The `variant_*` DB columns remain as unused
// legacy (append-only migrations) and are always written as 0.
//
// Pure module: no I/O, no async. Re-runnable any time without re-scraping.

/** The minimal ad shape scoring needs. A full `Ad` row satisfies this. */
export type ScorableAd = {
  daysActive: number;
  placements: string[];
  isActive: boolean;
  lastSeenAt: string;
};

export type ScoreSignal = {
  key: "longevity" | "placement" | "recency";
  label: string;
  points: number;
  max: number;
  /** Human-readable reason for the points, e.g. "Running 124 days". */
  detail: string;
};

export type ScoreBreakdown = {
  /** 0–100. Equals the sum of the rounded signal points so the UI bars add up. */
  score: number;
  longevityPts: number;
  placementPts: number;
  recencyPts: number;
  signals: ScoreSignal[];
};

export const SIGNAL_MAX = {
  longevity: 60,
  placement: 20,
  recency: 20,
} as const;

/**
 * Longevity (max 60, biggest weight). Advertisers kill losing ads within 2–3
 * days, so a long-running ad is almost certainly profitable. Log-scaled because
 * the first month is when winners separate from losers; beyond ~130 days the
 * signal is saturated and caps at 60.
 *
 * Curve is anchored on the two bucket-defining points so a real-budget,
 * ~3-month-old ad clears the "winner" bar: 30 days ≈ 36 pts, 90 days ≈ 54 pts,
 * ~130+ days → 60 (capped). See docs/scoring.md.
 */
export function longevityPoints(daysActive: number): number {
  if (daysActive <= 0) return 0;
  const pts = 37.8 * Math.log10(daysActive) - 19.8;
  return Math.max(0, Math.min(SIGNAL_MAX.longevity, pts));
}

/**
 * Placement spread (max 20). Running across Feed/Reels/Stories/etc. commits more
 * budget and trusts the ad across formats. 5 points per placement, capped at 4.
 */
export function placementPoints(placements: string[]): number {
  return Math.min(SIGNAL_MAX.placement, placements.length * 5);
}

/**
 * Currently active (max 20). A live ad is a stronger signal than a paused one.
 * A recently-paused ad still counts a little — it was probably a winner cycled
 * out for a creative refresh. A long-paused ad tells us nothing.
 */
export function recencyPoints(isActive: boolean, daysSinceLastSeen: number): number {
  if (isActive) return SIGNAL_MAX.recency;
  if (daysSinceLastSeen < 30) return 10;
  return 0;
}

/** Whole days between `lastSeenAt` and now. SQLite stores UTC without a tz suffix. */
export function daysSince(lastSeenAt: string): number {
  const normalised =
    lastSeenAt.includes("T") || lastSeenAt.endsWith("Z")
      ? lastSeenAt
      : lastSeenAt.replace(" ", "T") + "Z";
  const ms = Date.now() - new Date(normalised).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export function performanceScore(ad: ScorableAd): ScoreBreakdown {
  const daysSinceLastSeen = daysSince(ad.lastSeenAt);

  const longevityPts = Math.round(longevityPoints(ad.daysActive));
  const placementPts = Math.round(placementPoints(ad.placements));
  const recencyPts = Math.round(recencyPoints(ad.isActive, daysSinceLastSeen));

  const signals: ScoreSignal[] = [
    {
      key: "longevity",
      label: "Longevity",
      points: longevityPts,
      max: SIGNAL_MAX.longevity,
      detail:
        ad.daysActive > 0
          ? `Running ${ad.daysActive} day${ad.daysActive === 1 ? "" : "s"}`
          : "Just launched",
    },
    {
      key: "placement",
      label: "Placement",
      points: placementPts,
      max: SIGNAL_MAX.placement,
      detail: `${ad.placements.length} placement${
        ad.placements.length === 1 ? "" : "s"
      }`,
    },
    {
      key: "recency",
      label: "Recency",
      points: recencyPts,
      max: SIGNAL_MAX.recency,
      detail: ad.isActive
        ? "Currently active"
        : daysSinceLastSeen < 30
        ? "Recently paused"
        : "Long paused",
    },
  ];

  return {
    score: longevityPts + placementPts + recencyPts,
    longevityPts,
    placementPts,
    recencyPts,
    signals,
  };
}

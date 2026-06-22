/**
 * Shared types for the deterministic analysis layer (`lib/analysis/`).
 *
 * `AnalysisAd` is the minimal ad shape every metric needs — a structural subset of the
 * Drizzle `Ad` row, so a real `Ad` is assignable to it and the pure metric functions
 * stay testable with hand-built fixtures (no DB).
 */

export type MediaKind = "image" | "video" | "carousel";

/** The minimal per-ad fields the analysis reads. A full `Ad` satisfies this. */
export type AnalysisAd = {
  id: string;
  libraryId: string;
  caption: string | null;
  title: string | null;
  linkDescription: string | null;
  extraTexts: string[] | null;
  ctaLabel: string | null;
  landingUrl: string | null;
  displayLink: string | null;
  mediaType: MediaKind | null;
  displayFormat: string | null;
  isActive: boolean;
  daysActive: number;
  placements: string[] | null;
  collationCount: number | null;
  collationId: string | null;
  pageLikeCount: number | null;
  pageCategories: string[] | null;
  startDate: string | null;
  lastSeenAt: string;
};

/** A counted category with its share of the relevant denominator (0–1). */
export type Tally = { label: string; count: number; share: number };

/** One longevity tier (live ads only). */
export type LongevityTier = {
  key: "testing" | "established" | "strong" | "proven" | "hallOfFame";
  label: string;
  minDays: number;
  maxDays: number; // exclusive; Infinity for the top tier
  count: number;
  /** Library IDs in this tier, longest-running first. */
  adIds: string[];
};

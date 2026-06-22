/**
 * Deterministic per-ad-set metrics — pure functions, ZERO AI, computed on-read.
 *
 * Everything here is over data Meta already gave us (longevity, CTA, media, placements,
 * copy, domains). No spend / impressions / reach is ever inferred — those are null for
 * commercial ads (see docs/meta-ads-mechanics.md). Pure module → unit-tested.
 */
import type { AnalysisAd, LongevityTier, Tally } from "./types";

// ─── Tunable thresholds (single source of truth; surfaced in the UI explainer) ───

/** Longevity tiers apply to LIVE ads only (a paused ad isn't "running"). The labels are
 * neutral run-length bands — they describe how long an ad has been live, NOT a judgment
 * that a long run is "better" (Meta exposes no spend/conversions to prove that).
 * Boundaries in days_active (Meta start→now for live ads). max is exclusive. */
export const LONGEVITY_TIERS: ReadonlyArray<
  Pick<LongevityTier, "key" | "label" | "minDays" | "maxDays">
> = [
  { key: "testing", label: "Testing", minDays: 0, maxDays: 30 },
  { key: "established", label: "Established", minDays: 30, maxDays: 60 },
  { key: "strong", label: "Strong", minDays: 60, maxDays: 90 },
  { key: "proven", label: "Long-running", minDays: 90, maxDays: 180 },
  { key: "hallOfFame", label: "Veteran", minDays: 180, maxDays: Infinity },
];

/** Copy-length bands, in characters of the ad's primary copy. */
export const COPY_SHORT_MAX = 80;
export const COPY_MEDIUM_MAX = 200;

// ─── Live predicate + segment lens ───────────────────────────────────────────

/**
 * Is this ad live RIGHT NOW? Snapshot model: it must be flagged active by Meta AND have
 * been seen in the latest scrape. `latestScrapeAt` is the latest successful scrape's
 * start time (same "YYYY-MM-DD HH:MM:SS" format as `lastSeenAt`, so string compare is
 * chronological). If we have no scrape time, fall back to Meta's flag alone.
 */
export function isLive(ad: AnalysisAd, latestScrapeAt?: string | null): boolean {
  if (!ad.isActive) return false;
  if (!latestScrapeAt) return true;
  return ad.lastSeenAt >= latestScrapeAt;
}

/** A view onto an advertiser's library: everything, only the live ads, or only the
 * not-live (paused/ended) ads. Used by the Insights "segment toggle" to re-lens the mix
 * tables. `active` + `inactive` partition `all`. No value judgment — just live vs not. */
export type Segment = "all" | "active" | "inactive";

/** Does this ad belong to the selected segment? (`all` is always true.) */
export function inSegment(
  ad: AnalysisAd,
  latestScrapeAt: string | null | undefined,
  segment: Segment,
): boolean {
  if (segment === "active") return isLive(ad, latestScrapeAt);
  if (segment === "inactive") return !isLive(ad, latestScrapeAt);
  return true;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** The author-written primary copy for an ad (caption preferred, title fallback). */
export function primaryCopy(ad: AnalysisAd): string {
  return (ad.caption ?? ad.title ?? "").trim();
}

/** All author-written copy for an ad, for phrase mining (never the CTA — it's localized). */
export function allCopy(ad: AnalysisAd): string {
  return [ad.caption, ad.title, ad.linkDescription, ...(ad.extraTexts ?? [])]
    .filter((t): t is string => !!t && t.trim().length > 0)
    .join(" \n ");
}

function tally(counts: Map<string, number>, denom: number): Tally[] {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: denom > 0 ? count / denom : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

// ─── Longevity (LIVE ads only) ───────────────────────────────────────────────

export function longevityTierKey(daysActive: number): LongevityTier["key"] {
  for (const t of LONGEVITY_TIERS) {
    if (daysActive >= t.minDays && daysActive < t.maxDays) return t.key;
  }
  return "hallOfFame";
}

/**
 * Bucket the LIVE ads into longevity tiers. Paused/ended ads are deliberately excluded —
 * the tiers measure how long ads have been *running*, so a stopped ad has no place here.
 * Each tier lists its ads longest-running first.
 */
export function longevityBreakdown(
  ads: AnalysisAd[],
  latestScrapeAt?: string | null,
): { tiers: LongevityTier[]; liveCount: number } {
  const live = ads.filter((a) => isLive(a, latestScrapeAt));
  const tiers: LongevityTier[] = LONGEVITY_TIERS.map((t) => ({ ...t, count: 0, adIds: [] }));
  const byKey = new Map(tiers.map((t) => [t.key, t]));

  for (const ad of [...live].sort((a, b) => b.daysActive - a.daysActive)) {
    const tier = byKey.get(longevityTierKey(ad.daysActive));
    if (tier) {
      tier.count += 1;
      tier.adIds.push(ad.libraryId);
    }
  }
  return { tiers, liveCount: live.length };
}

/**
 * Median `days_active` across ALL ads (live + paused) — a single robust "typical run
 * length" number that isn't skewed by a few very-long-running ads the way a mean is.
 * Note `days_active` is run length, not calendar age: live = launch→today, paused =
 * launch→stop (frozen). Returns null for an empty set.
 */
export function medianDaysActive(ads: AnalysisAd[]): number | null {
  if (ads.length === 0) return null;
  const sorted = ads.map((a) => a.daysActive).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(median);
}

// ─── Creative mix ─────────────────────────────────────────────────────────────

export function mediaLabel(ad: AnalysisAd): string {
  switch (ad.mediaType) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "carousel":
      return "Carousel";
    default:
      return "Unknown";
  }
}

/** Ad STRUCTURE from Meta's display_format (DCO ≠ carousel — see CLAUDE.md). Falls back
 * to media kind for old rows where display_format is null (pre-2026-06-20 capture). */
export function structureLabel(ad: AnalysisAd): string {
  switch (ad.displayFormat) {
    case "DCO":
      // User-facing label — keep it plain (no "DCO" acronym). The "Ad structure"
      // section description explains what dynamic creative means.
      return "Dynamic creative";
    case "CAROUSEL":
      return "Carousel";
    case "IMAGE":
      return "Single image";
    case "VIDEO":
      return "Single video";
    default:
      // old rows: infer from media kind
      if (ad.mediaType === "carousel") return "Carousel";
      if (ad.mediaType === "video") return "Single video";
      if (ad.mediaType === "image") return "Single image";
      return "Unknown";
  }
}

export function copyLengthLabel(ad: AnalysisAd): string {
  const len = primaryCopy(ad).length;
  if (len === 0) return "No primary copy";
  if (len < COPY_SHORT_MAX) return "Short";
  if (len < COPY_MEDIUM_MAX) return "Medium";
  return "Long";
}

function tallyBy(ads: AnalysisAd[], keyFn: (ad: AnalysisAd) => string): Tally[] {
  const counts = new Map<string, number>();
  for (const ad of ads) bump(counts, keyFn(ad));
  return tally(counts, ads.length);
}

export function mediaMix(ads: AnalysisAd[]): Tally[] {
  return tallyBy(ads, mediaLabel);
}
export function structureMix(ads: AnalysisAd[]): Tally[] {
  return tallyBy(ads, structureLabel);
}
export function copyLengthMix(ads: AnalysisAd[]): Tally[] {
  return tallyBy(ads, copyLengthLabel);
}
export function ctaMix(ads: AnalysisAd[]): Tally[] {
  // Raw Meta CTA label — exactly what they use, never invented. Null → "No CTA".
  return tallyBy(ads, (a) => (a.ctaLabel?.trim() ? a.ctaLabel.trim() : "No CTA"));
}

// ─── Placements ───────────────────────────────────────────────────────────────

const PLACEMENT_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  audience_network: "Audience Network",
  threads: "Threads",
};

/** Placement spread (document frequency: how many ads run on each surface). Denominator
 * is the number of ads with any placement data, so shares read as "% of ads on X". */
export function placementSpread(ads: AnalysisAd[]): Tally[] {
  const counts = new Map<string, number>();
  let withPlacements = 0;
  for (const ad of ads) {
    const places = ad.placements ?? [];
    if (places.length === 0) continue;
    withPlacements += 1;
    for (const p of new Set(places)) bump(counts, PLACEMENT_LABELS[p] ?? p);
  }
  return tally(counts, withPlacements);
}

// ─── Landing domains ────────────────────────────────────────────────────────────

export function domainOf(ad: AnalysisAd): string | null {
  const disp = ad.displayLink?.trim();
  if (disp) return disp.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const url = ad.landingUrl?.trim();
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The landing host + PATH (query/hash stripped, trailing slash removed). Unlike
 * `domainOf`, this keeps the path — which is the real signal, since every brand's ads
 * point to its own domain, so the *page* (`/lp/get-started`, `/pricing`) is what tells
 * you which offer/feature they're driving traffic to.
 */
export function landingPath(ad: AnalysisAd): string | null {
  const url = ad.landingUrl?.trim();
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    return path ? `${host}${path}` : host;
  } catch {
    return null;
  }
}

/** Top landing pages (host+path) by how many ads point to each. Within-competitor: it
 * surfaces each brand's most-advertised pages/offers. Denominator = ads with a path. */
export function landingPages(ads: AnalysisAd[], top = 6): Tally[] {
  const counts = new Map<string, number>();
  let withPath = 0;
  for (const ad of ads) {
    const p = landingPath(ad);
    if (!p) continue;
    withPath += 1;
    bump(counts, p);
  }
  return tally(counts, withPath).slice(0, top);
}

export function landingDomains(ads: AnalysisAd[]): Tally[] {
  const counts = new Map<string, number>();
  let withDomain = 0;
  for (const ad of ads) {
    const d = domainOf(ad);
    if (!d) continue;
    withDomain += 1;
    bump(counts, d);
  }
  return tally(counts, withDomain);
}

// ─── De-duplication: raw ad entries → distinct creatives (Meta's signal only) ────

/**
 * A stable key for the underlying creative behind a (possibly duplicated) ad entry.
 *
 * WHY: raw `ad_archive_id` count is confounded by build style — a brand that copies one
 * creative across many ad-sets (manual duplication) shows many entries; a DCO/Advantage+
 * brand shows few. So cross-competitor volume must be compared on DISTINCT CREATIVES.
 *
 * We use ONLY Meta's own `collationId` ("these entries share one creative & text"). We do
 * NOT guess similarity from caption/media/CTA — an entry Meta did not collate is counted
 * as its own creative (keyed by `libraryId`). This means the count can still OVER-state
 * distinct creatives (true duplicates Meta didn't group stay separate) and UNDER-state
 * them for DCO bundlers (one entry hides many internal variants). It's Meta's grouping,
 * surfaced honestly — not our inference.
 */
export function creativeKey(ad: AnalysisAd): string {
  return ad.collationId ? `coll:${ad.collationId}` : `id:${ad.libraryId}`;
}

/** Number of distinct creatives behind a set of ad entries, per Meta's `collation_id`. */
export function distinctCreatives(ads: AnalysisAd[]): number {
  return new Set(ads.map(creativeKey)).size;
}

// ─── Creative scaling (collation) — within-competitor, display only ─────────────

/** Meta's "N ads use this creative & text" count. Confounded across competitors (see
 * CLAUDE.md), so we only surface the within-competitor top scalers. */
export function creativeScaling(
  ads: AnalysisAd[],
  top = 5,
): { maxCollation: number; topScaled: Array<{ libraryId: string; collationCount: number }> } {
  const scaled = ads
    .filter((a) => (a.collationCount ?? 0) > 1)
    .map((a) => ({ libraryId: a.libraryId, collationCount: a.collationCount ?? 0 }))
    .sort((a, b) => b.collationCount - a.collationCount);
  return { maxCollation: scaled[0]?.collationCount ?? 0, topScaled: scaled.slice(0, top) };
}

// ─── Advertiser context (needs re-scrape on old rows) ──────────────────────────

export function advertiserContext(
  ads: AnalysisAd[],
): { pageLikeCount: number | null; pageCategories: string[] } {
  // Take the freshest (latest last_seen_at) row that actually has the data.
  const withData = ads
    .filter((a) => a.pageLikeCount != null || (a.pageCategories?.length ?? 0) > 0)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const latest = withData[0];
  return {
    pageLikeCount: latest?.pageLikeCount ?? null,
    pageCategories: latest?.pageCategories ?? [],
  };
}

// ─── Launch velocity / timeline (needs start_date → re-scrape on old rows) ───────

export function launchVelocity(
  ads: AnalysisAd[],
  now: Date,
): { hasDates: boolean; last14: number; last30: number } {
  const dated = ads.filter((a) => !!a.startDate);
  const nowMs = now.getTime();
  const within = (days: number) =>
    dated.filter((a) => {
      const t = Date.parse(a.startDate as string);
      return Number.isFinite(t) && nowMs - t <= days * 86_400_000 && nowMs - t >= 0;
    }).length;
  return { hasDates: dated.length > 0, last14: within(14), last30: within(30) };
}

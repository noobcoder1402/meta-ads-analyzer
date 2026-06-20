import { eq, isNull, desc, and, notInArray, sql } from "drizzle-orm";
import { db } from "./client";
import {
  competitors,
  ads,
  performanceScores,
  scrapeRuns,
  type Competitor,
  type Ad,
} from "./schema";

// ─── Competitors ────────────────────────────────────────────────────

/** All non-deleted competitors. Self is always first. */
export function getCompetitors() {
  return db
    .select()
    .from(competitors)
    .where(isNull(competitors.deletedAt))
    .orderBy(
      // self first, then by name
      sql`CASE WHEN ${competitors.status} = 'self' THEN 0 ELSE 1 END`,
      competitors.name
    );
}

/** The user's own company (status='self'). Null if onboarding hasn't run. */
export function getSelfCompetitor() {
  return db
    .select()
    .from(competitors)
    .where(
      and(eq(competitors.status, "self"), isNull(competitors.deletedAt))
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/** One competitor by ID (non-deleted). */
export function getCompetitorById(id: string) {
  return db
    .select()
    .from(competitors)
    .where(and(eq(competitors.id, id), isNull(competitors.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/** Active competitors only — accepted + manual + self. Excludes 'suggested' and soft-deleted. */
export function getActiveCompetitors() {
  return db
    .select()
    .from(competitors)
    .where(
      and(
        isNull(competitors.deletedAt),
        sql`${competitors.status} IN ('self', 'accepted', 'manual')`
      )
    )
    .orderBy(
      sql`CASE WHEN ${competitors.status} = 'self' THEN 0 ELSE 1 END`,
      competitors.name
    );
}

/** Current suggested competitors (not yet accepted, not rejected). */
export function getSuggestedCompetitors() {
  return db
    .select()
    .from(competitors)
    .where(
      and(eq(competitors.status, "suggested"), isNull(competitors.deletedAt))
    )
    .orderBy(desc(competitors.createdAt));
}

/** Update meta_page_id + meta_page_url for one competitor (verified setter). */
export async function setCompetitorMetaPage(input: {
  competitorId: string;
  pageId: string;
  canonicalUrl: string;
}) {
  await db
    .update(competitors)
    .set({
      metaPageId: input.pageId,
      metaPageUrl: input.canonicalUrl,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(competitors.id, input.competitorId));
}

/**
 * Count of tracked competitors (accepted/manual, excluding self) that don't have a verified
 * meta_page_id yet. Drives the "Needs your help" banner on the competitors page.
 */
export function countCompetitorsNeedingPageSetup() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(competitors)
    .where(
      and(
        isNull(competitors.deletedAt),
        isNull(competitors.metaPageId),
        sql`${competitors.status} IN ('accepted', 'manual')`
      )
    )
    .then((rows) => rows[0]?.count ?? 0);
}

// ─── Ads ────────────────────────────────────────────────────────────

/** All ads for one competitor, newest first. */
export function getAdsByCompetitor(competitorId: string) {
  return db
    .select()
    .from(ads)
    .where(eq(ads.competitorId, competitorId))
    .orderBy(desc(ads.lastSeenAt));
}

// ─── Scores ─────────────────────────────────────────────────────────

/** Score for one ad (or null). */
export function getScoreForAd(adId: string) {
  return db
    .select()
    .from(performanceScores)
    .where(eq(performanceScores.adId, adId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/** All scores for one competitor's ads (joined via ads.competitorId). */
export function getScoresForCompetitor(competitorId: string) {
  return db
    .select({
      adId: performanceScores.adId,
      score: performanceScores.score,
      longevityPts: performanceScores.longevityPts,
      variantPts: performanceScores.variantPts,
      placementPts: performanceScores.placementPts,
      recencyPts: performanceScores.recencyPts,
      explanation: performanceScores.explanation,
    })
    .from(performanceScores)
    .innerJoin(ads, eq(performanceScores.adId, ads.id))
    .where(eq(ads.competitorId, competitorId));
}

// ─── Swipe file (cross-competitor reads) ────────────────────────────

/** An ad plus the brand it belongs to — what the swipe-file cards render. */
export type SwipeFileAd = Ad & {
  competitorName: string;
  competitorStatus: Competitor["status"];
};

/**
 * Every ad across all non-deleted competitors (including the user's own `self`
 * brand), each tagged with its brand name + status. Newest first. The swipe file
 * buckets these in the client; this is one bulk read instead of N per-competitor.
 */
export function getSwipeFileAds(): Promise<SwipeFileAd[]> {
  return db
    .select({
      ad: ads,
      competitorName: competitors.name,
      competitorStatus: competitors.status,
    })
    .from(ads)
    .innerJoin(competitors, eq(ads.competitorId, competitors.id))
    .where(isNull(competitors.deletedAt))
    .orderBy(desc(ads.lastSeenAt))
    .then((rows) =>
      rows.map((r) => ({
        ...r.ad,
        competitorName: r.competitorName,
        competitorStatus: r.competitorStatus,
      }))
    );
}

/** All performance scores. Caller keys by adId; extra rows for absent ads are harmless. */
export function getAllScores() {
  return db.select({
    adId: performanceScores.adId,
    score: performanceScores.score,
    longevityPts: performanceScores.longevityPts,
    variantPts: performanceScores.variantPts,
    placementPts: performanceScores.placementPts,
    recencyPts: performanceScores.recencyPts,
    explanation: performanceScores.explanation,
  }).from(performanceScores);
}

/** Insert or update (by ad) one ad's deterministic performance score. */
export async function upsertScore(input: {
  adId: string;
  score: number;
  longevityPts: number;
  variantPts: number;
  placementPts: number;
  recencyPts: number;
  explanation: string;
}): Promise<void> {
  await db
    .insert(performanceScores)
    .values(input)
    .onConflictDoUpdate({
      target: performanceScores.adId,
      set: {
        score: input.score,
        longevityPts: input.longevityPts,
        variantPts: input.variantPts,
        placementPts: input.placementPts,
        recencyPts: input.recencyPts,
        explanation: input.explanation,
        updatedAt: sql`(datetime('now'))`,
      },
    });
}

// ─── Scrape Runs ────────────────────────────────────────────────────

/** Latest scrape run for one competitor (or null). */
export function getLatestScrapeRun(competitorId: string) {
  return db
    .select()
    .from(scrapeRuns)
    .where(eq(scrapeRuns.competitorId, competitorId))
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/** Insert a new scrape_runs row at the start of a scrape. Returns the inserted row's id. */
export async function startScrapeRun(input: {
  competitorId: string;
  country: string | null;
}) {
  const id = crypto.randomUUID();
  await db.insert(scrapeRuns).values({
    id,
    competitorId: input.competitorId,
    status: "partial",
    country: input.country,
  });
  return id;
}

/** Finalize a scrape_runs row with counts + status. */
export async function finishScrapeRun(input: {
  id: string;
  status: "success" | "partial" | "failed";
  adsFound: number;
  adsNew: number;
  adsUnchanged: number;
  adsWentInactive: number;
  errorMessage?: string | null;
}) {
  await db
    .update(scrapeRuns)
    .set({
      status: input.status,
      adsFound: input.adsFound,
      adsNew: input.adsNew,
      adsUnchanged: input.adsUnchanged,
      adsWentInactive: input.adsWentInactive,
      errorMessage: input.errorMessage ?? null,
      completedAt: sql`(datetime('now'))`,
    })
    .where(eq(scrapeRuns.id, input.id));
}

// ─── Ad upsert (used by scrape.ts) ──────────────────────────────────

/** Library IDs currently in the DB for one competitor. Used to compute new vs unchanged vs went-inactive. */
export async function getLibraryIdsForCompetitor(competitorId: string) {
  const rows = await db
    .select({ libraryId: ads.libraryId, isActive: ads.isActive })
    .from(ads)
    .where(eq(ads.competitorId, competitorId));
  return rows;
}

/**
 * Insert a new ad row, or refresh Meta-derived fields if the libraryId already exists.
 * Returns whether the ad was newly inserted (true) or already existed (false).
 *
 * On re-scrape the update refreshes caption, title, ctaLabel, landingUrl, mediaUrls,
 * mediaType, displayFormat, isActive, daysActive, placements, countries, collationCount,
 * collationId, and containsAiMedia (so classifier/extraction improvements propagate
 * without a migration). It deliberately does NOT touch mediaPaths (locally downloaded
 * files), variantCount (unused legacy), or firstSeenAt. See CLAUDE.md "upsertScrapedAd…".
 */
export async function upsertScrapedAd(input: {
  competitorId: string;
  libraryId: string;
  caption: string | null;
  ctaLabel: string | null;
  landingUrl: string | null;
  mediaPaths: string[];
  mediaUrls: string[];
  mediaType: "image" | "video" | "carousel" | null;
  isActive: boolean;
  daysActive: number;
  placements: string[];
  /** Country libraries this ad was seen in on THIS run (ISO codes). Unioned with prior runs. */
  countries: string[];
  /** Ad headline (snapshot.title), distinct from the body caption. */
  title: string | null;
  /** Meta's ad-structure label: "IMAGE" | "VIDEO" | "CAROUSEL" | "DCO". */
  displayFormat: string | null;
  /** "N ads use this creative" group size. null when Meta doesn't populate it. */
  collationCount: number | null;
  /** Meta's group ID behind collationCount. */
  collationId: string | null;
  /** Meta's AI/digitally-created-media flag. */
  containsAiMedia: boolean | null;
  // ─── Extended Meta capture (2026-06-20) ───────────────────────────────
  startDate: string | null;
  endDate: string | null;
  videoUrls: string[];
  linkDescription: string | null;
  displayLink: string | null;
  pageLikeCount: number | null;
  pageCategories: string[];
  pageProfileUri: string | null;
  pageProfilePictureUrl: string | null;
  adCategories: string[];
  extraTexts: string[];
  extraImageUrls: string[];
  extraVideoUrls: string[];
  containsSensitiveContent: boolean | null;
  isReshared: boolean | null;
  brandedContent: unknown;
  pageIsDeleted: boolean | null;
}): Promise<{ isNew: boolean; adId: string }> {
  const existing = await db
    .select({ id: ads.id, countries: ads.countries })
    .from(ads)
    .where(eq(ads.libraryId, input.libraryId))
    .limit(1);

  if (existing.length > 0) {
    const adId = existing[0].id;
    // Union this run's markets with what we've already recorded — a US-only
    // re-scrape must never erase a market a previous scan discovered.
    const mergedCountries = [
      ...new Set([...(existing[0].countries ?? []), ...input.countries]),
    ].sort();

    // Refresh ALL Meta-derived fields on re-scrape. Earlier versions of this
    // function only updated isActive/daysActive, which meant improvements to
    // the classifier (e.g. fixing mediaType detection) silently failed to
    // propagate to pre-existing rows.
    //
    // We deliberately do NOT touch:
    //   - mediaPaths: local files we've already downloaded; the URLs in
    //     mediaUrls can rotate but the local copies stay valid.
    //   - firstSeenAt, createdAt: provenance fields.
    //
    // placements IS refreshed here: it's a Meta-derived field (publisher_platform)
    // that earlier scraper versions dropped, so re-scraping is how pre-existing
    // ad rows get backfilled — no migration needed.
    await db
      .update(ads)
      .set({
        caption: input.caption,
        title: input.title,
        ctaLabel: input.ctaLabel,
        landingUrl: input.landingUrl,
        mediaUrls: input.mediaUrls,
        mediaType: input.mediaType,
        displayFormat: input.displayFormat,
        isActive: input.isActive,
        daysActive: input.daysActive,
        placements: input.placements,
        countries: mergedCountries,
        collationCount: input.collationCount,
        collationId: input.collationId,
        containsAiMedia: input.containsAiMedia,
        // Extended capture — all Meta-derived, so re-scrape backfills pre-existing rows.
        startDate: input.startDate,
        endDate: input.endDate,
        videoUrls: input.videoUrls,
        linkDescription: input.linkDescription,
        displayLink: input.displayLink,
        pageLikeCount: input.pageLikeCount,
        pageCategories: input.pageCategories,
        pageProfileUri: input.pageProfileUri,
        pageProfilePictureUrl: input.pageProfilePictureUrl,
        adCategories: input.adCategories,
        extraTexts: input.extraTexts,
        extraImageUrls: input.extraImageUrls,
        extraVideoUrls: input.extraVideoUrls,
        containsSensitiveContent: input.containsSensitiveContent,
        isReshared: input.isReshared,
        brandedContent: input.brandedContent,
        pageIsDeleted: input.pageIsDeleted,
        lastSeenAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(ads.id, adId));
    return { isNew: false, adId };
  }

  const adId = crypto.randomUUID();
  await db.insert(ads).values({
    id: adId,
    competitorId: input.competitorId,
    libraryId: input.libraryId,
    caption: input.caption,
    title: input.title,
    ctaLabel: input.ctaLabel,
    landingUrl: input.landingUrl,
    mediaPaths: input.mediaPaths,
    mediaUrls: input.mediaUrls,
    mediaType: input.mediaType,
    displayFormat: input.displayFormat,
    isActive: input.isActive,
    daysActive: input.daysActive,
    placements: input.placements,
    countries: [...new Set(input.countries)].sort(),
    collationCount: input.collationCount,
    collationId: input.collationId,
    containsAiMedia: input.containsAiMedia,
    startDate: input.startDate,
    endDate: input.endDate,
    videoUrls: input.videoUrls,
    linkDescription: input.linkDescription,
    displayLink: input.displayLink,
    pageLikeCount: input.pageLikeCount,
    pageCategories: input.pageCategories,
    pageProfileUri: input.pageProfileUri,
    pageProfilePictureUrl: input.pageProfilePictureUrl,
    adCategories: input.adCategories,
    extraTexts: input.extraTexts,
    extraImageUrls: input.extraImageUrls,
    extraVideoUrls: input.extraVideoUrls,
    containsSensitiveContent: input.containsSensitiveContent,
    isReshared: input.isReshared,
    brandedContent: input.brandedContent,
    pageIsDeleted: input.pageIsDeleted,
  });
  return { isNew: true, adId };
}

/**
 * After a scrape, mark all ads NOT in `seenLibraryIds` for this competitor as inactive.
 * Returns the count of ads transitioned from active → inactive (i.e., "went inactive this run").
 */
export async function markMissingAdsInactive(
  competitorId: string,
  seenLibraryIds: string[]
): Promise<number> {
  // If seenLibraryIds is empty we'd mark everything inactive; guard against that.
  // (An empty scrape result almost always means the scraper failed, not that the brand stopped advertising.)
  if (seenLibraryIds.length === 0) return 0;

  const transitioned = await db
    .select({ id: ads.id })
    .from(ads)
    .where(
      and(
        eq(ads.competitorId, competitorId),
        eq(ads.isActive, true),
        notInArray(ads.libraryId, seenLibraryIds)
      )
    );

  if (transitioned.length === 0) return 0;

  await db
    .update(ads)
    .set({ isActive: false, updatedAt: sql`(datetime('now'))` })
    .where(
      and(
        eq(ads.competitorId, competitorId),
        eq(ads.isActive, true),
        notInArray(ads.libraryId, seenLibraryIds)
      )
    );

  return transitioned.length;
}

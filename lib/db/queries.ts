import { eq, isNull, desc, and, ne, notInArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "./client";
import {
  competitors,
  ads,
  adAnalyses,
  performanceScores,
  competitorSyntheses,
  recommendations,
  scrapeRuns,
  type Competitor,
  type Ad,
  type CompetitorSynthesis,
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

/** Count of ads that lack an analysis row (need analyzing). */
export function getUnanalyzedAdCount(competitorId: string) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(ads)
    .leftJoin(adAnalyses, eq(ads.id, adAnalyses.adId))
    .where(
      and(eq(ads.competitorId, competitorId), isNull(adAnalyses.id))
    )
    .then((rows) => rows[0]?.count ?? 0);
}

/**
 * Count of ads that "need" analysis under the current analyzer version.
 * Includes: never-analyzed ads, ads whose previous analysis_version is stale,
 * and ads whose previous run failed (analysis_failed_at IS NOT NULL).
 *
 * This is what the dashboard's "Analyze N ads" button reads. The simpler
 * getUnanalyzedAdCount above is kept for backwards compat in places that
 * don't yet know about analyzer versioning.
 */
export function getAdsNeedingAnalysisCount(
  competitorId: string,
  currentVersion: string
) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(ads)
    .leftJoin(adAnalyses, eq(ads.id, adAnalyses.adId))
    .where(
      and(
        eq(ads.competitorId, competitorId),
        sql`(
          ${adAnalyses.id} IS NULL
          OR ${adAnalyses.analyzerVersion} != ${currentVersion}
          OR ${adAnalyses.analysisFailedAt} IS NOT NULL
        )`
      )
    )
    .then((rows) => rows[0]?.count ?? 0);
}

/** Count of analyses with outdated analyzer version. */
export function getOutdatedAnalysisCount(currentVersion: string) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(adAnalyses)
    .where(ne(adAnalyses.analyzerVersion, currentVersion))
    .then((rows) => rows[0]?.count ?? 0);
}

// ─── Analysis ───────────────────────────────────────────────────────

/** Full analysis for one ad (or null). */
export function getAnalysisForAd(adId: string) {
  return db
    .select()
    .from(adAnalyses)
    .where(eq(adAnalyses.adId, adId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/**
 * All analysis rows for one competitor's ads (joined via ads.competitorId).
 * Mirrors getScoresForCompetitor — one bulk read instead of N per-card reads.
 * Includes failed stub rows (analysisFailedAt set); the UI decides how to show them.
 */
export function getAnalysesForCompetitor(competitorId: string) {
  return db
    .select({ analysis: adAnalyses })
    .from(adAnalyses)
    .innerJoin(ads, eq(adAnalyses.adId, ads.id))
    .where(eq(ads.competitorId, competitorId))
    .then((rows) => rows.map((r) => r.analysis));
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

/** All analysis rows (including failed stubs). Caller keys by adId. */
export function getAllAnalyses() {
  return db
    .select({ analysis: adAnalyses })
    .from(adAnalyses)
    .then((rows) => rows.map((r) => r.analysis));
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

// ─── Synthesis ──────────────────────────────────────────────────────

/** Latest synthesis for one competitor (or null). */
export function getSynthesisForCompetitor(competitorId: string) {
  return db
    .select()
    .from(competitorSyntheses)
    .where(eq(competitorSyntheses.competitorId, competitorId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

/**
 * All successfully-analyzed ads for one competitor, joined with their analysis
 * + performance score. This is the synthesizer's input (docs/ai-pipeline.md #3).
 * Excludes failed-stub analysis rows. Ordered by score desc for prompt presentation.
 * `score` is null only if scoring hasn't run for an ad (rare); callers default to 0.
 */
export function getAnalyzedAdsForCompetitor(competitorId: string) {
  return db
    .select({
      adId: ads.id,
      libraryId: ads.libraryId,
      daysActive: ads.daysActive,
      isActive: ads.isActive,
      firstSeenAt: ads.firstSeenAt,
      lastSeenAt: ads.lastSeenAt,
      // Author-written copy for deterministic language detection (NEVER the CTA).
      caption: ads.caption,
      title: ads.title,
      // Raw Meta CTA button label ("Sign Up", "Learn More") — the user-facing
      // "selling motion" roll-up (dominantCtas). Replaces the goal-jargon display.
      ctaLabel: ads.ctaLabel,
      // Media kind for the media-mix roll-up.
      mediaType: ads.mediaType,
      hook: adAnalyses.hook,
      angle: adAnalyses.angle,
      angleSecondary: adAnalyses.angleSecondary,
      conversionGoal: adAnalyses.primaryConversionGoal,
      brandVoice: adAnalyses.brandVoice,
      // Per-ad pain points / benefits for the message roll-ups.
      painPoints: adAnalyses.painPoints,
      benefits: adAnalyses.benefits,
      score: performanceScores.score,
    })
    .from(adAnalyses)
    .innerJoin(ads, eq(adAnalyses.adId, ads.id))
    .leftJoin(performanceScores, eq(performanceScores.adId, ads.id))
    .where(
      and(
        eq(ads.competitorId, competitorId),
        isNull(adAnalyses.analysisFailedAt),
        ne(adAnalyses.hook, "")
      )
    )
    .orderBy(desc(performanceScores.score), desc(ads.daysActive));
}

export type CompetitorWithSynthesis = {
  competitorId: string;
  name: string;
  status: Competitor["status"];
  /** null when this competitor hasn't been synthesized ("Find patterns") yet. */
  synthesis: CompetitorSynthesis | null;
};

/**
 * Every ACTIVE competitor (self + accepted + manual) with its synthesis row, if any.
 * Powers the Insights "Competitor scoreboard" — a deterministic, zero-AI side-by-side
 * of the rolled-up numbers we already computed at synthesis time.
 *
 * LEFT join on purpose: competitors WITHOUT a synthesis are still returned (with
 * `synthesis: null`) so the UI can show an honest "not analyzed yet" row instead of
 * silently dropping them. Self is ordered first, then alphabetical — matches the grid.
 */
export async function getSynthesesForActiveCompetitors(): Promise<
  CompetitorWithSynthesis[]
> {
  const rows = await db
    .select({
      competitorId: competitors.id,
      name: competitors.name,
      status: competitors.status,
      synthesis: competitorSyntheses,
    })
    .from(competitors)
    .leftJoin(
      competitorSyntheses,
      eq(competitorSyntheses.competitorId, competitors.id)
    )
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

  return rows.map((r) => ({
    competitorId: r.competitorId,
    name: r.name,
    status: r.status,
    // Drizzle returns an all-null object (not null) for an unmatched LEFT join row.
    synthesis: r.synthesis && r.synthesis.id ? r.synthesis : null,
  }));
}

/** Insert or update (by competitor) the synthesis roll-up. One row per competitor. */
export async function upsertCompetitorSynthesis(input: {
  competitorId: string;
  dominantAngles: Record<string, number>;
  topHooks: string[];
  alwaysOnWinners: string[];
  recentPivots: string;
  dominantConversionGoal: Record<string, number>;
  dominantCtas: Record<string, number>;
  dominantBrandVoice: Record<string, number>;
  activeExperiments: Array<{
    angle: string;
    hook_pattern: string;
    ad_count: number;
    first_seen: string;
  }>;
  abandonedPatterns: Array<{
    angle: string;
    hook_pattern: string;
    ad_count: number;
    last_seen: string;
    typical_days_active: number;
  }>;
  adsAnalyzedCount: number;
  creativeLanguages: CompetitorSynthesis["creativeLanguages"];
  mediaMix: CompetitorSynthesis["mediaMix"];
  topPainPoints: CompetitorSynthesis["topPainPoints"];
  topBenefits: CompetitorSynthesis["topBenefits"];
  launchVelocity: CompetitorSynthesis["launchVelocity"];
}): Promise<void> {
  const set = {
    dominantAngles: input.dominantAngles,
    topHooks: input.topHooks,
    alwaysOnWinners: input.alwaysOnWinners,
    recentPivots: input.recentPivots,
    dominantConversionGoal: input.dominantConversionGoal,
    dominantCtas: input.dominantCtas,
    dominantBrandVoice: input.dominantBrandVoice,
    activeExperiments: input.activeExperiments,
    abandonedPatterns: input.abandonedPatterns,
    adsAnalyzedCount: input.adsAnalyzedCount,
    creativeLanguages: input.creativeLanguages,
    mediaMix: input.mediaMix,
    topPainPoints: input.topPainPoints,
    topBenefits: input.topBenefits,
    launchVelocity: input.launchVelocity,
  };
  await db
    .insert(competitorSyntheses)
    .values({ competitorId: input.competitorId, ...set })
    .onConflictDoUpdate({
      target: competitorSyntheses.competitorId,
      set: { ...set, updatedAt: new Date().toISOString() },
    });
}

// ─── Recommendations ────────────────────────────────────────────────

/** All recommendations, sorted high → low priority then newest-first. */
export function getRecommendations() {
  return db
    .select()
    .from(recommendations)
    .orderBy(
      sql`CASE
        WHEN ${recommendations.priority} = 'high' THEN 0
        WHEN ${recommendations.priority} = 'medium' THEN 1
        ELSE 2
      END`,
      desc(recommendations.createdAt)
    );
}

export type GeneratedRecommendation = {
  title: string;
  priority: "high" | "medium" | "low";
  rationale: string;
  evidenceAdIds: string[];
};

export type ReplaceRecommendationsResult = {
  total: number;
};

/** stable_hash = SHA-1(trimmed title + sorted evidence ad IDs). Per-row identity; also collapses exact dupes within one run. */
function recommendationHash(title: string, evidenceAdIds: string[]): string {
  const sorted = [...evidenceAdIds].sort();
  return createHash("sha1")
    .update(`${title.trim()}|${sorted.join(",")}`)
    .digest("hex");
}

/**
 * Replace-on-run: every generation fully replaces the previous set
 * (docs/ai-pipeline.md task #4).
 *
 * Recommendations carry no user state to preserve (there is no "done"/actioned
 * toggle), so a re-run is just a fresh snapshot of "what to do given the competitor
 * data right now." We delete the old set and insert the new one. The only dedup is
 * within a single run: two recs that hash identically (same title + cited ads)
 * collapse to one, which also keeps stable_hash unique.
 */
export async function replaceRecommendations(
  generated: GeneratedRecommendation[]
): Promise<ReplaceRecommendationsResult> {
  const now = new Date().toISOString();

  const byHash = new Map<string, GeneratedRecommendation>();
  for (const rec of generated) {
    const hash = recommendationHash(rec.title, rec.evidenceAdIds);
    if (!byHash.has(hash)) byHash.set(hash, rec);
  }

  const rows = [...byHash].map(([hash, rec]) => ({
    title: rec.title.trim(),
    priority: rec.priority,
    rationale: rec.rationale,
    evidenceAdIds: rec.evidenceAdIds,
    stableHash: hash,
    lastGeneratedAt: now,
  }));

  await db.delete(recommendations);
  if (rows.length > 0) await db.insert(recommendations).values(rows);

  return { total: rows.length };
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

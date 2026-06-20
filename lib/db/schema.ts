import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── helpers ─────────────────────────────────────────────────────────
// SQLite stores timestamps as ISO strings. These defaults auto-fill on insert.
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`);

const updatedAt = () =>
  text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`);

// ─── 1. competitors ─────────────────────────────────────────────────
// Every tracked brand, including the user's own company (status='self').
export const competitors = sqliteTable("competitors", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  // 'self' = user's own company | 'suggested' = AI-suggested | 'accepted' = user accepted suggestion | 'manual' = user added manually
  status: text("status", {
    enum: ["self", "suggested", "accepted", "manual"],
  }).notNull(),
  metaPageId: text("meta_page_id"),
  metaPageUrl: text("meta_page_url"),
  websiteUrl: text("website_url"),
  faviconUrl: text("favicon_url"),
  country: text("country").default("US"),
  // AI-generated reason for suggesting this competitor
  suggestionReason: text("suggestion_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // Soft-delete: null = active, timestamp = deleted
  deletedAt: text("deleted_at"),
});

// ─── 2. ads ─────────────────────────────────────────────────────────
// Individual ads scraped from Meta Ad Library. One row per unique library ID.
export const ads = sqliteTable("ads", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id),
  // Meta's unique identifier — the only stable key across scrapes
  libraryId: text("library_id").notNull().unique(),
  caption: text("caption"),
  // Ad headline (Meta `snapshot.title`) — distinct from the body `caption`. Fed
  // into the AI analyzer alongside the caption. Null until (re-)scraped.
  title: text("title"),
  ctaLabel: text("cta_label"),
  landingUrl: text("landing_url"),
  // Local paths to downloaded creatives (JSON array of strings)
  mediaPaths: text("media_paths", { mode: "json" }).$type<string[]>(),
  // Original URLs from Meta (JSON array of strings)
  mediaUrls: text("media_urls", { mode: "json" }).$type<string[]>(),
  // Our derived MEDIA KIND. "carousel" is reserved for ads Meta marks as a true
  // CAROUSEL — DCO ads (multiple A/B-tested versions) take their underlying media
  // kind (image/video). The ad STRUCTURE lives in `displayFormat` below.
  mediaType: text("media_type", {
    enum: ["image", "video", "carousel"],
  }),
  // Meta's own ad-structure label: "IMAGE" | "VIDEO" | "CAROUSEL" | "DCO".
  // DCO = "This ad has multiple versions" (within-ad A/B testing). Authoritative
  // source for distinguishing a true carousel from a DCO ad. Null until re-scraped.
  displayFormat: text("display_format"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  // How many days this ad has been running (computed from start date)
  daysActive: integer("days_active").notNull().default(0),
  // UNUSED legacy column (kept for append-only migrations; always 1). A variant-count
  // scoring signal was dropped because Meta doesn't reliably expose it. See docs/scoring.md.
  // (The real "N ads use this creative" number now lives in `collationCount` below.)
  variantCount: integer("variant_count").notNull().default(1),
  // Meta's collation count — "N ads use this creative and text" in the Ad Library:
  // the number of separate ad instances sharing this exact creative (cross-ad
  // scaling signal). MARKET-SCOPED — a single-country scrape sees only that market's
  // count; country=ALL gives the global total. Null when Meta doesn't populate it.
  // NOT a cross-competitor score input (reflects campaign-build style). See docs/scoring.md.
  collationCount: integer("collation_count"),
  // Meta's group ID behind collationCount. Null until (re-)scraped.
  collationId: text("collation_id"),
  // Meta's flag that the creative contains AI/digitally-generated media. Null until re-scraped.
  containsAiMedia: integer("contains_ai_media", { mode: "boolean" }),
  // ─── Extended Meta capture (added 2026-06-20) ──────────────────────────────
  // Real launch / stop timestamps (ISO 8601), converted from Meta's unix seconds.
  // Previously ONLY the derived `daysActive` integer was kept, which made launch
  // dates, "what's new this month", and any timeline impossible. endDate tracks
  // ~today for live ads and is frozen for paused ones. Null until (re-)scraped.
  startDate: text("start_date"),
  endDate: text("end_date"),
  // Actual video file URLs (hd preferred, sd fallback), one per video card. Meta
  // SIGNS these and they EXPIRE within days — we store the URL only (no download),
  // so treat as a short-lived reference, NOT a permanent asset. The still thumbnail
  // used for display/analysis still lives in `mediaUrls`.
  videoUrls: text("video_urls", { mode: "json" }).$type<string[]>(),
  // The ad's link description line (snapshot.link_description) — real ad copy shown
  // under the headline. Distinct from `caption` (body text) and `title` (headline).
  linkDescription: text("link_description"),
  // The display link/domain shown on the ad (snapshot.caption, e.g. "brand.com").
  // NOT the body text — our `caption` column holds body.text, a long-standing naming quirk.
  displayLink: text("display_link"),
  // Advertiser page signals (from snapshot): follower count, business categories,
  // public page URL + logo. Context about WHO is running the ad.
  pageLikeCount: integer("page_like_count"),
  pageCategories: text("page_categories", { mode: "json" }).$type<string[]>(),
  pageProfileUri: text("page_profile_uri"),
  pageProfilePictureUrl: text("page_profile_picture_url"),
  // Top-level ad category (categories[]): "UNKNOWN" for commercial ads, else
  // political / housing / employment / etc. JSON array.
  adCategories: text("ad_categories", { mode: "json" }).$type<string[]>(),
  // DCO variant content (extra_texts / extra_images / extra_videos): alternate copy
  // + creative URLs Meta A/B-tests WITHIN one ad. Often empty; populated on DCO ads.
  extraTexts: text("extra_texts", { mode: "json" }).$type<string[]>(),
  extraImageUrls: text("extra_image_urls", { mode: "json" }).$type<string[]>(),
  extraVideoUrls: text("extra_video_urls", { mode: "json" }).$type<string[]>(),
  // Cheap Meta flags: digitally-sensitive content, reshared post, branded-content
  // partnership payload (object or null), advertiser page deleted.
  containsSensitiveContent: integer("contains_sensitive_content", { mode: "boolean" }),
  isReshared: integer("is_reshared", { mode: "boolean" }),
  brandedContent: text("branded_content", { mode: "json" }),
  pageIsDeleted: integer("page_is_deleted", { mode: "boolean" }),
  // Placements this ad runs on (JSON array: e.g. ["Feed", "Reels", "Stories"])
  placements: text("placements", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  // Which Meta Ad Library country libraries this ad appeared in (ISO codes, e.g.
  // ["US","DE","BR"]). The ONLY reliable geographic signal Meta exposes for
  // commercial ads: the library is country-scoped, so presence = the ad targets
  // that market. Accumulated as a union across scrape runs/markets. Empty until
  // (re-)scraped. See docs/scraping.md "Geographic data".
  countries: text("countries", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  firstSeenAt: text("first_seen_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  lastSeenAt: text("last_seen_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── 3. ad_analyses ─────────────────────────────────────────────────
// AI-generated analysis of one ad. One row per ad (overwritten on re-analyze).
export const adAnalyses = sqliteTable("ad_analyses", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  adId: text("ad_id")
    .notNull()
    .references(() => ads.id)
    .unique(),
  // The SHA-1(prompt + schema) hash that detects analyzer drift
  analyzerVersion: text("analyzer_version").notNull(),
  // ─── AI-analysis columns REMOVED 2026-06-20 (analysis rework from scratch) ──
  // The 13 vision-model fields (hook, angle, angle_secondary, visual_summary,
  // dominant_colors, text_density, subject, themes, pain_points, benefits,
  // target_persona, emotional_tone, brand_voice) were dropped — they fragmented
  // (open-vocabulary text that wouldn't aggregate) and added no bulk-analysis
  // value. A NEW analysis schema will be designed and added next; the scaffolding
  // (id, ad_id, analyzer_version, analysis_failed_at, timestamps) stays.
  // primary_conversion_goal is KEPT — it's CTA-derived (lib/ads/cta-to-goal.ts), not AI.
  primaryConversionGoal: text("primary_conversion_goal", {
    enum: [
      "free-trial",
      "demo-request",
      "direct-purchase",
      "waitlist",
      "app-install",
      "lead-capture",
      "content-download",
      "awareness",
      "other",
    ],
  }),
  // If analysis failed after retries
  analysisFailedAt: text("analysis_failed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── 4. performance_scores ──────────────────────────────────────────
// Deterministic score computed from ads columns. One row per ad. Re-computable any time.
export const performanceScores = sqliteTable("performance_scores", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  adId: text("ad_id")
    .notNull()
    .references(() => ads.id)
    .unique(),
  score: real("score").notNull(),
  longevityPts: real("longevity_pts").notNull(),
  // UNUSED legacy column (kept for append-only migrations; always written 0). The
  // variant scoring signal was dropped — see docs/scoring.md "Why three signals".
  variantPts: real("variant_pts").notNull(),
  placementPts: real("placement_pts").notNull(),
  recencyPts: real("recency_pts").notNull(),
  explanation: text("explanation"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── 5. competitor_syntheses ────────────────────────────────────────
// AI-generated roll-up of patterns for one competitor. One row per competitor (overwritten on re-synthesis).
export const competitorSyntheses = sqliteTable("competitor_syntheses", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id)
    .unique(),
  // Top angles with frequency counts: e.g. { "comparison": 12, "problem-agitation": 8 }
  dominantAngles: text("dominant_angles", { mode: "json" }).$type<
    Record<string, number>
  >(),
  // Top hooks as string array
  topHooks: text("top_hooks", { mode: "json" }).$type<string[]>(),
  // IDs of always-on winner ads (live, score >= 70, days_active >= 60)
  alwaysOnWinners: text("always_on_winners", { mode: "json" }).$type<
    string[]
  >(),
  // Prose describing recent strategic shifts
  recentPivots: text("recent_pivots"),
  // Conversion goal distribution: { "free-trial": 14, "demo-request": 3 }.
  // STILL COMPUTED (from the CTA via cta-to-goal) but NO LONGER SHOWN in the UI —
  // the displayed "selling motion" now uses the raw Meta CTA labels (dominantCtas
  // below) instead of our derived goal taxonomy, which read as confusing jargon.
  // Kept populated for any future use; the recommender + UI read dominantCtas.
  dominantConversionGoal: text("dominant_conversion_goal", {
    mode: "json",
  }).$type<Record<string, number>>(),
  // Raw Meta CTA-button distribution: { "Sign Up": 14, "Learn More": 3 }. This is
  // the user-facing "selling motion" — the actual buttons advertisers chose, not a
  // derived goal label. Null until (re-)synthesized.
  dominantCtas: text("dominant_ctas", { mode: "json" }).$type<
    Record<string, number>
  >(),
  // Brand voice distribution: { "playful": 11, "professional": 4 }
  dominantBrandVoice: text("dominant_brand_voice", { mode: "json" }).$type<
    Record<string, number>
  >(),
  // Active experiments from the stratified-bucket prompt
  activeExperiments: text("active_experiments", { mode: "json" }).$type<
    Array<{
      angle: string;
      hook_pattern: string;
      ad_count: number;
      first_seen: string;
    }>
  >(),
  // Abandoned patterns from the stratified-bucket prompt
  abandonedPatterns: text("abandoned_patterns", { mode: "json" }).$type<
    Array<{
      angle: string;
      hook_pattern: string;
      ad_count: number;
      last_seen: string;
      typical_days_active: number;
    }>
  >(),
  // Total ads analyzed when this synthesis was generated
  adsAnalyzedCount: integer("ads_analyzed_count"),
  // RETIRED legacy column (kept for append-only migrations; always written null).
  // The per-country "market footprint" / "Map markets" feature was removed — Meta
  // exposes no reliable per-ad geography, so the signal was thin and confusing. The
  // column stays to avoid a destructive SQLite table rebuild. See changelog 2026-06-04.
  marketFootprint: text("market_footprint", { mode: "json" }).$type<{
    marketCount: number;
    countries: string[];
    countryCounts: Record<string, number>;
  }>(),
  // Creative-language footprint — DETERMINISTIC, from each ad's caption/title text
  // (NEVER the CTA, which Meta localizes to the viewer). A "localization depth" read:
  // how many languages they write copy in. NOT a country claim (language ≠ country).
  // `minor` flags incidental languages (1 ad or <5% of detected). Null until re-synthesized.
  creativeLanguages: text("creative_languages", { mode: "json" }).$type<{
    languageCount: number;
    detectedFrom: number;
    undetected: number;
    languages: Array<{
      code: string;
      label: string;
      flag: string;
      count: number;
      share: number;
      minor: boolean;
    }>;
  }>(),
  // Media mix — counts of image / video / carousel ads. Signals production investment
  // (video-heavy = committed) and drives the recommender's format-gap dimension.
  mediaMix: text("media_mix", { mode: "json" }).$type<{
    image: number;
    video: number;
    carousel: number;
    total: number;
  }>(),
  // Most-repeated pain points across analyzed ads: [{ value, count }], desc. What they hammer.
  topPainPoints: text("top_pain_points", { mode: "json" }).$type<
    Array<{ value: string; count: number }>
  >(),
  // Most-repeated benefits across analyzed ads: [{ value, count }], desc.
  topBenefits: text("top_benefits", { mode: "json" }).$type<
    Array<{ value: string; count: number }>
  >(),
  // Launch velocity — new LIVE creatives that STARTED running in the last 14 / 30
  // days (isActive && daysActive <= N). Uses Meta's start_date (via daysActive),
  // NOT our scrape timing, so it isn't inflated on a brand's first scrape.
  launchVelocity: text("launch_velocity", { mode: "json" }).$type<{
    last14: number;
    last30: number;
  }>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── 6. recommendations ─────────────────────────────────────────────
// Cross-competitor GTM recommendations. Deduped by stable_hash on re-runs.
export const recommendations = sqliteTable("recommendations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  priority: text("priority", { enum: ["high", "medium", "low"] }).notNull(),
  rationale: text("rationale").notNull(),
  // Ad IDs cited as evidence (JSON array of strings)
  evidenceAdIds: text("evidence_ad_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  // SHA-1(title + sorted(evidence_ad_ids)) — used for dedup across re-runs
  stableHash: text("stable_hash").notNull().unique(),
  // User toggles this to mark a recommendation as "done"
  actionedAt: text("actioned_at"),
  // Set when a re-run doesn't produce this recommendation anymore
  archivedAt: text("archived_at"),
  // Bumped on each re-run that reproduces this recommendation
  lastGeneratedAt: text("last_generated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─── 7. scrape_runs ─────────────────────────────────────────────────
// Audit log — one row per scrape invocation. The UI reads this for "Last scrape: 2h ago — 3 new".
export const scrapeRuns = sqliteTable("scrape_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id),
  status: text("status", {
    enum: ["success", "partial", "failed"],
  }).notNull(),
  country: text("country"),
  adsFound: integer("ads_found").default(0),
  adsNew: integer("ads_new").default(0),
  adsUnchanged: integer("ads_unchanged").default(0),
  adsWentInactive: integer("ads_went_inactive").default(0),
  errorMessage: text("error_message"),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
});

// ─── Type exports (inferred from Drizzle schema) ────────────────────
export type Competitor = typeof competitors.$inferSelect;
export type NewCompetitor = typeof competitors.$inferInsert;
export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
export type AdAnalysis = typeof adAnalyses.$inferSelect;
export type NewAdAnalysis = typeof adAnalyses.$inferInsert;
export type PerformanceScore = typeof performanceScores.$inferSelect;
export type NewPerformanceScore = typeof performanceScores.$inferInsert;
export type CompetitorSynthesis = typeof competitorSyntheses.$inferSelect;
export type NewCompetitorSynthesis = typeof competitorSyntheses.$inferInsert;
export type Recommendation = typeof recommendations.$inferSelect;
export type NewRecommendation = typeof recommendations.$inferInsert;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type NewScrapeRun = typeof scrapeRuns.$inferInsert;

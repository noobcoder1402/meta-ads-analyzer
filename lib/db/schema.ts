import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
  // UNUSED legacy column (kept for append-only migrations; always 1). Nothing reads it.
  // The real "N ads use this creative" number lives in `collationCount` below.
  variantCount: integer("variant_count").notNull().default(1),
  // Meta's collation count — "N ads use this creative and text" in the Ad Library:
  // the number of separate ad instances sharing this exact creative (cross-ad
  // scaling signal). MARKET-SCOPED — a single-country scrape sees only that market's
  // count; country=ALL gives the global total. Null when Meta doesn't populate it.
  // Cross-competitor-confounded (reflects campaign-build style); use within-competitor + display only.
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

// ─── 3. scrape_runs ─────────────────────────────────────────────────
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

// ─── 4. ai_insight_reports ──────────────────────────────────────────
// Cached output of the strategic-insights AI task (the ONLY AI pass that interprets
// the analysis). One row per generation; the UI reads the latest. We cache because,
// unlike the deterministic analysis, this costs money — it must NOT recompute on every
// page load. `dataFingerprint` captures the underlying numbers so the UI can show a
// "numbers changed since this was written — regenerate?" nudge without auto-charging.
export const aiInsightReports = sqliteTable("ai_insight_reports", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // The validated StrategicInsights object, JSON-stringified.
  reportJson: text("report_json").notNull(),
  // Hash of the brands + ad counts + latest scrape times the report was built from.
  dataFingerprint: text("data_fingerprint").notNull(),
  model: text("model").notNull(),
  brandCount: integer("brand_count").notNull(),
  adCount: integer("ad_count").notNull(),
  generatedAt: text("generated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Type exports (inferred from Drizzle schema) ────────────────────
export type Competitor = typeof competitors.$inferSelect;
export type NewCompetitor = typeof competitors.$inferInsert;
export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type NewScrapeRun = typeof scrapeRuns.$inferInsert;
export type AiInsightReport = typeof aiInsightReports.$inferSelect;
export type NewAiInsightReport = typeof aiInsightReports.$inferInsert;

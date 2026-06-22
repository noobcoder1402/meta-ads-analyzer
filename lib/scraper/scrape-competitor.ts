/**
 * Core scraper: pull a competitor's ads from Meta's Ad Library and upsert to DB.
 *
 * Extracted from `scripts/scrape.ts` so both the CLI and the dashboard's
 * "Scrape ads" API route can call the same code path. The CLI passes a stdout-
 * writing `onEvent`; the API route forwards events as Server-Sent Events.
 *
 * Extraction approach (unchanged from CLI v1):
 *   Meta's Ad Library doesn't render "Library ID:" anymore. We listen for every
 *   GraphQL/AJAX response, parse `ad_archive_id` blocks, and walk the initial
 *   HTML for the first server-rendered batch. Scroll-and-wait pumps more batches.
 *
 * The function never throws — failures are reported via the `error` event and
 * captured in the returned ScrapeResult / scrape_runs row.
 */

import { chromium, type Page, type Response, type BrowserContext } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getCompetitorById,
  getSelfCompetitor,
  startScrapeRun,
  finishScrapeRun,
  upsertScrapedAd,
  getLibraryIdsForCompetitor,
} from "../db/queries";
import { pageNameMatches } from "./page-name-matches";
import { computeDaysActive } from "./days-active";
import { ALL_COUNTRIES } from "../markets";

// ─── Public types ────────────────────────────────────────────────────

/**
 * Which slice of a page's library to fetch. Maps to Meta's `active_status` URL param.
 * `all` (default) returns both live and paused ads with a real `is_active` flag — the
 * authoritative mode. `active` / `inactive` are server-side filters used for a two-pass
 * scrape (all live ads uncapped + a bounded sample of paused ones) so a `--max-ads` cap
 * can't bias a brand's live/paused split. `is_active` still comes from Meta per-ad.
 */
export type ActiveStatus = "all" | "active" | "inactive";

/**
 * The three user-facing scrape modes (the "Scrape ads" dialog buttons). Each maps
 * to a sequence of one or two single-pass scrapes (see `passesForMode`):
 *   - "active"             → every LIVE ad, uncapped. One pass.
 *   - "active_plus_sample" → a bounded SAMPLE of paused ads + every live ad. Two passes.
 *   - "active_plus_all"    → every ad, live and paused, uncapped. One pass (Meta's `all` view).
 *
 * Two-pass modes ALWAYS run the active pass LAST so the live ads are the freshest
 * scrape_run (the snapshot-model freshness check in lib/analysis/metrics.ts treats an
 * ad as live only if it was present in the latest run — see the two-pass gotcha in CLAUDE.md).
 */
export type ScrapeMode = "active" | "active_plus_sample" | "active_plus_all";

/** Sentinel "no cap" value — pulls every ad Meta exposes for a view. */
export const UNCAPPED = 100_000;

/** Default size of the paused-ad sample in "active_plus_sample" mode. */
export const DEFAULT_PAUSED_SAMPLE = 200;

export type ScrapeOptions = {
  competitorId: string;
  /**
   * Which market to scrape. "ALL" (the UI default) is Meta's global view — widest
   * volume + the authoritative live/paused status. A specific ISO code (e.g. "US")
   * scrapes just that country's library. Default: competitor.country || self.country
   * || env || 'US'.
   */
  country?: string;
  /** Cap the number of saved ads. Default: 50 (or SCRAPE_MAX_ADS_PER_RUN env). */
  maxAds?: number;
  /** Which live/paused slice to fetch (Meta `active_status`). Default: "all". */
  activeStatus?: ActiveStatus;
  /** Run with a visible browser. Debug-only. */
  headed?: boolean;
  /** Stream progress events. Optional. */
  onEvent?: (event: ScrapeEvent) => void;
};

export type ScrapeEvent =
  | { type: "log"; message: string }
  | { type: "navigate"; url: string; country: string; maxAds: number; activeStatus: ActiveStatus }
  | { type: "progress"; matchingAds: number; totalObserved: number }
  | { type: "saved-ad"; libraryId: string; mediaType: string; captionPreview: string; isNew: boolean }
  | { type: "done"; result: ScrapeResult }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

export type ScrapeResult = {
  status: "success" | "partial" | "failed";
  totalObserved: number;
  matchedBrand: number;
  saved: number;
  adsNew: number;
  adsUnchanged: number;
  adsWentInactive: number;
  errorMessage: string | null;
  runId: string;
};

// ─── Main entry point ────────────────────────────────────────────────

export async function scrapeCompetitor(opts: ScrapeOptions): Promise<ScrapeResult> {
  const emit = (e: ScrapeEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // never let a bad listener break the scrape
    }
  };

  const competitor = await getCompetitorById(opts.competitorId);
  if (!competitor) {
    const err = `Competitor ${opts.competitorId} not found.`;
    emit({ type: "error", message: err });
    throw new Error(err);
  }

  // Resolve the single market to scrape: arg country → competitor → self → env → US.
  // "ALL" is Meta's global view (the UI default); a specific ISO code scopes to one
  // country's library.
  let country = opts.country ?? competitor.country ?? null;
  if (!country) {
    const self = await getSelfCompetitor();
    country = self?.country ?? null;
  }
  if (!country) country = process.env.SCRAPE_COUNTRY ?? "US";
  const markets = [country.toUpperCase()];

  const envMax = Number(process.env.SCRAPE_MAX_ADS_PER_RUN);
  const maxAds = opts.maxAds ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : 50);
  const activeStatus: ActiveStatus = opts.activeStatus ?? "all";

  if (!competitor.metaPageId && !competitor.metaPageUrl) {
    const message =
      "Competitor has neither meta_page_id nor meta_page_url. Set a Meta page on the competitor card first.";
    emit({ type: "error", message });
    throw new Error(message);
  }

  emit({
    type: "log",
    message: `→ Scraping ${competitor.name} (${competitor.status}) — market ${markets[0]}`,
  });

  const runId = await startScrapeRun({
    competitorId: competitor.id,
    country: markets.join(","),
  });

  const existingRows = await getLibraryIdsForCompetitor(competitor.id);
  const existingActiveIds = new Set(
    existingRows.filter((r) => r.isActive).map((r) => r.libraryId)
  );

  // Union across markets: one entry per ad, plus the set of markets it appeared in.
  const byLibraryId = new Map<string, NormalizedAd>();
  const countriesByLibraryId = new Map<string, Set<string>>();
  let totalObserved = 0;
  let anyMarketFailed = false;
  let lastErrorMessage: string | null = null;
  let anyUnderCaptured = false;
  let lastCaptureWarning: string | null = null;

  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  try {
    for (const market of markets) {
      let url: string;
      try {
        url = buildAdLibraryUrl({
          metaPageId: competitor.metaPageId,
          metaPageUrl: competitor.metaPageUrl,
          country: market,
          activeStatus,
        });
      } catch (err) {
        anyMarketFailed = true;
        lastErrorMessage = (err as Error).message;
        emit({ type: "error", message: lastErrorMessage });
        continue;
      }

      emit({ type: "navigate", url, country: market, maxAds, activeStatus });

      const marketResult = await collectMarketAds({
        context,
        url,
        competitorName: competitor.name,
        competitorId: competitor.id,
        maxAds,
        emit,
      });

      totalObserved += marketResult.observed;
      if (marketResult.failed) {
        anyMarketFailed = true;
        lastErrorMessage = marketResult.errorMessage;
      }
      if (marketResult.underCaptured) {
        anyUnderCaptured = true;
        lastCaptureWarning = `Likely incomplete: captured ${marketResult.captured} of ~${marketResult.reportedTotal} ads Meta reports for ${market}.`;
      }

      for (const ad of marketResult.ads) {
        if (!byLibraryId.has(ad.libraryId)) byLibraryId.set(ad.libraryId, ad);
        // The "ALL" view is Meta's GLOBAL library: it returns volume but tells us
        // nothing about WHICH country each ad runs in. Recording "ALL" as if it
        // were a country is meaningless, so we record NO country for ALL-mode ads.
        // A specific-country scrape records just that one country.
        if (market === ALL_COUNTRIES) continue;
        let seen = countriesByLibraryId.get(ad.libraryId);
        if (!seen) {
          seen = new Set<string>();
          countriesByLibraryId.set(ad.libraryId, seen);
        }
        seen.add(market);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  // A run is "success" only if every attempted market completed. If any market
  // failed we stay "partial" and SKIP marking ads inactive — a failed market must
  // never be misread as "the brand stopped running these ads."
  // A run is "success" only if every market completed AND the capture check passed.
  // A suspected under-capture (we got far fewer ads than Meta reports) is recorded as
  // "partial" with the reason, so a truncated library is never silently shipped as a
  // clean success.
  const status: "success" | "partial" | "failed" =
    byLibraryId.size === 0 && anyMarketFailed
      ? "failed"
      : anyMarketFailed || anyUnderCaptured
      ? "partial"
      : "success";
  const errorMessage = anyMarketFailed ? lastErrorMessage : anyUnderCaptured ? lastCaptureWarning : null;

  // Persist the union. Each ad carries the set of markets it appeared in.
  const union = [...byLibraryId.values()];
  let adsNew = 0;
  const seenLibraryIds: string[] = [];

  for (const ad of union) {
    seenLibraryIds.push(ad.libraryId);
    const countries = [...(countriesByLibraryId.get(ad.libraryId) ?? [])];
    const { isNew } = await upsertScrapedAd({
      competitorId: competitor.id,
      libraryId: ad.libraryId,
      caption: ad.caption,
      ctaLabel: ad.ctaLabel,
      landingUrl: ad.landingUrl,
      mediaPaths: [],
      mediaUrls: ad.mediaUrls,
      mediaType: ad.mediaType,
      isActive: ad.isActive,
      daysActive: ad.daysActive,
      placements: ad.placements,
      countries,
      title: ad.title,
      displayFormat: ad.displayFormat,
      collationCount: ad.collationCount,
      collationId: ad.collationId,
      containsAiMedia: ad.containsAiMedia,
      startDate: ad.startDate,
      endDate: ad.endDate,
      videoUrls: ad.videoUrls,
      linkDescription: ad.linkDescription,
      displayLink: ad.displayLink,
      pageLikeCount: ad.pageLikeCount,
      pageCategories: ad.pageCategories,
      pageProfileUri: ad.pageProfileUri,
      pageProfilePictureUrl: ad.pageProfilePictureUrl,
      adCategories: ad.adCategories,
      extraTexts: ad.extraTexts,
      extraImageUrls: ad.extraImageUrls,
      extraVideoUrls: ad.extraVideoUrls,
      containsSensitiveContent: ad.containsSensitiveContent,
      isReshared: ad.isReshared,
      brandedContent: ad.brandedContent,
      pageIsDeleted: ad.pageIsDeleted,
    });

    if (isNew) adsNew += 1;
    emit({
      type: "saved-ad",
      libraryId: ad.libraryId,
      mediaType: ad.mediaType ?? "?",
      captionPreview: ad.caption?.slice(0, 80) ?? "",
      isNew,
    });
  }

  // SNAPSHOT MODEL (2026-06-21): we no longer INFER "paused" from an ad's absence.
  // We scrape with active_status=all, so Meta returns each page's active AND inactive
  // ads with a real is_active flag — that's the trustworthy signal (~93% of our paused
  // ads came straight from Meta; only ~7% were ever absence-inferred). Inferring paused
  // from "didn't see it this run" was also the source of the --max-ads cap bug (a shallow
  // scrape wrongly flipped still-live ads to paused, freezing their longevity). So an ad
  // not found in a later scrape is now LEFT AS-IS (last-known status + dates frozen); the
  // analysis layer treats "live" as "present in the latest scrape" / "last seen N ago".
  // adsWentInactive stays 0 (the field + UI are kept; they just no longer fire).
  const adsWentInactive = 0;

  const adsUnchanged = seenLibraryIds.filter((id) => existingActiveIds.has(id)).length;

  await finishScrapeRun({
    id: runId,
    status,
    adsFound: union.length,
    adsNew,
    adsUnchanged,
    adsWentInactive,
    errorMessage,
  });

  const result: ScrapeResult = {
    status,
    totalObserved,
    matchedBrand: union.length,
    saved: union.length,
    adsNew,
    adsUnchanged,
    adsWentInactive,
    errorMessage,
    runId,
  };
  emit({ type: "done", result });
  return result;
}

// ─── Mode orchestrator (UI-facing) ───────────────────────────────────

export type ScrapeModeOptions = {
  competitorId: string;
  mode: ScrapeMode;
  country?: string;
  /** Override the paused sample size (active_plus_sample only). Default 200. */
  pausedSample?: number;
  headed?: boolean;
  onEvent?: (event: ScrapeEvent) => void;
};

type Pass = { activeStatus: ActiveStatus; maxAds: number; label: string };

function passesForMode(mode: ScrapeMode, pausedSample: number): Pass[] {
  switch (mode) {
    case "active":
      return [{ activeStatus: "active", maxAds: UNCAPPED, label: "all active ads" }];
    case "active_plus_sample":
      // Paused sample FIRST, active LAST — the active pass must be the freshest
      // scrape_run or every live ad reads as "not live" (the two-pass gotcha).
      return [
        {
          activeStatus: "inactive",
          maxAds: pausedSample,
          label: `sample of paused ads (up to ${pausedSample})`,
        },
        { activeStatus: "active", maxAds: UNCAPPED, label: "all active ads" },
      ];
    case "active_plus_all":
      return [{ activeStatus: "all", maxAds: UNCAPPED, label: "all active + paused ads" }];
  }
}

/**
 * Run a user-facing scrape MODE: one or two single-pass scrapes in the correct order.
 * Each pass is a full `scrapeCompetitor` call (its own scrape_runs row). We forward all
 * progress events but SWALLOW the inner per-pass `done` events, aggregate their results,
 * and emit ONE combined `done` at the end so the UI shows a single summary.
 *
 * The per-pass capture check (Meta's "~N results" vs. what we captured) still runs inside
 * each `scrapeCompetitor`, so the uncapped active pass is always verified against Meta's
 * own count; the deliberately-capped paused sample is exempt (it stops on `maxAds`, not a stall).
 */
export async function scrapeCompetitorByMode(opts: ScrapeModeOptions): Promise<ScrapeResult> {
  const passes = passesForMode(opts.mode, opts.pausedSample ?? DEFAULT_PAUSED_SAMPLE);
  const emit = (e: ScrapeEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // never let a bad listener break the scrape
    }
  };

  const results: ScrapeResult[] = [];
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    if (passes.length > 1) {
      emit({ type: "log", message: `Pass ${i + 1} of ${passes.length}: ${pass.label}…` });
    }
    const result = await scrapeCompetitor({
      competitorId: opts.competitorId,
      country: opts.country,
      maxAds: pass.maxAds,
      activeStatus: pass.activeStatus,
      headed: opts.headed,
      // Forward every event EXCEPT the per-pass `done` — combined one emitted below.
      onEvent: (e) => {
        if (e.type === "done") return;
        emit(e);
      },
    });
    results.push(result);
  }

  // Aggregate. The LAST pass is the active pass (or the only pass) → its runId is what
  // the snapshot model treats as latest, so we surface it. status = worst of all passes;
  // counts are summed (passes scrape disjoint live/paused slices, so no double-count).
  const rank = { success: 0, partial: 1, failed: 2 } as const;
  const worst = results.reduce<ScrapeResult["status"]>(
    (acc, r) => (rank[r.status] > rank[acc] ? r.status : acc),
    "success"
  );
  const firstError = results.find((r) => r.errorMessage)?.errorMessage ?? null;
  const combined: ScrapeResult = {
    status: worst,
    totalObserved: results.reduce((n, r) => n + r.totalObserved, 0),
    matchedBrand: results.reduce((n, r) => n + r.matchedBrand, 0),
    saved: results.reduce((n, r) => n + r.saved, 0),
    adsNew: results.reduce((n, r) => n + r.adsNew, 0),
    adsUnchanged: results.reduce((n, r) => n + r.adsUnchanged, 0),
    adsWentInactive: 0,
    errorMessage: firstError,
    runId: results[results.length - 1]?.runId ?? "",
  };
  emit({ type: "done", result: combined });
  return combined;
}

// ─── URL builder ──────────────────────────────────────────────────────

function buildAdLibraryUrl(input: {
  metaPageId: string | null;
  metaPageUrl: string | null;
  country: string;
  activeStatus?: ActiveStatus;
}): string {
  const { metaPageId, metaPageUrl, country, activeStatus = "all" } = input;
  const countryParam = country === "ALL" ? "ALL" : country;

  if (metaPageId) {
    const params = new URLSearchParams({
      active_status: activeStatus,
      ad_type: "all",
      country: countryParam,
      search_type: "page",
      view_all_page_id: metaPageId,
    });
    return `https://www.facebook.com/ads/library/?${params.toString()}`;
  }

  if (metaPageUrl) {
    const u = new URL(metaPageUrl);
    u.searchParams.set("country", countryParam);
    u.searchParams.set("active_status", activeStatus);
    return u.toString();
  }

  throw new Error(
    "Competitor has neither meta_page_id nor meta_page_url. Set a Meta page on the competitor card first."
  );
}

// ─── Per-market collection ────────────────────────────────────────────

/**
 * Scrape one country's Ad Library for one competitor. Opens a fresh page (so the
 * GraphQL response listener is scoped to this market), scrolls until stable, then
 * returns the brand-matched, capped ads observed in THIS market. Never throws —
 * a market failure is reported via `failed` so the loop can continue to the next.
 */
async function collectMarketAds(args: {
  context: BrowserContext;
  url: string;
  competitorName: string;
  competitorId: string;
  maxAds: number;
  emit: (e: ScrapeEvent) => void;
}): Promise<{
  ads: NormalizedAd[];
  observed: number;
  failed: boolean;
  errorMessage: string | null;
  /** Meta's own reported result count for this view (null if unreadable). */
  reportedTotal: number | null;
  /** Brand-matched ads we actually captured this market. */
  captured: number;
  /** True when capture fell well short of Meta's reported total after a stall. */
  underCaptured: boolean;
}> {
  const { context, url, competitorName, competitorId, maxAds, emit } = args;
  const collected = new Map<string, MetaAdRecord>();
  const page = await context.newPage();

  page.on("response", async (response: Response) => {
    try {
      const reqUrl = response.url();
      if (!/facebook\.com\/(api\/graphql|ads\/library)/.test(reqUrl)) return;
      // Meta serves PAGINATED ad batches from /api/graphql with content-type
      // `text/html`, not json — filtering those out caps every scrape at the
      // ~30 ads in the initial HTML. Gate on URL (above), not content-type.
      const contentType = response.headers()["content-type"] ?? "";
      if (!/application\/(x-)?(ndjson|json)|text\/(javascript|html)/i.test(contentType)) return;
      const body = await response.text().catch(() => "");
      if (!body || !body.includes("ad_archive_id")) return;
      for (const root of parsePossiblyNdjson(body)) {
        for (const rec of findAdRecords(root)) {
          if (!collected.has(rec.ad_archive_id)) collected.set(rec.ad_archive_id, rec);
        }
      }
    } catch {
      // never throw from response listener
    }
  });

  let failed = false;
  let errorMessage: string | null = null;
  let reportedTotal: number | null = null;
  let captured = 0;
  let underCaptured = false;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    try {
      const html = await page.content();
      for (const rec of extractFromInitialHtml(html)) {
        if (!collected.has(rec.ad_archive_id)) collected.set(rec.ad_archive_id, rec);
      }
    } catch {
      // non-fatal
    }

    try {
      const close = page.locator('div[role="dialog"] [aria-label="Close"]').first();
      if (await close.count().then((c) => c > 0)) {
        await close.click({ timeout: 3000 });
      }
    } catch {
      // non-fatal
    }

    const countMatching = () => {
      let n = 0;
      for (const rec of collected.values()) {
        const name = rec.snapshot?.page_name ?? rec.page_name ?? "";
        if (pageNameMatches(competitorName, name)) n += 1;
      }
      return n;
    };

    const scroll = await scrollUntilStable(page, countMatching, maxAds, (matchingAds) => {
      emit({ type: "progress", matchingAds, totalObserved: collected.size });
    });

    // ── Post-scrape capture check (added 2026-06-22) ──
    // Compare what we captured against the count Meta itself reports for this view.
    // If we're well short AND we stopped on a stall (not because we hit the cap), the
    // lazy-load almost certainly bailed early — flag it loudly instead of silently
    // shipping a truncated library (the Monday.com 39-of-~750 bug).
    captured = countMatching();
    reportedTotal = await readReportedTotal(page);
    if (
      reportedTotal != null &&
      scroll.reason === "stall" &&
      captured < Math.floor(reportedTotal * CAPTURE_MIN_RATIO)
    ) {
      underCaptured = true;
      emit({
        type: "warning",
        message: `Capture check FAILED: got ${captured} ads but Meta reports ~${reportedTotal} for this view — the scroll stalled early, so this library is likely incomplete.`,
      });
    } else if (reportedTotal != null) {
      emit({ type: "log", message: `Capture check: ${captured} of ~${reportedTotal} Meta-reported ads (ok).` });
    }
  } catch (err) {
    failed = true;
    errorMessage = (err as Error).message;
    emit({ type: "error", message: errorMessage });
    await dumpDebug(page, competitorId, "fail");
  } finally {
    await page.close().catch(() => {});
  }

  const matching: NormalizedAd[] = [];
  for (const rec of collected.values()) {
    const norm = normalizeAd(rec);
    if (pageNameMatches(competitorName, norm.pageName)) matching.push(norm);
  }

  return {
    ads: matching.slice(0, maxAds),
    observed: collected.size,
    failed,
    errorMessage,
    reportedTotal,
    captured,
    underCaptured,
  };
}

// ─── JSON ad extraction ───────────────────────────────────────────────

type MetaSnapshotImage = {
  original_image_url?: string;
  resized_image_url?: string;
};
type MetaSnapshotVideo = {
  video_preview_image_url?: string;
  video_hd_url?: string;
  video_sd_url?: string;
};
type MetaSnapshotCard = {
  body?: string;
  title?: string;
  link_url?: string;
  original_image_url?: string;
  resized_image_url?: string;
  video_preview_image_url?: string;
  video_hd_url?: string;
  video_sd_url?: string;
};
type MetaAdRecord = {
  ad_archive_id: string;
  is_active: boolean;
  page_id?: string;
  page_name?: string;
  start_date?: number;
  end_date?: number | null;
  /**
   * Meta's grouping count — "N ads use this creative and text" in the Ad Library UI.
   * Sibling of ad_archive_id inside `collated_results[]`. The size of the group of
   * near-identical ad instances; a strong "advertiser is scaling this" signal.
   * Often `null` (Meta doesn't always populate it) or `1` (singleton). EXPERIMENTAL:
   * we capture it into the `variant_count` column to measure how usable it is.
   */
  collation_count?: number | null;
  /** Meta's group ID behind collation_count. */
  collation_id?: string | null;
  /** Meta flag: the creative contains AI/digitally-generated media. */
  contains_digital_created_media?: boolean | null;
  /**
   * Platforms the ad runs on, e.g. ["FACEBOOK","INSTAGRAM","MESSENGER","THREADS"].
   * Top-level sibling of end_date in Meta's JSON. Feeds the placement-spread
   * scoring signal (5 pts each, capped at 20 / 4 platforms). Present on virtually every ad.
   */
  publisher_platform?: string[];
  /** Top-level ad category: ["UNKNOWN"] for commercial, else political/housing/etc. */
  categories?: string[];
  /** Meta flag: creative flagged as sensitive content. */
  contains_sensitive_content?: boolean | null;
  /** Whether Meta has deleted the advertiser's page. */
  page_is_deleted?: boolean | null;
  snapshot?: {
    page_name?: string;
    caption?: string;
    body?: { text?: string };
    title?: string;
    cta_text?: string;
    cta_type?: string;
    link_url?: string;
    /** The ad's link description line, shown under the headline — real copy. */
    link_description?: string;
    display_format?: string;
    images?: MetaSnapshotImage[];
    videos?: MetaSnapshotVideo[];
    cards?: MetaSnapshotCard[];
    /** DCO variant content: alternate copy + creatives A/B-tested within one ad. */
    extra_texts?: ({ text?: string } | string)[];
    extra_images?: MetaSnapshotImage[];
    extra_videos?: MetaSnapshotVideo[];
    /** Advertiser page signals. */
    page_like_count?: number | null;
    page_categories?: string[];
    page_profile_uri?: string;
    page_profile_picture_url?: string;
    is_reshared?: boolean | null;
    /** Branded-content / paid-partnership payload (object or null). */
    branded_content?: unknown;
  };
};

function* findAdRecords(value: unknown): Generator<MetaAdRecord> {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) yield* findAdRecords(item);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.ad_archive_id === "string" &&
    obj.snapshot &&
    typeof obj.snapshot === "object"
  ) {
    yield obj as MetaAdRecord;
  }
  for (const v of Object.values(obj)) {
    yield* findAdRecords(v);
  }
}

function parsePossiblyNdjson(body: string): unknown[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.includes("\n")) {
    const out: unknown[] = [];
    for (const line of trimmed.split("\n")) {
      const ln = line.trim();
      if (!ln) continue;
      try {
        out.push(JSON.parse(ln));
      } catch {
        // skip
      }
    }
    if (out.length > 0) return out;
  }
  try {
    return [JSON.parse(trimmed)];
  } catch {
    return [];
  }
}

export function extractFromInitialHtml(html: string): MetaAdRecord[] {
  const found: MetaAdRecord[] = [];
  const idRegex = /"ad_archive_id":"(\d+)"/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = idRegex.exec(html)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const objStart = findEnclosingObjectStart(html, m.index);
    const objEnd = findEnclosingObjectEnd(html, m.index);
    if (objStart < 0 || objEnd < 0) continue;
    const slice = html.slice(objStart, objEnd + 1);
    try {
      const parsed = JSON.parse(slice) as MetaAdRecord;
      if (parsed.ad_archive_id) found.push(parsed);
    } catch {
      // skip slices that don't parse
    }
  }
  return found;
}

function findEnclosingObjectStart(html: string, from: number): number {
  let depth = 0;
  for (let i = from; i >= 0; i--) {
    const c = html[i];
    if (c === "}") depth += 1;
    else if (c === "{") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function findEnclosingObjectEnd(html: string, from: number): number {
  const start = findEnclosingObjectStart(html, from);
  if (start < 0) return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ─── Map MetaAdRecord → our domain shape ─────────────────────────────

type NormalizedAd = {
  libraryId: string;
  caption: string | null;
  ctaLabel: string | null;
  landingUrl: string | null;
  mediaUrls: string[];
  mediaType: "image" | "video" | "carousel" | null;
  isActive: boolean;
  daysActive: number;
  placements: string[];
  pageName: string;
  /** Ad headline (snapshot.title), distinct from the body caption. */
  title: string | null;
  /** Meta's ad-structure label: "IMAGE" | "VIDEO" | "CAROUSEL" | "DCO". */
  displayFormat: string | null;
  /** "N ads use this creative" — group size. null when Meta doesn't populate it. */
  collationCount: number | null;
  /** Meta's group ID behind collationCount. */
  collationId: string | null;
  /** Meta's AI/digitally-created-media flag. */
  containsAiMedia: boolean | null;
  // ─── Extended capture (2026-06-20) ───────────────────────────────────
  /** Launch / stop timestamps (ISO 8601), from Meta's unix seconds. */
  startDate: string | null;
  endDate: string | null;
  /** Real video file URLs (hd preferred, sd fallback). Expire within days. */
  videoUrls: string[];
  /** Link description line (snapshot.link_description). */
  linkDescription: string | null;
  /** Display link/domain (snapshot.caption). */
  displayLink: string | null;
  pageLikeCount: number | null;
  pageCategories: string[];
  pageProfileUri: string | null;
  pageProfilePictureUrl: string | null;
  /** Top-level ad category list. */
  adCategories: string[];
  /** DCO variant copy + creative URLs. */
  extraTexts: string[];
  extraImageUrls: string[];
  extraVideoUrls: string[];
  containsSensitiveContent: boolean | null;
  isReshared: boolean | null;
  brandedContent: unknown;
  pageIsDeleted: boolean | null;
};

export function normalizeAd(rec: MetaAdRecord): NormalizedAd {
  const snap = rec.snapshot ?? {};
  const cards = snap.cards ?? [];

  const candidates = [
    snap.body?.text,
    snap.title,
    cards[0]?.body,
    cards[0]?.title,
  ];
  let caption: string | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    if (isTemplatePlaceholder(trimmed)) continue;
    caption = trimmed;
    break;
  }

  const ctaLabel = prettifyCtaType(snap.cta_type) || snap.cta_text?.trim() || null;
  const landingUrl = snap.link_url ?? cards[0]?.link_url ?? null;

  const display = (snap.display_format || "").toUpperCase();
  let mediaUrls: string[] = [];
  let mediaType: "image" | "video" | "carousel" | null = null;

  // Meta's modern delivery model: most "ads" are actually DCO bundles where
  // multiple variant creatives share one ad_archive_id. Each variant lives in
  // a `card`, which is either an IMAGE card (original_image_url set, video
  // fields null) or a VIDEO card (video_hd_url set, image fields null). The
  // top-level `videos[]` and `images[]` arrays are only used for legacy
  // single-format ads; modern ads put everything in cards.
  //
  // mediaType is the MEDIA KIND (how to render/analyze). We reserve "carousel"
  // for ads Meta actually marks display_format=CAROUSEL — a DCO ad's multiple
  // cards are A/B-tested VERSIONS, not carousel slides, so it takes its underlying
  // image/video kind. (The structure itself is stored separately in displayFormat.)
  //   - top-level videos[] OR display_format=VIDEO → video
  //   - all cards video → video
  //   - all cards image: CAROUSEL → carousel, else → image (single or DCO versions)
  //   - mixed cards: CAROUSEL → carousel, else (DCO mixed bundle) → video
  //   - top-level images[] only → image
  const isTrueCarousel = display === "CAROUSEL";
  const hasTopLevelVideo =
    display === "VIDEO" || (snap.videos && snap.videos.length > 0);

  if (hasTopLevelVideo) {
    mediaType = "video";
    mediaUrls = (snap.videos ?? [])
      .map((v) => v.video_preview_image_url)
      .filter((u): u is string => Boolean(u));
  } else if (cards.length > 0) {
    const videoCards = cards.filter(isVideoCard);
    const imageCards = cards.filter((c) => !isVideoCard(c));

    if (videoCards.length > 0 && imageCards.length === 0) {
      // All cards are videos — single video ad (possibly with variants).
      mediaType = "video";
      mediaUrls = videoCards
        .map((c) => c.video_preview_image_url ?? "")
        .filter(Boolean);
    } else if (imageCards.length > 0 && videoCards.length === 0) {
      // All cards are images: a true carousel only if Meta says so; otherwise a
      // single image or a DCO bundle of image versions — both are kind "image".
      mediaType = isTrueCarousel ? "carousel" : "image";
      mediaUrls = imageCards
        .map((c) => c.original_image_url ?? c.resized_image_url ?? "")
        .filter(Boolean);
    } else {
      // Mixed video + image cards: a true mixed carousel, else a DCO bundle —
      // a video is present, so the heavier media kind is "video".
      mediaType = isTrueCarousel ? "carousel" : "video";
      mediaUrls = cards
        .map((c) =>
          isVideoCard(c)
            ? c.video_preview_image_url ?? ""
            : c.original_image_url ?? c.resized_image_url ?? ""
        )
        .filter(Boolean);
    }
  } else {
    mediaType = "image";
    mediaUrls = (snap.images ?? [])
      .map((i) => i.original_image_url ?? i.resized_image_url ?? "")
      .filter(Boolean);
  }

  // True run length (counts to end_date for paused ads, not "now"). See days-active.ts.
  const daysActive = computeDaysActive({
    startDate: rec.start_date,
    endDate: rec.end_date,
    isActive: Boolean(rec.is_active),
  });

  // Platforms the ad runs across (Facebook / Instagram / Messenger / Threads…).
  // Meta returns these UPPERCASE; we lowercase for clean display. The scorer only
  // counts how many there are, but a tidy list helps the future synthesizer/UI.
  const placements = Array.isArray(rec.publisher_platform)
    ? rec.publisher_platform
        .filter((p): p is string => typeof p === "string" && p.length > 0)
        .map((p) => p.toLowerCase())
    : [];

  // ─── Extended capture (2026-06-20) ───────────────────────────────────
  // Meta sends unix SECONDS; store ISO 8601 so the UI can show real dates.
  const toIso = (s: number | null | undefined): string | null =>
    typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null;

  // Actual video file URLs (hd preferred, sd fallback) — from top-level videos[]
  // AND video cards. NOTE: Meta signs these and they expire within days.
  const videoUrls: string[] = [];
  for (const v of snap.videos ?? []) {
    const u = v.video_hd_url ?? v.video_sd_url;
    if (u) videoUrls.push(u);
  }
  for (const c of cards) {
    if (isVideoCard(c)) {
      const u = c.video_hd_url ?? c.video_sd_url;
      if (u) videoUrls.push(u);
    }
  }

  // DCO variant content — extra_texts items are either strings or { text }.
  const extraTexts = (snap.extra_texts ?? [])
    .map((t) => (typeof t === "string" ? t : t?.text ?? ""))
    .map((t) => t.trim())
    .filter(Boolean);
  const extraImageUrls = (snap.extra_images ?? [])
    .map((i) => i.original_image_url ?? i.resized_image_url ?? "")
    .filter(Boolean);
  const extraVideoUrls = (snap.extra_videos ?? [])
    .map((v) => v.video_hd_url ?? v.video_sd_url ?? "")
    .filter(Boolean);

  return {
    libraryId: rec.ad_archive_id,
    caption,
    ctaLabel,
    landingUrl,
    mediaUrls,
    mediaType,
    isActive: Boolean(rec.is_active),
    daysActive,
    placements,
    pageName: snap.page_name ?? rec.page_name ?? "",
    title:
      snap.title && !isTemplatePlaceholder(snap.title.trim())
        ? snap.title.trim() || null
        : null,
    displayFormat: display || null,
    collationCount:
      typeof rec.collation_count === "number" ? rec.collation_count : null,
    collationId:
      typeof rec.collation_id === "string" && rec.collation_id
        ? rec.collation_id
        : null,
    containsAiMedia:
      typeof rec.contains_digital_created_media === "boolean"
        ? rec.contains_digital_created_media
        : null,
    startDate: toIso(rec.start_date),
    endDate: toIso(rec.end_date),
    videoUrls,
    linkDescription: snap.link_description?.trim() || null,
    displayLink: snap.caption?.trim() || null,
    pageLikeCount:
      typeof snap.page_like_count === "number" ? snap.page_like_count : null,
    pageCategories: Array.isArray(snap.page_categories)
      ? snap.page_categories.filter(
          (c): c is string => typeof c === "string" && c.length > 0
        )
      : [],
    pageProfileUri: snap.page_profile_uri?.trim() || null,
    pageProfilePictureUrl: snap.page_profile_picture_url?.trim() || null,
    adCategories: Array.isArray(rec.categories)
      ? rec.categories.filter(
          (c): c is string => typeof c === "string" && c.length > 0
        )
      : [],
    extraTexts,
    extraImageUrls,
    extraVideoUrls,
    containsSensitiveContent:
      typeof rec.contains_sensitive_content === "boolean"
        ? rec.contains_sensitive_content
        : null,
    isReshared:
      typeof snap.is_reshared === "boolean" ? snap.is_reshared : null,
    brandedContent: snap.branded_content ?? null,
    pageIsDeleted:
      typeof rec.page_is_deleted === "boolean" ? rec.page_is_deleted : null,
  };
}

/**
 * Is this card a video card?
 *
 * A modern Meta card is either:
 *   - VIDEO: video_hd_url / video_sd_url populated, original_image_url / resized_image_url null
 *   - IMAGE: original_image_url / resized_image_url populated, video_* null
 *
 * We use the presence of an actual video URL (hd or sd) as the truth signal —
 * NOT video_preview_image_url alone, because Meta sometimes ships a preview
 * thumbnail on image cards too (their CDN's call). A real video must have a
 * playable video URL.
 *
 * Edge case: if video URLs are null but image URLs are ALSO null, fall back to
 * video_preview_image_url presence — better to classify as video than to drop
 * the ad entirely.
 */
function isVideoCard(c: MetaSnapshotCard): boolean {
  if (c.video_hd_url || c.video_sd_url) return true;
  const hasImage = Boolean(c.original_image_url || c.resized_image_url);
  if (!hasImage && c.video_preview_image_url) return true;
  return false;
}

function prettifyCtaType(t: string | undefined): string | null {
  if (!t) return null;
  return t
    .toLowerCase()
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function isTemplatePlaceholder(s: string): boolean {
  return /^\{\{.+\}\}$/.test(s);
}

// ─── Polite scroll ───────────────────────────────────────────────────

const SCROLL_PAUSE_MIN_MS = 2000;
const SCROLL_PAUSE_MAX_MS = 4500;
// How many consecutive no-growth polls before we conclude the lazy-load is exhausted.
// Raised 6→12 (2026-06-22): a big/slow library (Monday.com ~750 ads) loads in bursts
// with lulls longer than 6 polls, so 6 bailed after the first ~39 ads. More patience
// trades a little time for not silently truncating large libraries.
const NO_GROWTH_STREAK_LIMIT = 12;
// Hard cap on scroll iterations (was 80). At ~3s/poll this bounds a deep scrape to a
// few minutes; 320 comfortably covers a ~1000-ad library at ~30 ads/batch.
const MAX_SCROLLS = 320;
// Below this fraction of Meta's own reported result count, we flag the run as likely
// under-captured (the post-scrape capture check the user asked for).
const CAPTURE_MIN_RATIO = 0.8;

async function scrollUntilStable(
  page: Page,
  getCount: () => number,
  maxAds: number,
  onProgress: (count: number) => void
): Promise<{ reason: "maxAds" | "stall"; finalCount: number }> {
  // Meta's Ad Library lazy-loads more ads only in response to REAL wheel events —
  // programmatic `window.scrollBy` sets the scroll position but doesn't fire the
  // listener, so it stalls after the first batch (~30 ads). Dispatching mouse-wheel
  // events over the results area is what actually triggers pagination. Park the
  // cursor over the page first so the wheel targets the scrollable content.
  await page.mouse.move(640, 450).catch(() => {});
  let lastCount = 0;
  let noGrowthStreak = 0;
  for (let scrolls = 0; scrolls < MAX_SCROLLS; scrolls++) {
    const count = getCount();
    onProgress(count);
    if (count >= maxAds) return { reason: "maxAds", finalCount: count };
    if (count === lastCount) {
      noGrowthStreak += 1;
      if (noGrowthStreak >= NO_GROWTH_STREAK_LIMIT) return { reason: "stall", finalCount: count };
    } else {
      noGrowthStreak = 0;
      lastCount = count;
    }
    await page.mouse.wheel(0, 6000);
    const pause =
      SCROLL_PAUSE_MIN_MS +
      Math.floor(Math.random() * (SCROLL_PAUSE_MAX_MS - SCROLL_PAUSE_MIN_MS));
    await page.waitForTimeout(pause);
  }
  return { reason: "stall", finalCount: getCount() };
}

/**
 * Best-effort read of the result count Meta prints at the top of the Ad Library
 * ("~750 results"). This is the reference for the post-scrape capture check: if we
 * captured far fewer than Meta says exist, the scroll likely stalled. Localized text
 * is covered for the major markets; on any miss we return null and skip the check
 * (better no check than a false alarm).
 */
async function readReportedTotal(page: Page): Promise<number | null> {
  try {
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    const m = text.match(
      /~?\s*([\d][\d.,]*)\s*(?:results|resultados|résultats|ergebnisse|risultati|resultaten)/i,
    );
    if (!m) return null;
    const n = parseInt(m[1].replace(/[.,\s]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// ─── Error capture ───────────────────────────────────────────────────

async function dumpDebug(page: Page, competitorId: string, label: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(
    process.cwd(),
    "data",
    "scrape-errors",
    `${competitorId}-${ts}-${label}`
  );
  await fs.mkdir(dir, { recursive: true });
  try {
    await page.screenshot({ path: path.join(dir, "page.png"), fullPage: true });
    const html = await page.content();
    await fs.writeFile(path.join(dir, "page.html"), html);
  } catch {
    // best-effort
  }
}

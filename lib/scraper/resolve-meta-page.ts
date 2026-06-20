/**
 * Resolve a brand name → its Meta Ad Library page (page_id, page_name, canonical URL).
 *
 * Why this exists: the AI competitor-suggester emits a "likely Meta URL" by templating
 * the brand name into a keyword-search URL. Claude has no way to verify those URLs.
 * In practice those URLs return ads from random unrelated brands (any ad whose body
 * text happens to mention the brand). We need real, verified page IDs.
 *
 * Strategy (the painful learning): Meta does NOT expose a clean "find page by name"
 * API on the public Ad Library. The `search_type=page` URL param is ignored — Meta
 * still runs a keyword search in ad body text. BUT every ad returned carries its own
 * `page_id` and `page_name`. So our resolver runs a keyword search for the brand name,
 * harvests page_id/page_name pairs from the ads that come back, scores candidates by
 * name similarity (Dice coefficient on normalized tokens), and returns the best match.
 *
 * Limitations:
 *   - A brand only shows up if it's actively running ads whose body text contains the
 *     brand name. Some brands don't say their own name in ad copy.
 *   - For dead brands or brands with no current ads, this returns null.
 *   - When that happens, the user must paste the Meta page URL manually.
 *
 * The same JSON-intercept approach scripts/scrape.ts uses is more reliable than DOM-
 * scraping hashed React class names.
 */

import { chromium, type Response } from "playwright";

export type PageCandidate = {
  pageId: string;
  pageName: string;
  /** Total ads currently in the library for this page (any state). May be 0. */
  adCount: number;
  /** True if Meta marks this page as Verified. */
  verified: boolean;
  /** URL of the page's profile picture (small — useful for the UI confirmation step). */
  profilePictureUrl: string | null;
};

export type ResolveResult = {
  /** The best match, or null if no candidate clears the threshold. */
  best: PageCandidate | null;
  /** All candidates considered, in score-descending order. Useful for picker UIs. */
  candidates: PageCandidate[];
};

/**
 * Resolve a brand name to its Meta Ad Library page.
 * `country` defaults to "US"; this only changes the page-search results' regional filter,
 * not the page itself (a page has one global ID regardless of country).
 */
export async function resolveMetaPage(
  brandName: string,
  country: string = "US"
): Promise<ResolveResult> {
  const url = buildPageSearchUrl(brandName, country);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const observed = new Map<string, PageCandidate>();

  page.on("response", async (response: Response) => {
    try {
      const contentType = response.headers()["content-type"] ?? "";
      if (!/application\/(x-)?(ndjson|json)|text\/javascript/i.test(contentType)) return;
      const reqUrl = response.url();
      if (!/facebook\.com\/(api\/graphql|ads\/library)/.test(reqUrl)) return;
      const body = await response.text().catch(() => "");
      if (!body || !body.includes("page_name")) return;
      for (const root of parsePossiblyNdjson(body)) {
        for (const cand of findPageCandidates(root)) {
          if (!observed.has(cand.pageId)) observed.set(cand.pageId, cand);
        }
      }
    } catch {
      // never throw from response listener
    }
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Always walk the initial server-rendered HTML for embedded candidates.
    try {
      const html = await page.content();
      for (const cand of findPageCandidatesInHtml(html)) {
        if (!observed.has(cand.pageId)) observed.set(cand.pageId, cand);
      }
    } catch {
      // non-fatal
    }

    // If no candidates yet, scroll a few times to let Meta lazy-load more ads
    // (each lazy-loaded batch brings more page_id/page_name pairs).
    if (observed.size < 5) {
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(1500 + Math.random() * 1500);
        if (observed.size >= 10) break;
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const candidates = Array.from(observed.values());
  const scored = candidates
    .map((c) => ({ c, score: scoreCandidate(brandName, c) }))
    .sort((a, b) => b.score - a.score);

  // Threshold: require a meaningful match. Below this we say "no clear match".
  const BEST_THRESHOLD = 0.4;
  const best = scored.length > 0 && scored[0].score >= BEST_THRESHOLD ? scored[0].c : null;

  return { best, candidates: scored.map((s) => s.c) };
}

/**
 * Canonical "browse one page" Ad Library URL — what we want to store as meta_page_url.
 * Uses view_all_page_id (the proper per-brand URL form).
 */
export function buildCanonicalPageUrl(pageId: string, country: string = "US"): string {
  const params = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country: country === "ALL" ? "ALL" : country,
    search_type: "page",
    view_all_page_id: pageId,
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildPageSearchUrl(name: string, country: string): string {
  // We use keyword_unordered (not search_type=page — Meta ignores that param). Every ad
  // returned exposes its page_id + page_name, which is what we actually mine here.
  const params = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country: country === "ALL" ? "ALL" : country,
    search_type: "keyword_unordered",
    q: name,
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
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

/**
 * Walks JSON looking for "page candidate" shapes. Two shapes we accept:
 *   (a) An ad record: { ad_archive_id, page_id, snapshot: { page_name, page_profile_picture_url } }
 *       → extract the page info from inside the snapshot.
 *   (b) A bare page object: { page_id|id, page_name|name } anywhere else in the tree.
 *
 * Dedupe is handled by the caller via the pageId key.
 */
function* findPageCandidates(value: unknown): Generator<PageCandidate> {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) yield* findPageCandidates(item);
    return;
  }
  const obj = value as Record<string, unknown>;

  // (a) Ad record: harvest the page info from the snapshot.
  if (typeof obj.ad_archive_id === "string") {
    const pageId = pickStringField(obj, ["page_id"]);
    const snap = (obj.snapshot && typeof obj.snapshot === "object"
      ? (obj.snapshot as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const pageName =
      pickStringField(snap, ["page_name"]) ?? pickStringField(obj, ["page_name"]);
    if (pageId && pageName && /^\d{6,}$/.test(pageId)) {
      yield {
        pageId,
        pageName,
        adCount: pickNumberField(snap, ["page_like_count"]) ?? 0,
        verified: pickBoolField(snap, ["page_is_verified"]) ?? false,
        profilePictureUrl:
          pickStringField(snap, ["page_profile_picture_url"]) ?? null,
      };
    }
    // Don't recurse into ad snapshot — too noisy.
    return;
  }

  // (b) Bare page candidate.
  const pageId = pickStringField(obj, ["page_id", "id"]);
  const pageName = pickStringField(obj, ["page_name", "name"]);
  if (pageId && pageName && /^\d{6,}$/.test(pageId)) {
    yield {
      pageId,
      pageName,
      adCount: pickNumberField(obj, ["ig_ad_count", "ad_count", "total_active_ads"]) ?? 0,
      verified: pickBoolField(obj, ["page_is_verified", "is_verified"]) ?? false,
      profilePictureUrl:
        pickStringField(obj, ["page_profile_picture_url", "profile_picture_url"]) ?? null,
    };
  }

  for (const v of Object.values(obj)) {
    yield* findPageCandidates(v);
  }
}

/**
 * Extract candidates from the initial HTML's JSON islands. Uses the same balanced-brace
 * walk as scrape.ts to slice out enclosing JSON objects around each match.
 */
function findPageCandidatesInHtml(html: string): PageCandidate[] {
  const out: PageCandidate[] = [];
  const seen = new Set<string>();
  // Look for "page_id":"<digits>" combined with "page_name" in the nearby context.
  // We include matches inside ad records — that's where most candidates live (every ad
  // carries its page_id + page_name in the snapshot).
  const regex = /"page_id":"(\d{6,})"/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const pageId = m[1];
    if (seen.has(pageId)) continue;
    const window = html.slice(Math.max(0, m.index - 800), Math.min(html.length, m.index + 800));
    const nameMatch = /"page_name":"([^"]{1,120})"/.exec(window);
    if (!nameMatch) continue;
    seen.add(pageId);
    out.push({
      pageId,
      pageName: decodeJsonString(nameMatch[1]),
      adCount: 0,
      verified:
        /"page_is_verified":true/.test(window) || /"is_verified":true/.test(window),
      profilePictureUrl: null,
    });
  }
  return out;
}

function decodeJsonString(s: string): string {
  // Already-decoded — just unescape common sequences.
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

function pickStringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickNumberField(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  return null;
}

function pickBoolField(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

/**
 * Score a candidate 0..1.
 * - Name similarity (Dice coefficient on lowercased alphanumeric tokens) is the dominant signal.
 * - Verified badge gives a small boost.
 * - Active ad count gives a small boost (a page with ads is more likely the brand we want).
 */
function scoreCandidate(input: string, c: PageCandidate): number {
  const sim = nameSimilarity(input, c.pageName);
  let score = sim;
  if (c.verified) score += 0.05;
  if (c.adCount > 0) score += 0.05;
  return Math.min(1, score);
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Loose containment: "Monday.com" vs "monday.com Work OS" → 0.7
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return 0.4 + 0.5 * (shorter / longer);
  }
  // Bigram Dice coefficient — better than Levenshtein for short brand names.
  const bigrams = (s: string) => {
    const g = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

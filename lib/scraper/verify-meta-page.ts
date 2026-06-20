/**
 * Verify a Meta page_id by hitting its Ad Library URL and confirming the page exists.
 *
 * Unlike `resolveMetaPage` (which mines candidate page IDs from keyword-search results),
 * this is the inverse: we *already* have a page_id from user paste, and we want to
 * confirm it resolves to a real page so we can save it with confidence and show the user
 * the canonical page_name + ad count before commit.
 *
 * Strategy: navigate to view_all_page_id=<id>, intercept JSON responses + walk the SSR
 * HTML, find any ad record or header block whose page_id matches our target, and harvest
 * the page_name from there. Done.
 *
 * If the page has zero current ads OR is completely fictitious, we won't find a match
 * and return `{ ok: false }`. That's the correct outcome — a page with no ads in the
 * library is functionally useless for this tool anyway.
 */

import { chromium, type Response } from "playwright";
import { buildCanonicalPageUrl } from "./resolve-meta-page";

export type VerifyResult =
  | {
      ok: true;
      pageId: string;
      pageName: string;
      adCount: number;
      verified: boolean;
      profilePictureUrl: string | null;
      canonicalUrl: string;
    }
  | {
      ok: false;
      reason: string;
    };

export async function verifyMetaPage(
  pageId: string,
  country: string = "US"
): Promise<VerifyResult> {
  if (!/^\d{6,}$/.test(pageId)) {
    return { ok: false, reason: "Page ID must be at least 6 digits." };
  }

  const url = buildCanonicalPageUrl(pageId, country);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  let match: {
    pageName: string;
    verified: boolean;
    profilePictureUrl: string | null;
  } | null = null;
  let adsFromThisPage = 0;

  page.on("response", async (response: Response) => {
    try {
      const contentType = response.headers()["content-type"] ?? "";
      if (!/application\/(x-)?(ndjson|json)|text\/javascript/i.test(contentType)) return;
      const reqUrl = response.url();
      if (!/facebook\.com\/(api\/graphql|ads\/library)/.test(reqUrl)) return;
      const body = await response.text().catch(() => "");
      if (!body || !body.includes(pageId)) return;
      for (const root of parsePossiblyNdjson(body)) {
        const found = findMatchingPage(root, pageId);
        if (found.match && !match) match = found.match;
        adsFromThisPage += found.adCount;
      }
    } catch {
      // never throw from response listener
    }
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Also walk the SSR HTML — the page header is often there before the first GraphQL fetch.
    try {
      const html = await page.content();
      if (!match) {
        match = findMatchInHtml(html, pageId);
      }
      // Count ad_archive_id occurrences attributed to our page in the HTML.
      const htmlCount = countAdsInHtml(html, pageId);
      adsFromThisPage += htmlCount;
    } catch {
      // non-fatal
    }

    // If we still have no match, scroll a bit to trigger lazy-loaded GraphQL with header info.
    if (!match) {
      for (let i = 0; i < 3 && !match; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(1500);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!match) {
    return {
      ok: false,
      reason:
        "Couldn't find a Meta page with that ID. Double-check the URL — make sure it includes view_all_page_id=… or paste the numeric page ID directly.",
    };
  }

  const m = match as { pageName: string; verified: boolean; profilePictureUrl: string | null };
  return {
    ok: true,
    pageId,
    pageName: m.pageName,
    adCount: adsFromThisPage,
    verified: m.verified,
    profilePictureUrl: m.profilePictureUrl,
    canonicalUrl: url,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

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
 * Recursively walk a JSON value looking for either:
 *   - An ad record whose page_id matches → harvest page_name from snapshot.
 *   - A page header object with page_id + page_name fields → harvest directly.
 */
function findMatchingPage(
  value: unknown,
  targetPageId: string
): {
  match: { pageName: string; verified: boolean; profilePictureUrl: string | null } | null;
  adCount: number;
} {
  let result: { pageName: string; verified: boolean; profilePictureUrl: string | null } | null =
    null;
  let adCount = 0;

  function walk(v: unknown) {
    if (result) return; // short-circuit once we have a name; still count ads via outer regex elsewhere
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    const obj = v as Record<string, unknown>;

    // Ad record shape: { ad_archive_id, page_id, snapshot: { page_name, page_profile_picture_url } }
    if (typeof obj.ad_archive_id === "string") {
      const pid = pickStringField(obj, ["page_id"]);
      if (pid === targetPageId) {
        adCount += 1;
        if (!result) {
          const snap = (obj.snapshot && typeof obj.snapshot === "object"
            ? (obj.snapshot as Record<string, unknown>)
            : {}) as Record<string, unknown>;
          const name =
            pickStringField(snap, ["page_name"]) ?? pickStringField(obj, ["page_name"]);
          if (name) {
            result = {
              pageName: name,
              verified: pickBoolField(snap, ["page_is_verified"]) ?? false,
              profilePictureUrl: pickStringField(snap, ["page_profile_picture_url"]) ?? null,
            };
          }
        }
      }
      return; // don't recurse into ad snapshot
    }

    // Page header shape: { page_id, page_name, page_profile_picture_url }
    const pid = pickStringField(obj, ["page_id", "id"]);
    if (pid === targetPageId) {
      const name = pickStringField(obj, ["page_name", "name"]);
      if (name && !result) {
        result = {
          pageName: name,
          verified:
            pickBoolField(obj, ["page_is_verified", "is_verified"]) ?? false,
          profilePictureUrl: pickStringField(obj, [
            "page_profile_picture_url",
            "profile_picture_url",
          ]),
        };
      }
    }

    for (const inner of Object.values(obj)) walk(inner);
  }

  walk(value);
  return { match: result, adCount };
}

function findMatchInHtml(
  html: string,
  targetPageId: string
): { pageName: string; verified: boolean; profilePictureUrl: string | null } | null {
  // Look for "page_id":"<targetPageId>" and grab nearby page_name.
  const idPattern = new RegExp(`"page_id":"${targetPageId}"`, "g");
  let m: RegExpExecArray | null;
  while ((m = idPattern.exec(html)) !== null) {
    const window = html.slice(
      Math.max(0, m.index - 1200),
      Math.min(html.length, m.index + 1200)
    );
    const nameMatch = /"page_name":"([^"]{1,120})"/.exec(window);
    if (!nameMatch) continue;
    const verified =
      /"page_is_verified":true/.test(window) || /"is_verified":true/.test(window);
    const profileMatch =
      /"page_profile_picture_url":"([^"]+)"/.exec(window) ??
      /"profile_picture_url":"([^"]+)"/.exec(window);
    return {
      pageName: decodeJsonString(nameMatch[1]),
      verified,
      profilePictureUrl: profileMatch ? decodeJsonString(profileMatch[1]) : null,
    };
  }
  return null;
}

function countAdsInHtml(html: string, targetPageId: string): number {
  // Quick heuristic — count ad_archive_id occurrences in 600-char windows that also
  // contain our page_id. Approximate but good enough for a UX hint.
  const idPattern = new RegExp(`"page_id":"${targetPageId}"`, "g");
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = idPattern.exec(html)) !== null) {
    const window = html.slice(
      Math.max(0, m.index - 400),
      Math.min(html.length, m.index + 400)
    );
    if (/"ad_archive_id":"/.test(window)) count += 1;
  }
  return count;
}

function decodeJsonString(s: string): string {
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

function pickBoolField(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

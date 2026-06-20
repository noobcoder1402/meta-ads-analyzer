/**
 * Parse free-text user input into a Meta page_id.
 *
 * Users paste all kinds of things when asked for a "Meta page":
 *   - A full Ad Library URL:   https://www.facebook.com/ads/library/?…&view_all_page_id=123456
 *   - A different param order: https://www.facebook.com/ads/library/?view_all_page_id=123456&country=US
 *   - A Facebook page URL with the numeric ID baked in:
 *       https://www.facebook.com/pages/Acme/123456789
 *   - A vanity FB URL:         https://www.facebook.com/acmehq   ← we can't resolve this without a fetch
 *   - Just the numeric ID:     123456789
 *
 * We try the cheap, deterministic parses here. Vanity URLs are *not* resolved by this
 * parser — they need a network round-trip and belong in the verifier. The parser returns
 * `{ kind: 'vanity', vanity }` for those so the API can decide what to do.
 *
 * Page IDs on Meta are >=8 digits in practice. We allow 6+ to be lenient with the future.
 */

export type ParseResult =
  | { kind: "page_id"; pageId: string; source: "view_all_page_id" | "pages_path" | "numeric" }
  | { kind: "vanity"; vanity: string }
  | { kind: "invalid"; reason: string };

export function parseMetaPageInput(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "invalid", reason: "Input is empty." };

  // 1. Naked numeric (12345678) — most lenient case.
  if (/^\d{6,}$/.test(trimmed)) {
    return { kind: "page_id", pageId: trimmed, source: "numeric" };
  }

  // 2. URL parses — try as a URL, fall through if it isn't one.
  let url: URL | null = null;
  try {
    // Allow "facebook.com/..." without protocol.
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(candidate);
  } catch {
    url = null;
  }

  if (url) {
    const host = url.hostname.toLowerCase();
    // Accept facebook.com, www.facebook.com, m.facebook.com, web.facebook.com, business.facebook.com.
    const isFb = /(^|\.)facebook\.com$/.test(host);
    if (!isFb) {
      return {
        kind: "invalid",
        reason: "URL isn't a facebook.com URL.",
      };
    }

    // 2a. ?view_all_page_id=NNN — the canonical Ad Library URL form.
    const viewAll = url.searchParams.get("view_all_page_id");
    if (viewAll && /^\d{6,}$/.test(viewAll)) {
      return { kind: "page_id", pageId: viewAll, source: "view_all_page_id" };
    }

    // 2b. /pages/<name>/<id> — older FB page URL form, embeds numeric ID at the end.
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0]?.toLowerCase() === "pages") {
      const last = segments[segments.length - 1];
      if (last && /^\d{6,}$/.test(last)) {
        return { kind: "page_id", pageId: last, source: "pages_path" };
      }
    }

    // 2c. Vanity URL — facebook.com/<vanity>. Can't resolve without a fetch.
    if (segments.length === 1 && /^[a-zA-Z0-9.\-_]{3,}$/.test(segments[0])) {
      return { kind: "vanity", vanity: segments[0] };
    }

    return {
      kind: "invalid",
      reason:
        "Couldn't find a page ID in that URL. Paste an Ad Library URL with ?view_all_page_id=… or just the numeric page ID.",
    };
  }

  return {
    kind: "invalid",
    reason: "That doesn't look like a page ID or a facebook.com URL.",
  };
}

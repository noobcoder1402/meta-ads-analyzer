import * as cheerio from "cheerio";

export type WebsiteScrapeResult = {
  url: string;
  pages: Array<{ url: string; title: string; text: string }>;
  combinedText: string;
};

const USER_AGENT =
  "Mozilla/5.0 (compatible; MetaAdsAnalyzer/0.1; +https://github.com/anthropics/meta-ads-analyzer)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 8_000;

export async function scrapeWebsite(rawUrl: string): Promise<WebsiteScrapeResult> {
  const homeUrl = normalizeUrl(rawUrl);
  const homePage = await fetchAndExtract(homeUrl);

  const candidates = discoverSubpages(homePage.html, homeUrl);
  const pages: Array<{ url: string; title: string; text: string }> = [
    { url: homeUrl, title: homePage.title, text: homePage.text },
  ];

  for (const candidate of candidates) {
    try {
      const sub = await fetchAndExtract(candidate);
      pages.push({ url: candidate, title: sub.title, text: sub.text });
    } catch {
      // Subpage fetch failure is non-fatal; we already have the homepage.
    }
  }

  const combinedText = pages
    .map((p) => `=== ${p.title || p.url} (${p.url}) ===\n${p.text}`)
    .join("\n\n");

  return { url: homeUrl, pages, combinedText };
}

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function fetchAndExtract(
  url: string
): Promise<{ html: string; text: string; title: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    $("script, style, noscript, svg, nav, footer, header, form, iframe").remove();

    const title = $("title").first().text().trim() || $("h1").first().text().trim();

    const bodyText = $("body").text();
    const cleaned = bodyText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n")
      .slice(0, MAX_PAGE_CHARS);

    return { html, text: cleaned, title };
  } finally {
    clearTimeout(timeout);
  }
}

function discoverSubpages(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const wanted: Record<string, RegExp> = {
    pricing: /^\/?pricing\/?$|\bpricing\b/i,
    about: /^\/?about\/?$|\babout(\s+us)?\b/i,
  };
  const found = new Map<string, string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const parsed = new URL(absolute);
    if (parsed.hostname !== base.hostname) return;
    parsed.hash = "";
    parsed.search = "";
    const normalized = parsed.toString().replace(/\/$/, "");
    const linkText = $(el).text().trim().toLowerCase();
    const pathname = parsed.pathname;
    for (const [key, re] of Object.entries(wanted)) {
      if (found.has(key)) continue;
      if (re.test(pathname) || re.test(linkText)) {
        found.set(key, normalized);
      }
    }
  });

  return Array.from(found.values()).filter((u) => u !== baseUrl);
}

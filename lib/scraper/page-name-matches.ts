// ─── Brand-match filter ──────────────────────────────────────────────
//
// Decides whether an ad's Meta page_name belongs to the competitor we're
// scraping. Pure and dependency-free so it can be unit-tested in isolation
// (the main scraper module pulls in Playwright + the DB layer).

// Corporate/suffix tokens that carry no brand identity. Stripped before
// comparison so "Monday" still matches the page "Monday.com".
const BRAND_NOISE_TOKENS = new Set([
  "com", "inc", "llc", "ltd", "co", "corp", "official", "app", "hq",
  "the", "io", "ai",
]);

function brandTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !BRAND_NOISE_TOKENS.has(t));
}

// Whole-token match, not raw substring: "Asana" must NOT match the unrelated
// page "Asana Rebel", but "Monday" must still match "Monday.com". We compare
// the brand-significant token *sets* for equality after dropping noise tokens.
// Erring toward false negatives is deliberate — a missed match is recoverable
// via the manual "Set Meta page" button, but a wrong-brand ad poisons analysis.
export function pageNameMatches(competitorName: string, pageName: string): boolean {
  const a = brandTokens(competitorName);
  const b = brandTokens(pageName);
  if (a.length === 0 || b.length === 0) {
    // Both reduced to pure noise — fall back to exact normalized equality.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const na = norm(competitorName);
    const nb = norm(pageName);
    return na.length > 0 && na === nb;
  }
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((t) => setB.has(t));
}

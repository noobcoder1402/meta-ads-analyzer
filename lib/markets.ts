/**
 * Shared market/country constants.
 *
 * This module is intentionally PURE — it imports nothing (no Playwright, no DB),
 * so it is safe to import from both the Node scraper and browser ("use client")
 * components. The scrape dialog imports COUNTRY_OPTIONS for its "Specific country"
 * picker; the scraper imports ALL_COUNTRIES (the global-view sentinel).
 */

/** Meta's global "All countries" sentinel. Gives total volume + authoritative live/paused. */
export const ALL_COUNTRIES = "ALL";

/**
 * Curated list of Meta-supported country libraries for the "Specific country"
 * picker. Codes are ISO-3166 alpha-2 (Meta's `country` URL param). Deliberately
 * kept to ~18 major advertising markets (not an exhaustive list) so the dropdown
 * stays short and every code is known-good — an unsupported code just returns an
 * empty library that looks like "no ads". Note Meta uses `GB`, not `UK`.
 */
export const COUNTRY_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "IN", name: "India" },
  { code: "SG", name: "Singapore" },
  { code: "JP", name: "Japan" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "ZA", name: "South Africa" },
];

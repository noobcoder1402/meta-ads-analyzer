import { getAllAdsForExport } from "@/lib/db/queries";

// Reads SQLite via better-sqlite3 (Node, not edge). force-dynamic so the export always
// reflects the current DB, never a cached build.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/raw-data — download every scraped ad as a CSV ("raw data" for manual analysis).
 *
 * One row per ad, brand name joined in, human-readable column headers. CSV opens directly
 * in Excel / Google Sheets. This is a READ — no DB writes, no paid AI — so it's safe to
 * leave unguarded and works in the read-only demo too.
 */

type ExportRow = Awaited<ReturnType<typeof getAllAdsForExport>>[number];

// Human-readable headers (the person opening this in Excel is an outside reader, not us)
// paired with how to pull each value from a row. Order = column order in the sheet.
const COLUMNS: { header: string; get: (r: ExportRow) => unknown }[] = [
  { header: "Brand", get: (r) => r.brand },
  { header: "Status", get: (r) => (r.isActive ? "Active" : "Inactive") },
  { header: "Ad Library ID", get: (r) => r.libraryId },
  {
    header: "Ad Library URL",
    get: (r) => `https://www.facebook.com/ads/library/?id=${r.libraryId}`,
  },
  { header: "Body copy", get: (r) => r.caption },
  { header: "Headline", get: (r) => r.title },
  { header: "Link description", get: (r) => r.linkDescription },
  { header: "Call to action", get: (r) => r.ctaLabel },
  { header: "Landing URL", get: (r) => r.landingUrl },
  { header: "Display link", get: (r) => r.displayLink },
  { header: "Media type", get: (r) => r.mediaType },
  { header: "Ad format", get: (r) => r.displayFormat },
  { header: "Days running", get: (r) => r.daysActive },
  { header: "Start date", get: (r) => r.startDate },
  { header: "End date", get: (r) => r.endDate },
  { header: "Placements", get: (r) => r.placements },
  { header: "Countries", get: (r) => r.countries },
  { header: "Reused-creative count", get: (r) => r.collationCount },
  { header: "AI-generated media", get: (r) => r.containsAiMedia },
  { header: "Page followers", get: (r) => r.pageLikeCount },
  { header: "Page categories", get: (r) => r.pageCategories },
  { header: "Ad categories", get: (r) => r.adCategories },
  { header: "First seen", get: (r) => r.firstSeenAt },
  { header: "Last seen", get: (r) => r.lastSeenAt },
];

/** Turn one value into a safe CSV cell: join arrays, Yes/No booleans, quote when needed. */
function csvCell(value: unknown): string {
  if (value == null) return "";
  let s: string;
  if (Array.isArray(value)) s = value.join("; ");
  else if (typeof value === "boolean") s = value ? "Yes" : "No";
  else s = String(value);
  // Quote if the cell contains a comma, quote, or newline; double up inner quotes.
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  const rows = await getAllAdsForExport();

  const lines: string[] = [];
  lines.push(COLUMNS.map((c) => csvCell(c.header)).join(","));
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvCell(c.get(row))).join(","));
  }

  // Lead with a UTF-8 BOM so Excel renders non-English copy (German/French/Portuguese
  // ads) correctly instead of as mojibake.
  const csv = "﻿" + lines.join("\r\n");

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="meta-ads-raw-data-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

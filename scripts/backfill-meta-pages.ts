/**
 * scripts/backfill-meta-pages.ts — populate competitors.meta_page_id for rows that lack it.
 *
 * Usage:
 *   pnpm backfill:pages                     # backfill all competitors missing a page_id
 *   pnpm backfill:pages --only-status=self  # restrict to one status (self|accepted|manual|suggested)
 *   pnpm backfill:pages --force             # re-resolve even rows that already have a page_id
 *   pnpm backfill:pages --dry-run           # show what would change, don't write
 *
 * What it does: for each candidate competitor, asks the Meta page resolver for the best
 * Meta Ad Library page matching the brand name. If a confident match is found, writes
 * the page_id + the canonical view_all_page_id URL back to the row.
 *
 * Why a one-time backfill: existing competitors were inserted with AI-generated keyword
 * search URLs that don't actually point at the brand's ads. This script replaces those
 * with verified per-page URLs so scrape.ts can do its job.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db/client";
import { competitors } from "../lib/db/schema";
import { resolveMetaPage, buildCanonicalPageUrl } from "../lib/scraper/resolve-meta-page";

type Args = {
  onlyStatus: string | null;
  force: boolean;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const map: Record<string, string> = {};
  let force = false;
  let dryRun = false;
  for (const a of argv) {
    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) map[m[1]] = m[2];
  }
  return {
    onlyStatus: map["only-status"] ?? null,
    force,
    dryRun,
  };
}

async function main() {
  const args = parseArgs();

  // Pull rows.
  const rows = await db.select().from(competitors);
  const candidates = rows.filter((r) => {
    if (r.deletedAt) return false;
    if (args.onlyStatus && r.status !== args.onlyStatus) return false;
    if (!args.force && r.metaPageId) return false;
    return true;
  });

  console.log(`Found ${candidates.length} competitor(s) to process.`);
  if (args.dryRun) console.log("(dry-run mode — no DB writes)\n");

  for (const row of candidates) {
    const country = row.country ?? "US";
    console.log(`\n→ ${row.name} (${row.status}, country=${country})`);
    try {
      const { best, candidates: all } = await resolveMetaPage(row.name, country);

      if (!best) {
        console.log(`  ✗ no confident match (${all.length} candidates seen)`);
        if (all.length > 0) {
          for (const c of all.slice(0, 3)) {
            console.log(`    · ${c.pageName} [${c.pageId}] ads=${c.adCount}${c.verified ? " ✓" : ""}`);
          }
        }
        continue;
      }

      const canonicalUrl = buildCanonicalPageUrl(best.pageId, country);
      console.log(`  ✓ best: ${best.pageName} [${best.pageId}]${best.verified ? " ✓" : ""} ads=${best.adCount}`);
      console.log(`    url: ${canonicalUrl}`);

      if (!args.dryRun) {
        await db
          .update(competitors)
          .set({
            metaPageId: best.pageId,
            metaPageUrl: canonicalUrl,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(competitors.id, row.id));
        console.log(`    saved.`);
      }
    } catch (err) {
      console.log(`  ! error: ${(err as Error).message}`);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});

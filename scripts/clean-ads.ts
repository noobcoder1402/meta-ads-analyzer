/**
 * scripts/clean-ads.ts
 *
 * Library hygiene: delete ads that are BOTH paused AND not successfully analyzed.
 *
 * Rationale: a paused ad we never managed to analyze carries no signal — it isn't
 * a live ad worth watching, and with no analysis it can't appear in any angle
 * grouping, the synthesis, or the swipe file. It's just clutter. This prunes it.
 *
 * What it KEEPS (deliberately):
 *   - every ACTIVE ad (regardless of analysis state — these still matter and get
 *     analyzed on the next Analyze run),
 *   - every ad with a SUCCESSFUL analysis, including PAUSED ones (those are the
 *     "Tried & dropped" / proven-but-rotated creatives we surface on purpose).
 *
 * "Successfully analyzed" = an ad_analyses row exists with analysis_failed_at IS NULL.
 * A failed stub (analysis_failed_at set) does NOT count.
 *
 * For each deleted ad it also removes the orphaned performance_scores + ad_analyses
 * rows and the downloaded creative files on disk (data/ad-creatives/), so nothing is
 * left dangling.
 *
 * ZERO AI cost. Demo mode is blocked (read-only deployment must never delete).
 *
 * Usage:
 *   pnpm clean:ads --dry-run     # preview what would be deleted (no writes)
 *   pnpm clean:ads               # actually delete
 */
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db/client";
import {
  ads,
  adAnalyses,
  performanceScores,
  competitors,
} from "../lib/db/schema";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (process.env.DEMO_MODE === "true") {
    console.error("Demo mode: clean:ads is disabled (read-only deployment).");
    process.exit(1);
  }

  console.log(
    `\nCleaning paused + un-analyzed ads${dryRun ? " (DRY RUN — no writes)" : ""}…\n`
  );

  // Candidate = paused ad with NO successful analysis. LEFT join so ads with no
  // analysis row at all are included; the predicate also catches failed stubs.
  // (ad_analyses.ad_id is UNIQUE → one row per ad, so no fan-out.)
  const candidates = await db
    .select({
      id: ads.id,
      libraryId: ads.libraryId,
      competitorId: ads.competitorId,
      mediaPaths: ads.mediaPaths,
    })
    .from(ads)
    .leftJoin(adAnalyses, eq(ads.id, adAnalyses.adId))
    .where(
      and(
        eq(ads.isActive, false),
        sql`(
          ${adAnalyses.id} IS NULL
          OR ${adAnalyses.analysisFailedAt} IS NOT NULL
        )`
      )
    );

  if (candidates.length === 0) {
    console.log("Nothing to clean — no paused, un-analyzed ads found.\n");
    return;
  }

  // Per-competitor breakdown for a readable summary.
  const comps = await db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors);
  const nameById = new Map(comps.map((c) => [c.id, c.name]));
  const perCompetitor = new Map<string, number>();
  for (const c of candidates) {
    perCompetitor.set(
      c.competitorId,
      (perCompetitor.get(c.competitorId) ?? 0) + 1
    );
  }

  console.log(`Found ${candidates.length} paused, un-analyzed ad(s) to delete:`);
  for (const [cid, n] of [...perCompetitor.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${nameById.get(cid) ?? cid}: ${n}`);
  }
  console.log("");

  if (dryRun) {
    console.log("DRY RUN complete — no changes written.\n");
    return;
  }

  const ids = candidates.map((c) => c.id);

  // Delete child rows first (no ON DELETE CASCADE in the schema), then the ads.
  // chunk the IN (…) lists so SQLite's variable limit is never an issue.
  for (const chunk of chunked(ids, 400)) {
    await db.delete(performanceScores).where(inArray(performanceScores.adId, chunk));
    await db.delete(adAnalyses).where(inArray(adAnalyses.adId, chunk));
    await db.delete(ads).where(inArray(ads.id, chunk));
  }

  // Delete the downloaded creative files for these ads.
  let filesDeleted = 0;
  for (const c of candidates) {
    for (const rel of c.mediaPaths ?? []) {
      const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
      try {
        await fs.unlink(abs);
        filesDeleted++;
      } catch {
        // file already gone / never downloaded — fine
      }
    }
  }

  console.log(`Deleted ${candidates.length} ad(s) and ${filesDeleted} creative file(s).\n`);
}

/** Split an array into fixed-size chunks. */
function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * scripts/backfill-conversion-goals.ts
 *
 * One-time (re-runnable) backfill: recompute every ad_analyses row's
 * primary_conversion_goal from its ad's Meta CTA (lib/ads/cta-to-goal.ts),
 * replacing the old AI-inferred value. ZERO AI calls — pure deterministic map.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-conversion-goals.ts [--dry-run]
 */
import { eq } from "drizzle-orm";
import { db } from "../lib/db/client";
import { ads, adAnalyses } from "../lib/db/schema";
import { ctaToConversionGoal } from "../lib/ads/cta-to-goal";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(
    `\nBackfilling conversion goals from Meta CTAs${dryRun ? " (DRY RUN — no writes)" : ""}…\n`
  );

  // 1. Recompute primary_conversion_goal for every analysis from its ad's CTA.
  const rows = await db
    .select({
      adId: adAnalyses.adId,
      ctaLabel: ads.ctaLabel,
      current: adAnalyses.primaryConversionGoal,
    })
    .from(adAnalyses)
    .innerJoin(ads, eq(ads.id, adAnalyses.adId));

  let changed = 0;
  const fromTo = new Map<string, number>(); // "old→new" → count, for a summary

  for (const r of rows) {
    const next = ctaToConversionGoal(r.ctaLabel);
    if (next === r.current) continue;
    changed++;
    const key = `${r.current ?? "null"} → ${next}`;
    fromTo.set(key, (fromTo.get(key) ?? 0) + 1);
    if (!dryRun) {
      await db
        .update(adAnalyses)
        .set({ primaryConversionGoal: next })
        .where(eq(adAnalyses.adId, r.adId));
    }
  }

  console.log(`Analyses scanned: ${rows.length}`);
  console.log(`Goals changed:    ${changed}\n`);
  for (const [k, n] of [...fromTo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }

  console.log(`\n${dryRun ? "DRY RUN complete — no changes written." : "Done."}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

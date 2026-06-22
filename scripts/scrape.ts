/**
 * scripts/scrape.ts — thin CLI wrapper around lib/scraper/scrape-competitor.ts.
 *
 * The actual scraping logic lives in lib/scraper/scrape-competitor.ts so both
 * this CLI and the dashboard's `Scrape ads` button (API route) share the same
 * code path. This file only parses argv and streams progress events to stdout.
 *
 * Usage:
 *   pnpm scrape --competitor-id=<uuid>                        (default market — usually US)
 *   pnpm scrape --competitor-id=<uuid> --country=US
 *   pnpm scrape --competitor-id=<uuid> --country=ALL          (global view — the UI's default scrape)
 *   pnpm scrape --competitor-id=<uuid> --max-ads=25
 *   pnpm scrape --competitor-id=<uuid> --active-status=active   (live ads only; also: inactive | all)
 *   pnpm scrape --competitor-id=<uuid> --headed
 *
 *   # The UI-facing mode orchestrator (matches the "Scrape ads" dialog buttons). Runs the
 *   # correct 1-2 passes in order (active pass LAST). Overrides --active-status/--max-ads.
 *   pnpm scrape --competitor-id=<uuid> --mode=active                 (all live, uncapped)
 *   pnpm scrape --competitor-id=<uuid> --mode=active_plus_sample     (all live + ≤200 paused)
 *   pnpm scrape --competitor-id=<uuid> --mode=active_plus_sample --paused-sample=100
 *   pnpm scrape --competitor-id=<uuid> --mode=active_plus_all        (everything, uncapped)
 */

import {
  scrapeCompetitor,
  scrapeCompetitorByMode,
  type ScrapeEvent,
  type ActiveStatus,
  type ScrapeMode,
} from "../lib/scraper/scrape-competitor";

const SCRAPE_MODES: ScrapeMode[] = ["active", "active_plus_sample", "active_plus_all"];

type Args = {
  competitorId: string;
  country?: string;
  maxAds?: number;
  activeStatus?: ActiveStatus;
  /** UI-facing mode. When set, runs the 1-2 pass orchestrator instead of a single pass. */
  mode?: ScrapeMode;
  /** Paused-sample size for active_plus_sample. */
  pausedSample?: number;
  headed: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const map: Record<string, string> = {};
  let headed = false;
  for (const arg of argv) {
    if (arg === "--headed") {
      headed = true;
      continue;
    }
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) map[m[1]] = m[2];
  }
  const competitorId = map["competitor-id"];
  if (!competitorId) {
    console.error("Missing --competitor-id=<uuid>");
    console.error("Tip: run `pnpm db:studio` and copy a competitor row's id.");
    process.exit(2);
  }
  const maxAdsRaw = Number(map["max-ads"]);
  const activeStatusRaw = map["active-status"]?.toLowerCase();
  if (activeStatusRaw && !["all", "active", "inactive"].includes(activeStatusRaw)) {
    console.error(`Invalid --active-status=${activeStatusRaw}. Use: all | active | inactive`);
    process.exit(2);
  }
  const modeRaw = map["mode"]?.toLowerCase();
  if (modeRaw && !SCRAPE_MODES.includes(modeRaw as ScrapeMode)) {
    console.error(`Invalid --mode=${modeRaw}. Use: ${SCRAPE_MODES.join(" | ")}`);
    process.exit(2);
  }
  const pausedSampleRaw = Number(map["paused-sample"]);
  return {
    competitorId,
    country: map["country"]?.toUpperCase(),
    maxAds: Number.isFinite(maxAdsRaw) && maxAdsRaw > 0 ? maxAdsRaw : undefined,
    activeStatus: activeStatusRaw as ActiveStatus | undefined,
    mode: modeRaw as ScrapeMode | undefined,
    pausedSample:
      Number.isFinite(pausedSampleRaw) && pausedSampleRaw > 0 ? pausedSampleRaw : undefined,
    headed,
  };
}

function handleEvent(e: ScrapeEvent) {
  switch (e.type) {
    case "log":
      console.log(e.message);
      break;
    case "navigate":
      console.log(`  country: ${e.country}`);
      console.log(`  active status: ${e.activeStatus}`);
      console.log(`  max ads: ${e.maxAds}`);
      console.log(`  url: ${e.url}\n`);
      break;
    case "progress":
      process.stdout.write(
        `\r  matching ads so far: ${e.matchingAds} (total observed: ${e.totalObserved})  `
      );
      break;
    case "saved-ad":
      if (e.isNew) {
        process.stdout.write("\n");
        console.log(`  + ${e.libraryId} (${e.mediaType}) ${e.captionPreview}`);
      }
      break;
    case "done": {
      const r = e.result;
      console.log("\n──");
      console.log(`  status:           ${r.status}`);
      console.log(`  total observed:   ${r.totalObserved}`);
      console.log(`  matched brand:    ${r.matchedBrand}`);
      console.log(`  saved:            ${r.saved}`);
      console.log(`  new:              ${r.adsNew}`);
      console.log(`  unchanged:        ${r.adsUnchanged}`);
      console.log(`  went inactive:    ${r.adsWentInactive}`);
      if (r.errorMessage) console.log(`  error:            ${r.errorMessage}`);
      console.log("──\n");
      break;
    }
    case "warning":
      process.stdout.write("\n");
      console.warn(`  ⚠️  ${e.message}`);
      break;
    case "error":
      console.error("\nScrape error:", e.message);
      break;
  }
}

async function main() {
  const args = parseArgs();
  try {
    // --mode runs the UI-facing 1-2 pass orchestrator (active / active_plus_sample /
    // active_plus_all). Without it, fall back to a single pass driven by --active-status
    // + --max-ads (the original power-user path).
    const result = args.mode
      ? await scrapeCompetitorByMode({
          competitorId: args.competitorId,
          mode: args.mode,
          country: args.country,
          pausedSample: args.pausedSample,
          headed: args.headed,
          onEvent: handleEvent,
        })
      : await scrapeCompetitor({
          competitorId: args.competitorId,
          country: args.country,
          maxAds: args.maxAds,
          activeStatus: args.activeStatus,
          headed: args.headed,
          onEvent: handleEvent,
        });
    process.exit(result.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    process.exit(1);
  }
}

main();

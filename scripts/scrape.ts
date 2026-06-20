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
 *   pnpm scrape --competitor-id=<uuid> --headed
 */

import {
  scrapeCompetitor,
  type ScrapeEvent,
} from "../lib/scraper/scrape-competitor";

type Args = {
  competitorId: string;
  country?: string;
  maxAds?: number;
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
  return {
    competitorId,
    country: map["country"]?.toUpperCase(),
    maxAds: Number.isFinite(maxAdsRaw) && maxAdsRaw > 0 ? maxAdsRaw : undefined,
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
    case "error":
      console.error("\nScrape error:", e.message);
      break;
  }
}

async function main() {
  const args = parseArgs();
  try {
    const result = await scrapeCompetitor({
      competitorId: args.competitorId,
      country: args.country,
      maxAds: args.maxAds,
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

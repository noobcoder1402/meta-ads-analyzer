/**
 * scripts/analyze-ads.ts — thin CLI wrapper around the creative analyzer.
 *
 * The actual analyzer lives in lib/ai/analyzers/analyze-creative.ts so this CLI
 * and the dashboard's `Analyze ads` button share one code path. This file just
 * parses argv and prints events to stdout.
 *
 * Usage:
 *   pnpm analyze --competitor-id=<uuid>
 *   pnpm analyze --competitor-id=<uuid> --max-ads=10
 *   pnpm analyze --competitor-id=<uuid> --force        # re-analyze everything
 *   pnpm analyze --competitor-id=<uuid> --concurrency=3
 */

import {
  analyzeAdsForCompetitor,
  ANALYZER_VERSION,
  type AnalyzeEvent,
} from "../lib/ai/analyzers/analyze-creative";

type Args = {
  competitorId: string;
  maxAds?: number;
  concurrency?: number;
  force: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const map: Record<string, string> = {};
  let force = false;
  for (const arg of argv) {
    if (arg === "--force") {
      force = true;
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
  const concRaw = Number(map["concurrency"]);
  return {
    competitorId,
    maxAds: Number.isFinite(maxAdsRaw) && maxAdsRaw > 0 ? maxAdsRaw : undefined,
    concurrency:
      Number.isFinite(concRaw) && concRaw > 0 ? concRaw : undefined,
    force,
  };
}

function handleEvent(e: AnalyzeEvent) {
  switch (e.type) {
    case "log":
      console.log(e.message);
      break;
    case "progress":
      process.stdout.write(
        `\r  analyzed ${e.completed}/${e.total}  `
      );
      break;
    case "analyzed-ad":
      process.stdout.write("\n");
      console.log(
        `  ✓ ${e.libraryId} — [${e.angle}] ${e.hook.slice(0, 80)}${e.hook.length > 80 ? "…" : ""}`
      );
      break;
    case "failed-ad":
      process.stdout.write("\n");
      console.log(`  ✗ ${e.libraryId} — ${e.error.slice(0, 200)}`);
      break;
    case "done": {
      const r = e.result;
      console.log("\n──");
      console.log(`  analyzer version: ${r.analyzerVersion}`);
      console.log(`  status:           ${r.status}`);
      console.log(`  total queued:     ${r.total}`);
      console.log(`  analyzed:         ${r.analyzed}`);
      console.log(`  failed:           ${r.failed}`);
      console.log(`  skipped (no img): ${r.skipped}`);
      console.log("──\n");
      break;
    }
    case "error":
      console.error("\nAnalyzer error:", e.message);
      break;
  }
}

async function main() {
  const args = parseArgs();
  console.log(`Analyzer version: ${ANALYZER_VERSION}\n`);
  try {
    const result = await analyzeAdsForCompetitor({
      competitorId: args.competitorId,
      maxAds: args.maxAds,
      concurrency: args.concurrency,
      force: args.force,
      onEvent: handleEvent,
    });
    process.exit(result.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    process.exit(1);
  }
}

main();

/**
 * scripts/generate-recommendations.ts — thin CLI wrapper around the GTM recommender.
 *
 * The actual logic lives in lib/ai/analyzers/generate-recommendations.ts so this CLI
 * and the dashboard's (future) "Generate recommendations" button share one code path.
 * This file just prints events to stdout.
 *
 * Usage:
 *   pnpm recommend                # target 5-10 recs (spec default)
 *   pnpm recommend --count=3-5    # tighter list
 *
 * Needs ANTHROPIC_API_KEY from .env (the package script loads --env-file=.env).
 * If running under Claude Code, prefix with `env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL`
 * so the .env value wins over the injected one.
 */
import {
  generateRecommendations,
  type RecommendEvent,
} from "../lib/ai/analyzers/generate-recommendations";

function parseArgs(): { targetCount?: string } {
  const argv = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) map[m[1]] = m[2];
  }
  return { targetCount: map["count"] };
}

function handleEvent(e: RecommendEvent) {
  switch (e.type) {
    case "log":
      console.log(`  ${e.message}`);
      break;
    case "done": {
      const r = e.result;
      console.log("\n──");
      console.log(`  status:        ${r.status}`);
      console.log(`  recommendations: ${r.recommendationsCount}`);
      console.log(`  competitors compared: ${r.competitorsCompared}`);
      console.log(`  user has ads:  ${r.userHasAds ? "yes" : "no (positioning only)"}`);
      if (r.reason) console.log(`  note:          ${r.reason}`);
      console.log("──\n");
      break;
    }
    case "error":
      console.error("\nRecommender error:", e.message);
      break;
  }
}

async function main() {
  const { targetCount } = parseArgs();
  console.log("Generating GTM recommendations…\n");
  try {
    await generateRecommendations({ targetCount, onEvent: handleEvent });
    process.exit(0);
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    process.exit(1);
  }
}

main();

/**
 * scripts/synthesize-competitor.ts — thin CLI wrapper around the synthesizer.
 *
 * The actual logic lives in lib/ai/analyzers/synthesize-competitor.ts so this CLI
 * and the dashboard's `Find patterns` button share one code path. This file just
 * parses argv and prints events to stdout.
 *
 * Usage:
 *   pnpm synthesize --competitor-id=<uuid>
 *
 * Needs ANTHROPIC_API_KEY from .env (the package script loads --env-file=.env).
 * If running under Claude Code, prefix with `env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL`
 * so the .env value wins over the injected one.
 */
import {
  synthesizeCompetitor,
  type SynthesizeEvent,
} from "../lib/ai/analyzers/synthesize-competitor";
import { getCompetitorById } from "../lib/db/queries";

function parseArgs(): { competitorId: string } {
  const argv = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) map[m[1]] = m[2];
  }
  const competitorId = map["competitor-id"];
  if (!competitorId) {
    console.error("Missing --competitor-id=<uuid>");
    console.error("Tip: run `pnpm db:studio` and copy a competitor row's id.");
    process.exit(2);
  }
  return { competitorId };
}

function handleEvent(e: SynthesizeEvent) {
  switch (e.type) {
    case "log":
      console.log(`  ${e.message}`);
      break;
    case "done": {
      const r = e.result;
      console.log("\n──");
      console.log(`  status:        ${r.status}`);
      console.log(`  ads analyzed:  ${r.adsAnalyzedCount}`);
      if (r.reason) console.log(`  note:          ${r.reason}`);
      console.log("──\n");
      break;
    }
    case "error":
      console.error("\nSynthesizer error:", e.message);
      break;
  }
}

async function main() {
  const { competitorId } = parseArgs();
  const competitor = await getCompetitorById(competitorId);
  if (!competitor) {
    console.error(`No competitor found with id ${competitorId}`);
    process.exit(2);
  }
  console.log(`Synthesizing patterns for: ${competitor.name}\n`);
  try {
    const result = await synthesizeCompetitor({
      competitorId,
      competitorName: competitor.name,
      onEvent: handleEvent,
    });
    process.exit(result.status === "skipped" ? 0 : 0);
  } catch (err) {
    console.error("Unhandled error:", (err as Error).message);
    process.exit(1);
  }
}

main();

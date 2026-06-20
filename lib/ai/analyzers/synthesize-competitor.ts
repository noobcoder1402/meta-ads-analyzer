/**
 * Competitor synthesizer — text-only roll-up of ALL of one competitor's
 * analyzed ads into a pattern summary. See docs/ai-pipeline.md task #3.
 *
 * Hybrid design (deliberate, see ai-pipeline.md):
 *  - Frequency counts (dominant angles / conversion goals / brand voice) and the
 *    always-on-winners list are computed DETERMINISTICALLY here from the analyzed
 *    columns. Counting enums is exactly what an LLM gets subtly wrong, and we have
 *    the data — so we don't pay a model to (mis)count it.
 *  - The single Sonnet call does only the judgment work: top hooks, recent pivots,
 *    and clustering the active-experiment / abandoned buckets into named patterns.
 *
 * Cost guardrail: USER-TRIGGERED ONLY. Never auto-runs on scrape or schedule.
 * One call, ~$0.02-0.05 per competitor on Sonnet (text-only; vision cost was sunk
 * at the analyzer step). No input cap — capping by score would hide new + abandoned
 * ads, both of which are signal.
 */
import {
  getAnalyzedAdsForCompetitor,
  upsertCompetitorSynthesis,
} from "@/lib/db/queries";
import { classify, type BucketableAd } from "@/lib/scoring/buckets";
import { aggregateLanguages } from "@/lib/lang/detect-languages";
import { getAIClient } from "@/lib/ai/client";
import { CompetitorSynthesisSchema } from "@/lib/ai/schemas";
import {
  SYNTHESIZER_PROMPT_STATIC,
  buildSynthesizerPrompt,
  type SynthInputAd,
  type SynthBuckets,
} from "@/lib/ai/prompts/synthesizer";

export type SynthesizeEvent =
  | { type: "log"; message: string }
  | { type: "done"; result: SynthesizeResult }
  | { type: "error"; message: string };

export type SynthesizeResult = {
  status: "success" | "skipped";
  competitorId: string;
  adsAnalyzedCount: number;
  /** "skipped" reason when status is "skipped" (e.g. no analyzed ads). */
  reason?: string;
};

export type SynthesizeOptions = {
  competitorId: string;
  competitorName?: string;
  onEvent?: (event: SynthesizeEvent) => void;
};

type AnalyzedRow = Awaited<ReturnType<typeof getAnalyzedAdsForCompetitor>>[number];

export async function synthesizeCompetitor(
  opts: SynthesizeOptions
): Promise<SynthesizeResult> {
  const emit = (e: SynthesizeEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // never let a bad listener break the run
    }
  };

  const rows = await getAnalyzedAdsForCompetitor(opts.competitorId);

  if (rows.length === 0) {
    const result: SynthesizeResult = {
      status: "skipped",
      competitorId: opts.competitorId,
      adsAnalyzedCount: 0,
      reason: "No analyzed ads — run Analyze first, then synthesize.",
    };
    emit({ type: "log", message: result.reason! });
    emit({ type: "done", result });
    return result;
  }

  emit({
    type: "log",
    message: `Reading ${rows.length} analyzed ad${rows.length === 1 ? "" : "s"}…`,
  });

  // ── Deterministic aggregates (NOT the model's job) ──
  const dominantAngles = tally(rows.map((r) => r.angle));
  const dominantConversionGoal = tally(rows.map((r) => r.conversionGoal));
  // The user-facing "selling motion" — the raw Meta CTA buttons advertisers chose
  // ("Sign Up", "Learn More"), not our derived goal taxonomy (which read as jargon).
  const dominantCtas = tally(rows.map((r) => r.ctaLabel));
  const dominantBrandVoice = tally(rows.map((r) => r.brandVoice));

  // Creative-language footprint — detect from caption (author copy), fall back to
  // title. NEVER the CTA (Meta localizes it to the viewer). A "localization depth"
  // read, not a country claim. See lib/lang/detect-languages.ts.
  const creativeLanguages = aggregateLanguages(
    rows.map((r) => r.caption ?? r.title)
  );

  // Media mix — production-investment signal + recommender format-gap driver.
  const mediaMix = computeMediaMix(rows.map((r) => r.mediaType));

  // What they hammer — most-repeated pain points / benefits across analyzed ads.
  const topPainPoints = tallyArray(rows.flatMap((r) => r.painPoints ?? []));
  const topBenefits = tallyArray(rows.flatMap((r) => r.benefits ?? []));

  // Launch velocity — how aggressively they iterate. New LIVE creatives that
  // started running in the last 14 / 30 days. Uses Meta's start_date (encoded in
  // daysActive for live ads), NOT our scrape timing — see computeLaunchVelocity.
  const launchVelocity = computeLaunchVelocity(rows);

  // ── Bucket every ad (recomputed from current DB state each run) ──
  const buckets: SynthBuckets = { winners: [], experiments: [], abandoned: [], other: [] };
  const alwaysOnWinners: string[] = [];

  for (const row of rows) {
    const score = Math.round(row.score ?? 0);
    const bucketable: BucketableAd = {
      daysActive: row.daysActive,
      isActive: row.isActive,
      lastSeenAt: row.lastSeenAt,
    };
    const { bucket, tags } = classify(bucketable, score);
    if (tags.includes("always-on")) alwaysOnWinners.push(row.adId);

    const synthAd = toSynthAd(row, score);
    // `buckets.abandoned` feeds the synthesis `abandoned_patterns` output — it's
    // fed by the per-ad Flopped bucket (short-run deaths). Maturing and Retired ads
    // fold into `other` here (the synthesizer has no maturing/retired concept).
    if (bucket === "winner") buckets.winners.push(synthAd);
    else if (bucket === "new") buckets.experiments.push(synthAd);
    else if (bucket === "flopped") buckets.abandoned.push(synthAd);
    else buckets.other.push(synthAd);
  }

  emit({
    type: "log",
    message: `Buckets — ${buckets.winners.length} winners · ${buckets.experiments.length} experiments · ${buckets.abandoned.length} flopped · ${buckets.other.length} other. Calling the model…`,
  });

  // ── The one reasoning call (Sonnet) ──
  const ai = getAIClient();
  const out = await ai.generate({
    schema: CompetitorSynthesisSchema,
    staticPrompt: SYNTHESIZER_PROMPT_STATIC,
    prompt: buildSynthesizerPrompt({
      competitorName: opts.competitorName ?? "this competitor",
      buckets,
    }),
    model: "sonnet",
    maxTokens: 2048,
    toolName: "record_result",
    toolDescription: "Record the structured competitor synthesis.",
  });

  // ── Merge model reasoning + deterministic aggregates → one row ──
  await upsertCompetitorSynthesis({
    competitorId: opts.competitorId,
    dominantAngles,
    topHooks: out.top_hooks,
    alwaysOnWinners,
    recentPivots: out.recent_pivots,
    dominantConversionGoal,
    dominantCtas,
    dominantBrandVoice,
    activeExperiments: out.active_experiments,
    abandonedPatterns: out.abandoned_patterns,
    adsAnalyzedCount: rows.length,
    creativeLanguages,
    mediaMix,
    topPainPoints,
    topBenefits,
    launchVelocity,
  });

  const result: SynthesizeResult = {
    status: "success",
    competitorId: opts.competitorId,
    adsAnalyzedCount: rows.length,
  };
  emit({ type: "log", message: `Synthesis saved (${rows.length} ads).` });
  emit({ type: "done", result });
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Count non-null string values into a { value: count } map, sorted desc. */
function tally(values: Array<string | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) {
    if (!v) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  // Re-insert in descending order so the JSON reads winner-first.
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1])
  );
}

/** How many distinct values to keep for the pain-point / benefit roll-ups. */
const ROLLUP_TOP_N = 8;

/** Tally an array of short strings into [{ value, count }], desc, top-N. */
function tallyArray(values: string[]): Array<{ value: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, ROLLUP_TOP_N);
}

/** Count image / video / carousel ads. Unknown/null media types are excluded from
 * the three buckets but still counted in `total`, so the shares never overstate. */
function computeMediaMix(
  mediaTypes: Array<string | null>
): { image: number; video: number; carousel: number; total: number } {
  const mix = { image: 0, video: 0, carousel: 0, total: 0 };
  for (const t of mediaTypes) {
    mix.total++;
    if (t === "image") mix.image++;
    else if (t === "video") mix.video++;
    else if (t === "carousel") mix.carousel++;
  }
  return mix;
}

/**
 * New LIVE creatives that started running in the last 14 / 30 days.
 *
 * WHY daysActive, not firstSeenAt: `firstSeenAt` is when OUR tool first scraped the
 * ad, so on a brand's first scrape every ad looks "new" (all 30 ads → last14=30).
 * For a LIVE ad, `daysActive` = days since Meta's start_date → "daysActive <= N"
 * means it genuinely started running within N days. We gate on isActive because a
 * paused ad's daysActive is its total run length (could be a short ad from a year
 * ago), which says nothing about recent launch activity.
 */
function computeLaunchVelocity(
  ads: Array<{ daysActive: number; isActive: boolean }>
): { last14: number; last30: number } {
  let last14 = 0;
  let last30 = 0;
  for (const ad of ads) {
    if (!ad.isActive) continue; // only live ads carry a trustworthy launch-recency signal
    if (ad.daysActive <= 14) last14++;
    if (ad.daysActive <= 30) last30++;
  }
  return { last14, last30 };
}

function toSynthAd(row: AnalyzedRow, score: number): SynthInputAd {
  return {
    libraryId: row.libraryId,
    angle: row.angle ?? "educational",
    angleSecondary: row.angleSecondary,
    hook: row.hook ?? "",
    conversionGoal: row.conversionGoal,
    brandVoice: row.brandVoice,
    score,
    daysActive: row.daysActive,
    isActive: row.isActive,
    firstSeen: row.firstSeenAt,
    lastSeen: row.lastSeenAt,
  };
}

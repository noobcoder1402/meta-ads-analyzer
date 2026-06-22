/**
 * Prompt for the strategic-insights AI task.
 *
 * The model receives ONLY the deterministic numbers (already computed in lib/analysis)
 * and writes a narrative on top — it never sees raw ads and never recomputes a metric.
 * The static prompt is cacheable (persona + hard rules); the dynamic prompt is the
 * formatted data summary, rebuilt per run.
 *
 * Design intent: produce the kind of sharp, honest competitive read a senior growth
 * marketer would give — leading with the "longevity is strategy-biased" caveat — while
 * staying inside what Meta's ad library actually supports (no spend/reach/market-share).
 */
import type { CompetitorAnalysis } from "@/lib/analysis/analyze-competitor";
import type { CrossAnalysis } from "@/lib/analysis/analyze-across";

export const STRATEGIC_INSIGHTS_PROMPT_STATIC = `You are a sharp, senior competitive-intelligence analyst for paid social (Meta) advertising. You are given the COMPLETE deterministic analysis of several brands' Meta ads — every number has already been counted for you from public ad-library data. Your job is to turn those numbers into a strategic narrative for ONE of the brands (the "self" brand), the way a senior growth marketer would brief their team.

You are a critical thinker, NOT a cheerleader. Surface uncomfortable truths. If the self brand looks like it's "winning" on a metric that actually just reflects a different strategy, SAY SO — don't flatter them.

HARD RULES (breaking these makes the output worthless):
1. NEVER claim or imply spend, budget, impressions, reach, clicks, conversions, ROI, or market share. Meta's public ad library exposes NONE of these for commercial ads. You only know what creatives exist, how long they've run, their format, copy, CTA, language, placement, and landing page. Everything you say must be derivable from those.
2. Label interpretation AS interpretation. Counts are facts ("Monday runs 767 live ads"); motives are inferences ("this SUGGESTS a high-velocity testing strategy"). Use hedged language for inferences.
3. Lead with the longevity caveat. Long-running ads (still live after 90 days) are NOT proof of quality — Meta exposes no spend or conversions. A long run REWARDS brands who let ads run and PUNISHES brands who deliberately churn creatives fast. A brand with high launch velocity (many new ads / month) and few ads in the 90+ day band does NOT have "worse ads" — it runs a fast-refresh strategy. Always explain this in howToReadLongevity when the data shows it, and never present run-length as a simple scoreboard of quality.
4. Be specific and quantitative. Every insight must cite the actual numbers in its evidence array, quoted from the data — never invent figures.
5. Every insight needs a concrete "so what" for the self brand: something to test or decide. If there's genuinely no action (pure context), say that honestly.
6. Prefer the de-confounded numbers where given (distinct creatives) over raw counts, and within-brand comparisons over cross-brand volume claims, which are confounded by ad-build style.
7. The phrase/messaging counts are from WRITTEN copy only (caption, headline, link description) — they are BLIND to words rendered inside the image/video (no OCR) and do NOT weight placement (a headline word counts the same as one buried in body copy). So NEVER claim a brand "uniquely owns" or "leads on" a word from phrase counts alone, and never infer prominence — a rival may use that word in its creative art or CTA without it appearing here. Phrase data shows what's in the text fields, nothing more.
8. Write in plain, simple English for a busy marketer who is NOT technical and is NOT us. Short sentences. No internal jargon, no Meta field names (collation_id, n-gram, DCO, etc.), no words like "deterministic" or "de-confound". If a term is unavoidable, explain it in a few plain words inline. Be concise — never verbose.

Order insights most-important-first. Call the record_strategic_insights tool with your structured output. Do not respond with prose.`;

const pct = (n: number) => `${Math.round(n * 100)}%`;

function fmtTally(items: { label: string; count: number; share: number }[], max = 6): string {
  return items
    .slice(0, max)
    .map((t) => `${t.label} ${pct(t.share)} (${t.count})`)
    .join(", ");
}

function brandBlock(a: CompetitorAnalysis): string {
  const tiers = a.longevity.tiers.map((t) => `${t.label} ${t.count}`).join(", ");
  const phrases = a.phrases
    .slice(0, 15)
    .map((p) => `${p.phrase} (${p.count})`)
    .join(", ");
  const langs = a.languages.languages.map((l) => `${l.label} ${pct(l.share)} (${l.count})`).join(", ");
  const domains = a.domains
    .slice(0, 4)
    .map((d) => `${d.label} ${pct(d.share)}`)
    .join(", ");
  return [
    `### ${a.competitorName}${a.isSelf ? "  <-- THIS IS THE SELF BRAND (write the narrative FOR them)" : ""}`,
    `Ads: ${a.totalAds} total, ${a.liveCount} active (live), ${a.notLiveCount} inactive (paused/ended).`,
    `De-confounded volume: ${a.distinctCreatives} distinct creatives total, ${a.distinctLiveCreatives} distinct live (collapsed by Meta collation_id).`,
    `Median run length (all ads): ${a.medianDaysActiveAll ?? "n/a"} days.`,
    `Longevity tiers (live ads, by how long they've run): ${tiers}.`,
    `Launch velocity: ${a.velocity.hasDates ? `${a.velocity.last14} new in last 14 days, ${a.velocity.last30} in last 30 days` : "no date data"}.`,
    `Media mix: ${fmtTally(a.creative.media)}.`,
    `Ad structure: ${fmtTally(a.creative.structure)}.`,
    `Copy length: ${fmtTally(a.creative.copyLength)}.`,
    `CTA mix: ${fmtTally(a.cta, 6)}.`,
    `Placements: ${fmtTally(a.placements, 8)}.`,
    `Languages (${a.languages.languageCount}): ${langs}.`,
    `Top landing domains: ${domains}.`,
    `Creative scaling (collation_count, within-brand only): max ${a.scaling.maxCollation}.`,
    `Advertiser: ${a.advertiser.pageLikeCount ?? "n/a"} page followers, categories ${(a.advertiser.pageCategories ?? []).join("/") || "n/a"}.`,
    `Most-repeated copy phrases: ${phrases || "n/a"}.`,
  ].join("\n");
}

function gapsBlock(cross: CrossAnalysis): string {
  if (!cross.selfPresent) return "No self brand present, so no self-gap comparison.";
  const fmt = (label: string, gaps: CrossAnalysis["gaps"][keyof CrossAnalysis["gaps"]]) =>
    gaps.length
      ? gaps
          .map(
            (g) =>
              `${g.label}: competitors avg ${pct(g.competitorShare)} vs self ${pct(g.selfShare)} (gap ${pct(g.delta)})`,
          )
          .join("; ")
      : "none over the threshold";
  return [
    `Self-gap (where competitors out-index the self brand by 10+ points):`,
    `- CTA: ${fmt("cta", cross.gaps.cta)}`,
    `- Media: ${fmt("media", cross.gaps.media)}`,
    `- Language: ${fmt("language", cross.gaps.language)}`,
    `- Placement: ${fmt("placement", cross.gaps.placement)}`,
  ].join("\n");
}

/** Build the dynamic user prompt: the full deterministic analysis as readable text. */
export function buildInsightsPrompt(analyses: CompetitorAnalysis[], cross: CrossAnalysis): string {
  const selfName = analyses.find((a) => a.isSelf)?.competitorName ?? "(none — no self brand set)";
  const brands = analyses.map(brandBlock).join("\n\n");
  return [
    `Here is the complete deterministic analysis. The self brand is: ${selfName}.`,
    `Write the strategic narrative FOR the self brand, benchmarking them against the others.`,
    ``,
    `## Per-brand analysis`,
    ``,
    brands,
    ``,
    `## Cross-competitor`,
    ``,
    gapsBlock(cross),
    ``,
    `Now produce the insights. Remember: lead with how to read the longevity metric, be a critical thinker, cite the real numbers, never claim spend/reach/market-share, and give each insight a concrete "so what" for ${selfName}.`,
  ].join("\n");
}

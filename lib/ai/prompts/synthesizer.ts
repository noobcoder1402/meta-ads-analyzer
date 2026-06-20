/**
 * Competitor synthesizer prompt — text-only roll-up of one competitor's
 * analyzed ads into a pattern summary. See docs/ai-pipeline.md task #3.
 *
 * Split into two parts for prompt caching (same pattern as the creative analyzer):
 *
 *   SYNTHESIZER_PROMPT_STATIC  — the never-changing instruction block. Passed via
 *                                `staticPrompt` → cached `system` slot.
 *   buildSynthesizerPrompt()   — the variable block: this competitor's ads laid
 *                                out in four labeled buckets.
 *
 * The model produces ONLY the reasoning fields (top_hooks, recent_pivots,
 * active_experiments, abandoned_patterns). Frequency counts + always-on winners
 * are computed deterministically in synthesize-competitor.ts — don't ask the
 * model to count.
 */

/** One ad as the synthesizer sees it — compact, one line per ad to control tokens. */
export type SynthInputAd = {
  /** Internal ad id — the model echoes this only via the date fields, not directly. */
  libraryId: string;
  angle: string;
  angleSecondary: string | null;
  hook: string;
  conversionGoal: string | null;
  brandVoice: string | null;
  score: number;
  daysActive: number;
  isActive: boolean;
  firstSeen: string;
  lastSeen: string;
};

export type SynthBuckets = {
  winners: SynthInputAd[];
  experiments: SynthInputAd[];
  abandoned: SynthInputAd[];
  other: SynthInputAd[];
};

export const SYNTHESIZER_PROMPT_STATIC = `You are a competitive advertising strategist. You are given EVERY analyzed ad for ONE competitor, already classified (angle, hook, conversion goal, brand voice) and scored, and pre-sorted into four buckets. Your job is to roll these ads up into a strategic pattern summary.

The four buckets (computed from a performance score that infers success from longevity, variant testing, placement spread, and recency — Meta exposes no real spend data):

- PROVEN WINNERS — high score AND running 30+ days. The advertiser has clearly committed budget over time, so these almost certainly work.
- ACTIVE EXPERIMENTS — live but under 14 days old. Too young to call, but they reveal what the competitor is testing RIGHT NOW.
- ABANDONED — paused ads that either died young or stopped 30+ days ago. What they tried and walked away from. This is signal, not noise — failed experiments tell you what NOT to copy.
- OTHER — mid-lifecycle ads that are none of the above. Context only.

# What to produce (call the record_result tool — no prose outside it)

1. top_hooks — 3-8 of the strongest hooks across all buckets, weighted toward PROVEN WINNERS (a hook that's been running 90+ days is more proven than one running 5). Prefer verbatim hooks; lightly generalize only when several ads share one pattern.

2. recent_pivots — 1-3 sentences on any visible strategic shift. Look for: an angle or conversion goal that appears ONLY in recent/active ads but not older winners; a voice change; a move toward or away from offers. If messaging is consistent with no clear pivot, say so plainly — do not invent one.

3. active_experiments — cluster ONLY the ACTIVE EXPERIMENTS bucket into named patterns ({angle, hook_pattern, ad_count, first_seen}). This answers "what are they testing now?" If the bucket is empty, return an empty array.

4. abandoned_patterns — cluster ONLY the ABANDONED bucket into named patterns ({angle, hook_pattern, ad_count, last_seen, typical_days_active}). This answers "what did they drop?" If the bucket is empty, return an empty array.

# Rules

- Angle values in your output MUST be from the same fixed enum used in the input (problem-agitation, social-proof, founder-story, fomo-scarcity, comparison, ugc-style, product-demo, before-after, authority, curiosity-hook, offer-led, educational, aspirational, ai-powered).
- For first_seen / last_seen, copy the actual dates from the ads you're clustering — do not invent dates.
- ad_count must reflect the real number of ads you grouped into that cluster, and must not exceed the bucket's size.
- Do NOT output frequency counts of angles/goals/voices — those are computed separately. Focus on judgment: patterns, hooks, and shifts.
- Ground everything in the ads provided. Never reference ads or patterns that aren't in the data.`;

function renderAd(ad: SynthInputAd): string {
  const angle = ad.angleSecondary ? `${ad.angle}+${ad.angleSecondary}` : ad.angle;
  const status = ad.isActive ? "active" : "paused";
  return `- [${angle} | ${ad.conversionGoal ?? "?"} | ${ad.brandVoice ?? "?"}] score ${ad.score}, ${ad.daysActive}d, ${status}, first_seen ${ad.firstSeen}, last_seen ${ad.lastSeen} — "${ad.hook.replace(/\s+/g, " ").trim().slice(0, 160)}"`;
}

function renderBucket(label: string, ads: SynthInputAd[]): string {
  if (ads.length === 0) return `## ${label} (0 ads)\n(none)`;
  return `## ${label} (${ads.length} ads)\n${ads.map(renderAd).join("\n")}`;
}

export function buildSynthesizerPrompt(input: {
  competitorName: string;
  buckets: SynthBuckets;
}): string {
  const { competitorName, buckets } = input;
  const total =
    buckets.winners.length +
    buckets.experiments.length +
    buckets.abandoned.length +
    buckets.other.length;

  return `Competitor: ${competitorName}
Total analyzed ads: ${total}

${renderBucket("PROVEN WINNERS", buckets.winners)}

${renderBucket("ACTIVE EXPERIMENTS", buckets.experiments)}

${renderBucket("ABANDONED", buckets.abandoned)}

${renderBucket("OTHER", buckets.other)}

Roll these up via the record_result tool. Remember: cluster active_experiments ONLY from the ACTIVE EXPERIMENTS bucket and abandoned_patterns ONLY from the ABANDONED bucket.`;
}

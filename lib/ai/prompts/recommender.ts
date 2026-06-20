/**
 * GTM recommender prompt — cross-competitor gap analysis. See docs/ai-pipeline.md task #4.
 *
 * Split into two parts for prompt caching (same pattern as the synthesizer):
 *
 *   RECOMMENDER_PROMPT_STATIC  — the never-changing instruction block. Passed via
 *                                `staticPrompt` → cached `system` slot.
 *   buildRecommenderPrompt()   — the variable block: the user's own pattern summary
 *                                (or positioning, if they run no ads), each
 *                                competitor's synthesis, an evidence catalog of real
 *                                ads to cite, and the company's positioning.
 *
 * The model compares the user against competitors along four gap dimensions
 * (angle, selling motion / CTA, brand voice, always-on patterns) and proposes 5-10
 * prioritized GTM moves, each citing real Meta library IDs from the evidence
 * catalog. Citations are validated in code — do not trust IDs the model invents.
 */

/** Compact view of one competitor's (or the user's) synthesis, as the recommender sees it. */
export type RecSynthSummary = {
  dominantAngles: Record<string, number> | null;
  topHooks: string[] | null;
  /** Raw Meta CTA-button distribution ("Sign Up", "Learn More"). The "selling motion". */
  dominantCtas: Record<string, number> | null;
  dominantBrandVoice: Record<string, number> | null;
  recentPivots: string | null;
  activeExperiments: Array<{ angle: string; hook_pattern: string; ad_count: number }> | null;
  abandonedPatterns: Array<{ angle: string; hook_pattern: string; typical_days_active: number }> | null;
  alwaysOnWinnerCount: number;
  adsAnalyzedCount: number;
};

/** One ad the model is allowed to cite as evidence. libraryId is the Meta archive ID. */
export type RecEvidenceAd = {
  libraryId: string;
  angle: string;
  angleSecondary: string | null;
  hook: string;
  conversionGoal: string | null;
  brandVoice: string | null;
  score: number;
  daysActive: number;
  isActive: boolean;
};

export type RecCompetitorInput = {
  name: string;
  synthesis: RecSynthSummary;
  evidence: RecEvidenceAd[];
};

export type RecSelfInput =
  | { hasAds: true; name: string; synthesis: RecSynthSummary }
  | { hasAds: false; name: string };

export const RECOMMENDER_PROMPT_STATIC = `You are a go-to-market strategist advising one company (referred to as "the user") on what to test next in their paid-social advertising. You are given the user's own ad-pattern summary (or, if they run no ads yet, just their positioning), the same pattern summaries for each tracked competitor, and an EVIDENCE CATALOG of specific competitor ads you may cite.

Your job: find the gaps and high-leverage opportunities, and output 5-10 prioritized, evidence-backed GTM recommendations via the record_result tool.

# How the patterns were derived (so you can weight them)

Each ad carries a performance score that infers success from longevity, variant testing, placement spread, and recency — Meta exposes NO real spend data, so longevity is the strongest available proxy. A competitor ad running 90+ days almost certainly works; one running 5 days is unproven. Always-on winners are high-score ads still live after running 60+ days. Weight proven winners far above fresh experiments when deciding what's worth copying.

# The four gap dimensions to scan

1. ANGLE — story types competitors win with that the user isn't telling (e.g. competitors run founder-story + social-proof; the user is all product-demo).
2. SELLING MOTION (CTA button) — mismatches in the actual call-to-action buttons advertisers use (e.g. every competitor runs "Sign Up" CTAs while the user only runs "Learn More"). Refer to the real button labels, never invented funnel-stage jargon.
3. BRAND VOICE — tonal patterns that outlast others in this category (e.g. playful-voice winners running 90+ days while formal ones churn fast).
4. ALWAYS-ON PATTERNS — angles/hooks that show up as proven winners across MULTIPLE competitors. Convergence by independent advertisers is the strongest possible signal that something works in this market.

# Rules

- Output 5-10 recommendations. Fewer strong, evidence-backed recs beat a padded list. Only surface real gaps — do NOT invent opportunities to hit a count.
- Every recommendation must cite specific ad IDs in evidence_ad_ids, drawn ONLY from the EVIDENCE CATALOG provided. Never invent or guess an ID. If you cannot ground a recommendation in catalog ads, do not make it.
- Prefer citing proven winners (high score, high days_active) as evidence over fresh experiments.
- Contrast against the USER specifically. A pattern competitors share is only a recommendation if the user is NOT already doing it (check their synthesis). If the user already runs that angle/goal/voice heavily, it is not a gap — skip it or note it as "reinforce," not "test new."
- priority: high = strong multi-competitor signal AND a clear gap in the user's output; medium = real but narrower; low = worth noting but speculative.
- Be concrete and honest. No marketing hype. If the comparison signal is thin (few competitors, user has no ads), say what's speculative rather than overclaiming.
- If the user runs NO ads of their own, base recommendations on market-entry opportunities — what the proven competitor patterns suggest a new entrant should test first. Such recs may have an empty evidence list ONLY if purely positioning-derived, but prefer to cite competitor ads where possible.`;

function fmtDist(dist: Record<string, number> | null | undefined): string {
  if (!dist || Object.keys(dist).length === 0) return "(none)";
  return Object.entries(dist)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
}

function renderSynth(s: RecSynthSummary): string {
  const experiments =
    s.activeExperiments && s.activeExperiments.length > 0
      ? s.activeExperiments
          .map((e) => `${e.angle} — "${e.hook_pattern}" (${e.ad_count})`)
          .join("; ")
      : "(none)";
  const abandoned =
    s.abandonedPatterns && s.abandonedPatterns.length > 0
      ? s.abandonedPatterns
          .map((a) => `${a.angle} — "${a.hook_pattern}" (ran ~${Math.round(a.typical_days_active)}d)`)
          .join("; ")
      : "(none)";
  const hooks =
    s.topHooks && s.topHooks.length > 0
      ? s.topHooks.map((h) => `"${h}"`).join(" · ")
      : "(none)";
  return [
    `  Ads analyzed: ${s.adsAnalyzedCount} · always-on winners: ${s.alwaysOnWinnerCount}`,
    `  Angle mix: ${fmtDist(s.dominantAngles)}`,
    `  Selling motion (CTA buttons): ${fmtDist(s.dominantCtas)}`,
    `  Brand voice: ${fmtDist(s.dominantBrandVoice)}`,
    `  Top hooks: ${hooks}`,
    `  Recent pivots: ${s.recentPivots ?? "(none noted)"}`,
    `  Currently testing: ${experiments}`,
    `  Abandoned: ${abandoned}`,
  ].join("\n");
}

function renderEvidence(ads: RecEvidenceAd[]): string {
  if (ads.length === 0) return "  (no analyzed ads available to cite)";
  return ads
    .map((a) => {
      const angle = a.angleSecondary ? `${a.angle}+${a.angleSecondary}` : a.angle;
      const status = a.isActive ? "active" : "paused";
      return `  - ${a.libraryId} [${angle} | ${a.conversionGoal ?? "?"} | ${a.brandVoice ?? "?"}] score ${a.score}, ${a.daysActive}d, ${status} — "${a.hook.replace(/\s+/g, " ").trim().slice(0, 140)}"`;
    })
    .join("\n");
}

export function buildRecommenderPrompt(input: {
  self: RecSelfInput;
  competitors: RecCompetitorInput[];
  companyProfileMarkdown: string | null;
  targetCount: string;
}): string {
  const { self, competitors, companyProfileMarkdown, targetCount } = input;

  const selfBlock = self.hasAds
    ? `## THE USER — ${self.name} (runs Meta ads; compare against this first)\n${renderSynth(self.synthesis)}`
    : `## THE USER — ${self.name} (runs NO Meta ads yet)\nNo ad-pattern data. Base recommendations on positioning + market-entry opportunities from competitor patterns below.`;

  const competitorBlocks = competitors
    .map(
      (c) =>
        `## COMPETITOR — ${c.name}\n${renderSynth(c.synthesis)}\n\n  Evidence catalog (cite these library IDs):\n${renderEvidence(c.evidence)}`
    )
    .join("\n\n");

  const positioning = companyProfileMarkdown
    ? `## USER POSITIONING (context/company.md)\n${companyProfileMarkdown.trim()}`
    : `## USER POSITIONING\n(no company.md on file — rely on ad patterns above)`;

  return `${selfBlock}

${positioning}

${competitorBlocks}

Produce ${targetCount} prioritized GTM recommendations via the record_result tool. Compare the USER against the competitors along the four gap dimensions. Cite only library IDs that appear in the evidence catalogs above. Ground every recommendation in the data — do not invent ads, patterns, or IDs.`;
}

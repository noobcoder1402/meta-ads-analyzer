/**
 * GTM recommender — cross-competitor gap analysis. See docs/ai-pipeline.md task #4.
 *
 * Compares the user's own ad-pattern synthesis (the `self` competitor) against every
 * tracked competitor's synthesis, plus the user's positioning (context/company.md),
 * and produces 5-10 prioritized, evidence-backed GTM recommendations in ONE Sonnet call.
 *
 * Grounding: the model is handed an EVIDENCE CATALOG of each competitor's real ads
 * (Meta library IDs) and may only cite those. We validate the returned IDs against
 * the catalog and drop any the model invents — recommendations stay grounded in
 * observable ads, never pure assertion.
 *
 * Cost guardrail: USER-TRIGGERED ONLY. Never auto-runs on scrape or schedule.
 * One Sonnet call, ~$0.06. Highest-leverage output in the product — we pay for quality.
 *
 * Re-run behavior: replace-on-run. Each generation fully replaces the previous set
 * (replaceRecommendations) — recommendations carry no user state to preserve.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  getActiveCompetitors,
  getSynthesisForCompetitor,
  getAnalyzedAdsForCompetitor,
  replaceRecommendations,
  type GeneratedRecommendation,
} from "@/lib/db/queries";
import { getAIClient } from "@/lib/ai/client";
import { RecommendationsSchema } from "@/lib/ai/schemas";
import {
  RECOMMENDER_PROMPT_STATIC,
  buildRecommenderPrompt,
  type RecSelfInput,
  type RecCompetitorInput,
  type RecSynthSummary,
  type RecEvidenceAd,
} from "@/lib/ai/prompts/recommender";

const COMPANY_MD_PATH = path.join(process.cwd(), "context", "company.md");

/** How many top-scored ads per competitor we hand the model to cite. Caps prompt tokens. */
const EVIDENCE_PER_COMPETITOR = 12;

export type RecommendEvent =
  | { type: "log"; message: string }
  | { type: "done"; result: RecommendResult }
  | { type: "error"; message: string };

export type RecommendResult = {
  status: "success" | "skipped";
  recommendationsCount: number;
  competitorsCompared: number;
  userHasAds: boolean;
  /** "skipped" reason when status is "skipped". */
  reason?: string;
};

export type RecommendOptions = {
  /** Phrase handed to the model, e.g. "5-10". Defaults to spec default. */
  targetCount?: string;
  onEvent?: (event: RecommendEvent) => void;
};

type SynthRow = NonNullable<Awaited<ReturnType<typeof getSynthesisForCompetitor>>>;

export async function generateRecommendations(
  opts: RecommendOptions = {}
): Promise<RecommendResult> {
  const targetCount = opts.targetCount ?? "5-10";
  const emit = (e: RecommendEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // never let a bad listener break the run
    }
  };

  const skip = (reason: string): RecommendResult => {
    const result: RecommendResult = {
      status: "skipped",
      recommendationsCount: 0,
      competitorsCompared: 0,
      userHasAds: false,
      reason,
    };
    emit({ type: "log", message: reason });
    emit({ type: "done", result });
    return result;
  };

  const active = await getActiveCompetitors();
  const selfRow = active.find((c) => c.status === "self") ?? null;
  const competitorRows = active.filter((c) => c.status !== "self");

  // ── Build each competitor's synthesis summary + evidence catalog ──
  const competitors: RecCompetitorInput[] = [];
  const validEvidenceIds = new Set<string>();

  for (const c of competitorRows) {
    const synth = await getSynthesisForCompetitor(c.id);
    if (!synth) continue; // no synthesis yet → nothing to compare for this one

    const analyzed = await getAnalyzedAdsForCompetitor(c.id);
    const evidence = analyzed.slice(0, EVIDENCE_PER_COMPETITOR).map(toEvidenceAd);
    for (const e of evidence) validEvidenceIds.add(e.libraryId);

    competitors.push({
      name: c.name,
      synthesis: toSynthSummary(synth),
      evidence,
    });
  }

  if (competitors.length === 0) {
    return skip(
      "No competitor syntheses to compare against — run Synthesize on at least one competitor first."
    );
  }

  // ── The user's own side: real ads if synthesized, else positioning only ──
  const companyProfileMarkdown = await readCompanyMd();
  let self: RecSelfInput;
  let userHasAds = false;

  if (selfRow) {
    const selfSynth = await getSynthesisForCompetitor(selfRow.id);
    if (selfSynth && (selfSynth.adsAnalyzedCount ?? 0) > 0) {
      userHasAds = true;
      self = { hasAds: true, name: selfRow.name, synthesis: toSynthSummary(selfSynth) };
    } else {
      self = { hasAds: false, name: selfRow.name };
    }
  } else if (companyProfileMarkdown) {
    self = { hasAds: false, name: "Your company" };
  } else {
    return skip(
      "No `self` company and no context/company.md — complete onboarding before generating recommendations."
    );
  }

  if (!userHasAds && !companyProfileMarkdown) {
    emit({
      type: "log",
      message:
        "Warning: the user has neither analyzed ads nor a company profile. Recommendations will be generic market-pattern output.",
    });
  }

  emit({
    type: "log",
    message: `Comparing ${self.hasAds ? "your ads" : "your positioning"} against ${competitors.length} competitor synthes${competitors.length === 1 ? "is" : "es"} (${validEvidenceIds.size} ads citable)… calling the model.`,
  });

  // ── The one reasoning call (Sonnet — highest-leverage output) ──
  const ai = getAIClient();
  const out = await ai.generate({
    schema: RecommendationsSchema,
    staticPrompt: RECOMMENDER_PROMPT_STATIC,
    prompt: buildRecommenderPrompt({
      self,
      competitors,
      companyProfileMarkdown,
      targetCount,
    }),
    model: "sonnet",
    maxTokens: 4096,
    toolName: "record_result",
    toolDescription: "Record the structured GTM recommendations.",
  });

  // ── Validate cited evidence IDs against the catalog (drop hallucinations) ──
  let droppedIds = 0;
  const generated: GeneratedRecommendation[] = out.recommendations.map((r) => {
    const valid = r.evidence_ad_ids.filter((id) => validEvidenceIds.has(id));
    droppedIds += r.evidence_ad_ids.length - valid.length;
    return {
      title: r.title,
      priority: r.priority,
      rationale: r.rationale,
      evidenceAdIds: valid,
    };
  });

  if (droppedIds > 0) {
    emit({
      type: "log",
      message: `Dropped ${droppedIds} cited ad ID${droppedIds === 1 ? "" : "s"} not found in the evidence catalog (model invented them).`,
    });
  }

  // ── Replace-on-run: this fresh set fully replaces the previous one ──
  const writeResult = await replaceRecommendations(generated);

  const result: RecommendResult = {
    status: "success",
    recommendationsCount: writeResult.total,
    competitorsCompared: competitors.length,
    userHasAds,
  };
  emit({
    type: "log",
    message: `Saved ${writeResult.total} recommendations (replaced the previous set).`,
  });
  emit({ type: "done", result });
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function readCompanyMd(): Promise<string | null> {
  try {
    return await fs.readFile(COMPANY_MD_PATH, "utf8");
  } catch {
    return null;
  }
}

function toSynthSummary(s: SynthRow): RecSynthSummary {
  return {
    dominantAngles: s.dominantAngles,
    topHooks: s.topHooks,
    dominantCtas: s.dominantCtas,
    dominantBrandVoice: s.dominantBrandVoice,
    recentPivots: s.recentPivots,
    activeExperiments: s.activeExperiments,
    abandonedPatterns: s.abandonedPatterns,
    alwaysOnWinnerCount: s.alwaysOnWinners?.length ?? 0,
    adsAnalyzedCount: s.adsAnalyzedCount ?? 0,
  };
}

function toEvidenceAd(
  row: Awaited<ReturnType<typeof getAnalyzedAdsForCompetitor>>[number]
): RecEvidenceAd {
  return {
    libraryId: row.libraryId,
    angle: row.angle ?? "educational",
    angleSecondary: row.angleSecondary,
    hook: row.hook ?? "",
    conversionGoal: row.conversionGoal,
    brandVoice: row.brandVoice,
    score: Math.round(row.score ?? 0),
    daysActive: row.daysActive,
    isActive: row.isActive,
  };
}

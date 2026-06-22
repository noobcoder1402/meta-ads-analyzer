/**
 * Strategic-insights analyzer — the ONLY AI task that interprets the analysis.
 *
 * Flow: load the deterministic cross-analysis (the same bundle the Insights page
 * renders) → format it as text → ask a high-quality model to write a narrative →
 * validate against the Zod schema → cache the result in ai_insight_reports.
 *
 * It never sees raw ads and never recomputes a number — it only narrates the
 * already-counted deterministic metrics. Cost guardrail: this runs ONLY when the
 * user clicks "Generate" (API route) or runs the CLI — never on page load/scrape.
 */
import { createHash } from "node:crypto";
import { getAIClient } from "@/lib/ai/client";
import { StrategicInsightsSchema, type StrategicInsights } from "@/lib/ai/schemas";
import {
  STRATEGIC_INSIGHTS_PROMPT_STATIC,
  buildInsightsPrompt,
} from "@/lib/ai/prompts/strategic-insights";
import { loadCrossAnalysis, type CrossAnalysisBundle } from "@/lib/analysis/load";
import { saveInsightReport } from "@/lib/db/queries";
import type { AiInsightReport } from "@/lib/db/schema";

type InsightsModel = "haiku" | "sonnet" | "opus";

/** Which model writes the narrative. Defaults to the high-quality tier; overridable via
 * env so a wrong/retired model id can be swapped to `sonnet`/`haiku` without code change. */
function insightsModel(): InsightsModel {
  const m = process.env.INSIGHTS_MODEL?.trim();
  if (m === "haiku" || m === "sonnet" || m === "opus") return m;
  return "opus";
}

/**
 * A stable fingerprint of the numbers a report was built from. If the live data no
 * longer matches a saved report's fingerprint, the UI shows a "regenerate" nudge.
 * Built from each brand's id + total/live ad counts + latest scrape time — the things
 * that change when you re-scrape. Pure + deterministic (sorted, hashed).
 */
export function fingerprintBundle(bundle: CrossAnalysisBundle): string {
  const parts = bundle.brands
    .map((b) => `${b.id}:${b.ads.length}:${b.latestScrapeAt ?? "never"}`)
    .sort();
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

export type GenerateInsightsResult = {
  report: StrategicInsights;
  saved: AiInsightReport;
  model: string;
  brandCount: number;
  adCount: number;
};

/**
 * Generate a fresh strategic-insights narrative and cache it. Throws if there are no
 * scraped ads to analyze (the caller should surface that as a friendly message).
 */
export async function generateAndSaveInsights(): Promise<GenerateInsightsResult> {
  const bundle = await loadCrossAnalysis();
  if (!bundle.hasAnyAds) {
    throw new Error("No scraped ads to analyze yet. Scrape at least one brand first.");
  }

  const model = insightsModel();
  const ai = getAIClient();
  const report = await ai.generate({
    schema: StrategicInsightsSchema,
    staticPrompt: STRATEGIC_INSIGHTS_PROMPT_STATIC,
    prompt: buildInsightsPrompt(bundle.analyses, bundle.cross),
    model,
    maxTokens: 8192,
    toolName: "record_strategic_insights",
    toolDescription: "Record the structured strategic insights narrative.",
  });

  const brandCount = bundle.analyses.filter((a) => a.totalAds > 0).length;
  const adCount = bundle.brands.reduce((sum, b) => sum + b.ads.length, 0);

  const saved = await saveInsightReport({
    reportJson: JSON.stringify(report),
    dataFingerprint: fingerprintBundle(bundle),
    model,
    brandCount,
    adCount,
  });

  return { report, saved, model, brandCount, adCount };
}

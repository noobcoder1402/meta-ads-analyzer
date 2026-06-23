import { z } from "zod";

export const CompanyProfileSchema = z.object({
  company_name: z
    .string()
    .min(1)
    .describe("The official name of the company as it appears on their site."),
  what_we_do: z
    .string()
    .min(20)
    .describe(
      "1-3 sentences describing what the company does and what product/service it sells. Plain English, no marketing fluff."
    ),
  who_we_serve: z
    .string()
    .min(20)
    .describe(
      "1-3 sentences describing the target customer (industry, role, company size if specified)."
    ),
  how_were_different: z
    .string()
    .min(20)
    .describe(
      "1-3 sentences describing the company's positioning, differentiators, or what makes them different from competitors. If unclear from the site, state that honestly."
    ),
});

export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const CompetitorSuggestionSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("The competitor's company name as it would appear on their website or Meta Ad Library page."),
  why: z
    .string()
    .min(20)
    .describe(
      "1-2 sentences explaining why this is a competitor to the user's company. Be specific about overlap in product, audience, or positioning."
    ),
  likely_meta_page_url: z
    .string()
    .optional()
    .describe(
      "Best guess at the competitor's Meta Ad Library page URL in the form https://www.facebook.com/ads/library/?view_all_page_id=… or a Meta Ad Library search URL by company name. Omit if uncertain."
    ),
});

export const CompetitorSuggestionsSchema = z.object({
  suggestions: z
    .array(CompetitorSuggestionSchema)
    .min(1)
    .max(20)
    .describe("List of competitor suggestions, ordered most-relevant-first."),
});

export type CompetitorSuggestion = z.infer<typeof CompetitorSuggestionSchema>;
export type CompetitorSuggestions = z.infer<typeof CompetitorSuggestionsSchema>;

// ─── Strategic insights (AI narrative over the deterministic numbers) ──
// The ONLY AI task that interprets the analysis (vs onboarding, which sets it up).
// It reads the already-computed deterministic metrics and writes a narrative — it
// never sees raw ads and never recomputes a number. Structured-output only.
// Hard rules live in the prompt: never claim spend/reach/market-share (Meta doesn't
// expose them), and label interpretation vs fact.
export const InsightCategoryEnum = z.enum([
  "longevity", // how to read the run-length metric (strategy bias)
  "cta",
  "creative", // ad structure / DCO / production model
  "media", // image vs video
  "copy",
  "localization", // languages / geo expansion
  "messaging", // positioning / phrases
  "placement",
  "velocity", // launch cadence / volume
  "other",
]);

export const StrategicInsightSchema = z.object({
  title: z.string().min(8).describe("A short, specific headline for this insight (under ~12 words)."),
  category: InsightCategoryEnum.describe("Which dimension of the analysis this insight is about."),
  narrative: z
    .string()
    .min(80)
    .describe(
      "2-5 sentences explaining the insight in plain business English — what the data shows and what it means. State interpretation AS interpretation (e.g. 'this suggests', not 'this proves'). Never claim spend, reach, impressions, budget, or market share."
    ),
  evidence: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe(
      "The specific numbers this insight rests on, each as a short factual string, e.g. 'Monday: 341 new ads in 30 days, 0 ads in the 60-90 day band'. Quote the deterministic metrics verbatim — do not invent figures."
    ),
  recommendation: z
    .string()
    .min(20)
    .describe(
      "One concrete, actionable 'so what' for the user (the self brand) — what to test or do next. If the insight is purely contextual with no action, say so honestly."
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "How strongly the data supports this. high = directly counted with a large sample; medium = a reasonable inference; low = a thin-sample or speculative read."
    ),
});

export const StrategicInsightsSchema = z.object({
  headline: z
    .string()
    .min(20)
    .describe("One-sentence top-line takeaway across all brands — the single most important thing the user should know."),
  howToReadLongevity: z
    .string()
    .min(40)
    .describe(
      "A short caveat on how to read the ad longevity / run-length metric (how long ads stay live), especially that a long run is NOT proof of quality and is biased against high-velocity brands that deliberately churn creatives fast. Always include this when any brand shows high launch velocity with few long-lived ads."
    ),
  insights: z
    .array(StrategicInsightSchema)
    .min(3)
    .max(10)
    .describe("The strategic insights, ordered most-important-first."),
  caveats: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe(
      "Honest limitations of this analysis (e.g. 'this is creative strategy, not spend — Meta exposes no budget data'; 'only N competitors are scraped')."
    ),
});

export type InsightCategory = z.infer<typeof InsightCategoryEnum>;
export type StrategicInsight = z.infer<typeof StrategicInsightSchema>;
export type StrategicInsights = z.infer<typeof StrategicInsightsSchema>;

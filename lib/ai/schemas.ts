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

// ─── Creative analyzer ──────────────────────────────────────────────
// Fixed enums — these MUST stay aligned with:
//   1. DB column enum on ad_analyses (lib/db/schema.ts)
//   2. The prompt's taxonomy block (lib/ai/prompts/creative-analyzer.ts)
//   3. The synthesizer's bucket logic (future)
// See docs/ai-pipeline.md "Angle taxonomy" + "Conversion goal taxonomy" + "Brand voice taxonomy"
// for the rationale on why these are fixed enums.

export const AngleEnum = z.enum([
  "problem-agitation",
  "social-proof",
  "founder-story",
  "fomo-scarcity",
  "comparison",
  "ugc-style",
  "product-demo",
  "before-after",
  "authority",
  "curiosity-hook",
  "offer-led",
  "educational",
  "aspirational",
  "ai-powered",
]);

// NOTE: this value is NOT produced by the model. It is derived deterministically
// from the ad's Meta CTA via lib/ads/cta-to-goal.ts. The enum still defines the
// allowed values (used as the column type + the mapper's return type).
export const ConversionGoalEnum = z.enum([
  "free-trial",
  "demo-request",
  "direct-purchase",
  "waitlist",
  "app-install",
  "lead-capture",
  "content-download",
  "awareness",
  "other",
]);

export const BrandVoiceEnum = z.enum([
  "formal",
  "professional",
  "playful",
  "technical",
  "bold",
  "warm",
]);

export const TextDensityEnum = z.enum(["low", "med", "high"]);
export const SubjectEnum = z.enum([
  "face",
  "product",
  "lifestyle",
  "text-only",
  "mixed",
]);

export const CreativeAnalysisSchema = z.object({
  hook: z
    .string()
    .min(1)
    .describe(
      "The headline-style opening line of the ad — the first thing that catches attention. Use the most prominent on-image text if present, otherwise the first sentence of the caption. Keep verbatim, do not paraphrase."
    ),
  angle: AngleEnum.describe(
    "The PRIMARY story angle. Must be one of the fixed enum values. See the taxonomy block in the system prompt for definitions."
  ),
  angle_secondary: AngleEnum.optional().describe(
    "An optional SECONDARY angle if the ad genuinely uses two distinct ones (e.g., founder-story + product-demo). Omit if the ad fits one cleanly."
  ),
  visual_summary: z
    .string()
    .min(10)
    .describe(
      "1-2 sentences describing what is actually visible in the image. Concrete, not interpretive. E.g., 'Split-screen: chaotic desk on left, clean dashboard on right. Brand logo bottom-right.'"
    ),
  dominant_colors: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .min(1)
    .max(5)
    .describe(
      "1-5 hex color codes representing the dominant colors of the image, ordered most-prominent-first. Lowercase hex with # prefix."
    ),
  text_density: TextDensityEnum.describe(
    "How much text is overlaid on the image itself (NOT counting the caption). low = <5 words, med = a phrase or sentence, high = paragraph or multiple lines."
  ),
  subject: SubjectEnum.describe(
    "What the image is primarily showing. face = person's face is the focal point; product = product/UI is focal; lifestyle = a scene/situation; text-only = mostly typography; mixed = no single dominant subject."
  ),
  themes: z
    .array(z.string().min(2))
    .min(1)
    .max(5)
    .describe(
      "1-5 short noun-phrase themes captured by the ad. Lowercase, 1-3 words each. E.g., ['tool fatigue', 'consolidation', 'ROI']."
    ),
  pain_points: z
    .array(z.string().min(2))
    .max(5)
    .describe(
      "0-5 specific pain points the ad calls out or implies. Lowercase, 1-3 words each. Empty array if none are present."
    ),
  benefits: z
    .array(z.string().min(2))
    .max(5)
    .describe(
      "0-5 specific benefits the ad promises. Lowercase, 1-3 words each. Empty array if none are present."
    ),
  target_persona: z
    .string()
    .min(5)
    .describe(
      "1 sentence describing who this ad is targeted at — role + company-size or life-stage if inferable. E.g., 'Operations leads at 50-500 person SaaS companies.'"
    ),
  emotional_tone: z
    .string()
    .min(3)
    .describe(
      "A short phrase capturing the emotional arc of the ad. E.g., 'frustrated-then-relieved', 'urgent', 'confident', 'aspirational-warm'."
    ),
  // primary_conversion_goal is intentionally NOT a model output. It is derived
  // deterministically from the Meta CTA (lib/ads/cta-to-goal.ts) at write time.
  brand_voice: BrandVoiceEnum.describe(
    "The tonal register of caption + visuals combined. Must be one of the fixed enum values. See taxonomy in the system prompt."
  ),
});

export type CreativeAnalysis = z.infer<typeof CreativeAnalysisSchema>;
export type Angle = z.infer<typeof AngleEnum>;
export type ConversionGoal = z.infer<typeof ConversionGoalEnum>;
export type BrandVoice = z.infer<typeof BrandVoiceEnum>;

// ─── Competitor synthesizer ─────────────────────────────────────────
// The synthesizer rolls up ALL of one competitor's analyzed ads into a
// pattern summary. See docs/ai-pipeline.md task #3.
//
// IMPORTANT — this schema covers only the REASONING fields the model produces.
// The frequency counts (dominant_angles, dominant_conversion_goal,
// dominant_brand_voice) and the always_on_winners list are computed
// DETERMINISTICALLY in code (synthesize-competitor.ts) from the analyzed-ad
// columns — counting enum values is exactly what an LLM gets subtly wrong, and
// we already have the data in clean columns. The model only does the work that
// needs judgment: spotting hook patterns, naming experiment/abandoned clusters,
// and describing strategic pivots.

const SynthesisExperimentSchema = z.object({
  angle: AngleEnum.describe(
    "The dominant angle of this active-experiment cluster (one of the fixed enum values)."
  ),
  hook_pattern: z
    .string()
    .min(3)
    .describe(
      "A short phrase naming the recurring hook/message pattern across these live ads. E.g. 'AI-assisted project setup'."
    ),
  ad_count: z
    .number()
    .int()
    .min(1)
    .describe("How many ads in the Active-experiments bucket fit this pattern."),
  first_seen: z
    .string()
    .describe(
      "The earliest first-seen date among the ads in this cluster, copied from the data provided. ISO-ish date string."
    ),
});

const SynthesisAbandonedSchema = z.object({
  angle: AngleEnum.describe(
    "The dominant angle of this abandoned/churned cluster (one of the fixed enum values)."
  ),
  hook_pattern: z
    .string()
    .min(3)
    .describe("A short phrase naming the recurring hook/message pattern they tried and dropped."),
  ad_count: z
    .number()
    .int()
    .min(1)
    .describe("How many ads in the Abandoned bucket fit this pattern."),
  last_seen: z
    .string()
    .describe(
      "The latest last-seen date among the ads in this cluster, copied from the data provided. ISO-ish date string."
    ),
  typical_days_active: z
    .number()
    .min(0)
    .describe(
      "The typical (median/average) days_active across the ads in this cluster — how long these ran before being dropped."
    ),
});

export const CompetitorSynthesisSchema = z.object({
  top_hooks: z
    .array(z.string().min(3))
    .min(1)
    .max(8)
    .describe(
      "3-8 of the strongest/most-representative hooks across this competitor's ads, weighted toward proven winners. Prefer verbatim hooks; you may lightly generalize if several ads share one pattern."
    ),
  recent_pivots: z
    .string()
    .describe(
      "1-3 sentences of prose describing any recent strategic shift visible in the data — e.g. a new angle appearing only in the last few weeks, or a move from demo-request to free-trial CTAs. If there's no clear pivot, say so plainly (e.g. 'No clear recent pivot — messaging is consistent.')."
    ),
  active_experiments: z
    .array(SynthesisExperimentSchema)
    .max(10)
    .describe(
      "Patterns drawn ONLY from the Active-experiments bucket (live, recently launched ads). What is this competitor testing right now? Empty array if that bucket is empty."
    ),
  abandoned_patterns: z
    .array(SynthesisAbandonedSchema)
    .max(10)
    .describe(
      "Patterns drawn ONLY from the Abandoned bucket (paused ads that ran briefly or stopped long ago). What did they try and walk away from? Empty array if that bucket is empty."
    ),
});

export type CompetitorSynthesisOutput = z.infer<typeof CompetitorSynthesisSchema>;

// ─── GTM recommendations engine ─────────────────────────────────────
// Cross-competitor gap analysis. The model compares the user's own ad
// patterns (or positioning, if they run no ads) against competitor patterns
// and proposes prioritized GTM moves. See docs/ai-pipeline.md task #4.
//
// Each recommendation MUST cite the specific competitor ad IDs (Meta library
// IDs) that justify it — those come from the evidence catalog handed to the
// model in the prompt. Citations are validated against that catalog in code
// (generate-recommendations.ts); IDs the model invents are dropped, not trusted.

export const RecommendationPriorityEnum = z.enum(["high", "medium", "low"]);

export const RecommendationItemSchema = z.object({
  title: z
    .string()
    .min(5)
    .max(120)
    .describe(
      "A short imperative GTM action, e.g. 'Test founder-story video angle' or 'Add free-trial CTA variants'. No trailing period."
    ),
  priority: RecommendationPriorityEnum.describe(
    "high = strong cross-competitor signal AND a clear gap in the user's own output; medium = real but narrower opportunity; low = worth noting but speculative or low-leverage."
  ),
  rationale: z
    .string()
    .min(40)
    .describe(
      "2-4 sentences. State the competitor pattern (with longevity/score evidence), contrast it against what the user is or isn't doing, and why it's worth acting on. Reference the cited ads concretely. No hype — ground every claim in the data provided."
    ),
  evidence_ad_ids: z
    .array(z.string().min(1))
    .describe(
      "Meta library IDs of the competitor ads that justify this recommendation. Pick ONLY from the evidence catalog provided in the prompt — never invent IDs. Cite at least one unless this is a pure market-entry rec for a user with no ads of their own."
    ),
});

export const RecommendationsSchema = z.object({
  recommendations: z
    .array(RecommendationItemSchema)
    .min(3)
    .max(10)
    .describe(
      "5-10 prioritized GTM recommendations, ordered most-important-first. Only surface real, evidence-backed gaps — fewer strong recs beat padding the list with weak ones."
    ),
});

export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;
export type RecommendationsOutput = z.infer<typeof RecommendationsSchema>;

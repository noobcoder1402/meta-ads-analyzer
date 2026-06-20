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

// ─── Conversion goal enum ───────────────────────────────────────────
// NOTE: this value is NOT produced by any model. It is derived deterministically
// from the ad's Meta CTA via lib/ads/cta-to-goal.ts. The enum defines the allowed
// values (used as the ad_analyses column type + the mapper's return type). The old
// AI creative-analysis / synthesis / recommendation schemas were removed when the
// AI ad-analysis layer was retired.
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

export type ConversionGoal = z.infer<typeof ConversionGoalEnum>;

/**
 * cta-to-goal — deterministic map from Meta's CTA button to a conversion goal.
 *
 * WHY THIS EXISTS (read before changing): the conversion goal used to be inferred
 * by the vision model from caption + CTA. That produced noise — e.g. ClickUp uses
 * the generic "Learn More" button on ~every ad, and the model scattered those
 * identical ads across lead-capture / demo-request / free-trial / other based on
 * caption vibes alone. The button the advertiser actually chose is the ground
 * truth for intent, so we now derive the goal from `cta_label` deterministically:
 * zero AI cost, fully reproducible, no hallucinated distinctions.
 *
 * Pure + browser-safe (no DB, no AI). Unit-tested in cta-to-goal.test.ts.
 *
 * Keyed on the prettified `cta_label` (Title Case, e.g. "Learn More"), lowercased
 * for matching. Anything unknown or absent → "awareness" is NOT assumed — we fall
 * to "other" so an unmapped CTA never silently masquerades as a real funnel stage.
 * When a new CTA shows up in the data, add it here (this is the single source of
 * truth) rather than guessing downstream.
 */
import type { ConversionGoal } from "@/lib/ai/schemas";

const CTA_TO_GOAL: Record<string, ConversionGoal> = {
  // ── Present in the current dataset (the approved mapping) ──
  "sign up": "free-trial", // ~95% free-trial in practice for the PLG SaaS set
  "learn more": "awareness", // generic brand/site-visit button, no conversion ask
  "view instagram profile": "awareness",
  "get offer view": "direct-purchase",
  "book travel": "other", // travel-industry stray, not a funnel goal here

  // ── Future-proofing for common Meta CTAs not yet seen in the data ──
  // (Best-effort, unambiguous only; conservative — unknowns still fall to "other".)
  "get started": "free-trial",
  "watch more": "awareness",
  "see more": "awareness",
  "shop now": "direct-purchase",
  "buy now": "direct-purchase",
  "order now": "direct-purchase",
  "get offer": "direct-purchase",
  "book now": "demo-request",
  "get quote": "demo-request",
  "contact us": "demo-request",
  subscribe: "lead-capture",
  "install now": "app-install",
  "use app": "app-install",
  "get app": "app-install",
  download: "content-download",
};

/** Map a Meta CTA label to its conversion goal. Unknown / null → "other". */
export function ctaToConversionGoal(
  ctaLabel: string | null | undefined
): ConversionGoal {
  if (!ctaLabel) return "other";
  return CTA_TO_GOAL[ctaLabel.trim().toLowerCase()] ?? "other";
}

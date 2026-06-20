/**
 * angle-info — plain-English labels + one-line explanations for each ad angle.
 *
 * The angle enum values (e.g. "problem-agitation", "ugc-style") are terse machine
 * keys; showing them raw in the UI reads as jargon. This is the single shared map
 * the UI imports so a label/explanation is defined ONCE and stays consistent across
 * the summary panel, ad dialog, and anywhere else angles surface.
 *
 * The blurbs are condensed from the analyzer prompt's angle taxonomy
 * (lib/ai/prompts/creative-analyzer.ts). Keep them in sync if the taxonomy changes.
 *
 * Pure + browser-safe.
 */
export type AngleInfo = { label: string; blurb: string };

export const ANGLE_INFO: Record<string, AngleInfo> = {
  "problem-agitation": {
    label: "Problem-agitation",
    blurb: "Names a specific pain and twists the knife.",
  },
  "social-proof": {
    label: "Social proof",
    blurb: "Customers, logos, reviews, user counts.",
  },
  "founder-story": {
    label: "Founder story",
    blurb: "Founder on camera or in voice — origin story, personal POV.",
  },
  "fomo-scarcity": {
    label: "FOMO / scarcity",
    blurb: "Limited time, deadline, “only X left,” ending soon.",
  },
  comparison: {
    label: "Comparison",
    blurb: "“Switch from X to us” — side-by-side, head-to-head.",
  },
  "ugc-style": {
    label: "UGC-style",
    blurb: "Looks user-made: phone-camera framing, talking head, casual.",
  },
  "product-demo": {
    label: "Product demo",
    blurb: "Shows the actual UI in action — “here’s how it works.”",
  },
  "before-after": {
    label: "Before / after",
    blurb: "Transformation: messy → clean, problem → solution.",
  },
  authority: {
    label: "Authority",
    blurb: "Credentials, awards, press, expert endorsements.",
  },
  "curiosity-hook": {
    label: "Curiosity hook",
    blurb: "An open loop — intriguing question or surprising stat.",
  },
  "offer-led": {
    label: "Offer-led",
    blurb: "The deal IS the ad — discount, free-trial length, “$0 today.”",
  },
  educational: {
    label: "Educational",
    blurb: "Teaches something without obvious selling — tips, how-tos.",
  },
  aspirational: {
    label: "Aspirational",
    blurb: "Lifestyle, identity, who-you-could-become.",
  },
  "ai-powered": {
    label: "AI-powered",
    blurb: "AI is the headline pitch — “let AI do it for you,” automation as the promise.",
  },
};

/** Human label for an angle code; falls back to the raw code if unknown. */
export function angleLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return ANGLE_INFO[code]?.label ?? code;
}

/** One-line explanation for an angle code; empty string if unknown. */
export function angleBlurb(code: string | null | undefined): string {
  if (!code) return "";
  return ANGLE_INFO[code]?.blurb ?? "";
}

/**
 * Friendly labels for the (now CTA-derived) conversion goals. Short, lowercase,
 * for inline use like "awareness-led". See lib/ads/cta-to-goal.ts.
 */
export const GOAL_LABEL: Record<string, string> = {
  "free-trial": "free-trial",
  awareness: "brand awareness",
  "demo-request": "demo",
  "direct-purchase": "purchase",
  "lead-capture": "lead-gen",
  "content-download": "content",
  "app-install": "app install",
  waitlist: "waitlist",
  other: "other",
};

/** Friendly label for a conversion-goal code; falls back to the raw code. */
export function goalLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return GOAL_LABEL[code] ?? code;
}

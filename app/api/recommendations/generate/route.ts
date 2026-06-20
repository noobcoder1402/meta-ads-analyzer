import { generateRecommendations } from "@/lib/ai/analyzers/generate-recommendations";

// Anthropic SDK → Node runtime. One Sonnet call; well under the limit.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Trigger cross-competitor GTM recommendations. Single Sonnet call, so plain JSON
 * (not SSE) — same pattern as the synthesize route.
 *
 * Demo mode is blocked: this writes to the recommendations table AND calls a paid
 * AI API. The deployed Vercel demo must never do either.
 */
export async function POST() {
  if (process.env.DEMO_MODE === "true") {
    return Response.json(
      { error: "Demo mode: write operations are disabled." },
      { status: 403 }
    );
  }

  try {
    const result = await generateRecommendations({ targetCount: "5-10" });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown recommender error." },
      { status: 500 }
    );
  }
}

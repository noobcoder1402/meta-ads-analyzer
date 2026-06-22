import { NextResponse } from "next/server";
import { generateAndSaveInsights } from "@/lib/ai/analyzers/generate-insights";

export const runtime = "nodejs";
// The Opus call can take a while on a large library; give it room.
export const maxDuration = 120;

export async function POST() {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { error: "Demo mode: AI generation is disabled. Clone the repo to use full functionality." },
      { status: 403 },
    );
  }

  try {
    const result = await generateAndSaveInsights();
    return NextResponse.json({
      ok: true,
      report: result.report,
      model: result.model,
      brandCount: result.brandCount,
      adCount: result.adCount,
      generatedAt: result.saved.generatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

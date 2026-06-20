import { NextRequest } from "next/server";
import {
  analyzeAdsForCompetitor,
  type AnalyzeEvent,
} from "@/lib/ai/analyzers/analyze-creative";

// Anthropic SDK + filesystem reads → Node runtime.
// A 50-ad batch at concurrency 5 typically lands in 1-2 min; bump the cap to 5.
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Server-Sent Events stream of analyzer progress.
 *
 * Each AnalyzeEvent the analyzer emits is forwarded as:
 *   data: <json>\n\n
 *
 * The client listens, updates a log + summary panel, then closes the stream
 * when it sees `type: "done"` or `type: "error"`.
 *
 * Demo mode is blocked — even though the SSE shape is just a read, the
 * analyzer writes to ad_analyses and calls a paid AI API. The deployed
 * Vercel demo must never do either.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.DEMO_MODE === "true") {
    return new Response(
      JSON.stringify({ error: "Demo mode: write operations are disabled." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const maxAds =
    typeof body?.maxAds === "number" && body.maxAds > 0 ? body.maxAds : undefined;
  const concurrency =
    typeof body?.concurrency === "number" && body.concurrency > 0
      ? body.concurrency
      : undefined;
  const force = body?.force === true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: AnalyzeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller may already be closed
        }
      };

      try {
        await analyzeAdsForCompetitor({
          competitorId: id,
          maxAds,
          concurrency,
          force,
          onEvent: send,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown analyzer error.",
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

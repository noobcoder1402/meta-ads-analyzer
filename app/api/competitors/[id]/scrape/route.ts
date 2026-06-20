import { NextRequest } from "next/server";
import { scrapeCompetitor, type ScrapeEvent } from "@/lib/scraper/scrape-competitor";

// Playwright needs Node, not edge. Scraping can take 20-90s; bump the limit accordingly.
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Server-Sent Events stream of scrape progress.
 *
 * Each ScrapeEvent the scraper emits is forwarded to the client as:
 *   data: <json>\n\n
 *
 * The client listens, updates a log panel + summary state, then closes the
 * stream when it sees `type: "done"` or `type: "error"`.
 *
 * Demo mode is blocked: even though the SSE shape is technically just a read,
 * the scraper writes to the ads + scrape_runs tables and spawns Playwright.
 * The deployed Vercel demo must never do either.
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
  const maxAds = typeof body?.maxAds === "number" && body.maxAds > 0 ? body.maxAds : undefined;
  // "ALL" (the UI default) = Meta's global view; a specific ISO code scopes to one
  // country's library. Omitted → the scraper's default market.
  const country = typeof body?.country === "string" ? body.country : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: ScrapeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller may already be closed
        }
      };

      try {
        await scrapeCompetitor({
          competitorId: id,
          country,
          maxAds,
          onEvent: send,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown scrape error.",
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

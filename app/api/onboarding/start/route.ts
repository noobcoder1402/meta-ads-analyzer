import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scrapeWebsite } from "@/scripts/scrape-website";
import { getAIClient } from "@/lib/ai/client";
import { CompanyProfileSchema } from "@/lib/ai/schemas";
import {
  COMPANY_PROFILE_PROMPT_STATIC,
  buildCompanyProfilePrompt,
} from "@/lib/ai/prompts/company-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StartSchema = z.object({
  websiteUrl: z.string().min(1),
  metaPageUrl: z.string().optional(),
  fallbackText: z.string().optional(),
});

type SSEEvent =
  | { type: "step"; step: "scrape" | "profile"; status: "running" | "done" | "error"; message: string }
  | { type: "result"; profile: z.infer<typeof CompanyProfileSchema>; websiteUrl: string; metaPageUrl?: string; scrapeText?: string }
  | { type: "error"; message: string }
  | { type: "needs_fallback"; message: string };

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      { error: "Demo mode: write operations are disabled. Clone the repo to use full functionality." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { websiteUrl, metaPageUrl, fallbackText } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        send({ type: "step", step: "scrape", status: "running", message: "Scraping your website…" });

        let scrapeText = "";
        try {
          const result = await scrapeWebsite(websiteUrl);
          scrapeText = result.combinedText;
          send({
            type: "step",
            step: "scrape",
            status: "done",
            message: `Scraped ${result.pages.length} page${result.pages.length === 1 ? "" : "s"}.`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown scrape error";
          if (!fallbackText) {
            send({
              type: "needs_fallback",
              message: `We couldn't fetch your site (${msg}). Tell us about your company in a few sentences.`,
            });
            controller.close();
            return;
          }
          send({
            type: "step",
            step: "scrape",
            status: "error",
            message: `Scrape failed, using your description instead.`,
          });
        }

        send({ type: "step", step: "profile", status: "running", message: "Generating profile…" });

        const ai = getAIClient();
        const profile = await ai.generate({
          schema: CompanyProfileSchema,
          staticPrompt: COMPANY_PROFILE_PROMPT_STATIC,
          prompt: buildCompanyProfilePrompt(scrapeText, fallbackText),
          model: "haiku",
          toolName: "record_company_profile",
          toolDescription: "Record the structured company profile.",
        });

        send({ type: "step", step: "profile", status: "done", message: "Profile ready." });
        send({
          type: "result",
          profile,
          websiteUrl,
          metaPageUrl,
          scrapeText: scrapeText.slice(0, 500),
        });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "error", message });
        controller.close();
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

/**
 * Creative analyzer — vision pass over one ad's image + caption.
 *
 * The unit of work is ONE ad. The batch wrapper (`analyzeAdsForCompetitor`) just
 * fans this out with bounded concurrency and emits progress events.
 *
 * Cost guardrails (see docs/ai-pipeline.md):
 *  - default batch cap = SCRAPE_MAX_ADS_PER_RUN (50)
 *  - prompt caching via the staticPrompt slot — required, not optional
 *  - schema validation failures retry exactly ONCE inside aiClient (in client.ts),
 *    then this layer logs to data/analysis-errors/ and marks the ad failed
 *  - never auto-runs from another pipeline; only CLI or explicit UI click
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { adAnalyses, ads as adsTable, type Ad } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAdsByCompetitor } from "@/lib/db/queries";

import { getAIClient, type ImageInput } from "@/lib/ai/client";
import {
  CreativeAnalysisSchema,
  type CreativeAnalysis,
} from "@/lib/ai/schemas";
import {
  CREATIVE_ANALYZER_PROMPT_STATIC,
  buildCreativeAnalyzerPrompt,
} from "@/lib/ai/prompts/creative-analyzer";
import { ctaToConversionGoal } from "@/lib/ads/cta-to-goal";

// ─── ANALYZER_VERSION ────────────────────────────────────────────────
// SHA-1 of (static prompt + JSON-serialized schema), 8 chars.
// Auto-bumps when either changes → dashboard surfaces a re-analyze banner.
// Never bump this by hand. See docs/ai-pipeline.md task #2.
const SCHEMA_FINGERPRINT = JSON.stringify(z.toJSONSchema(CreativeAnalysisSchema));
export const ANALYZER_VERSION = createHash("sha1")
  .update(CREATIVE_ANALYZER_PROMPT_STATIC)
  .update(SCHEMA_FINGERPRINT)
  .digest("hex")
  .slice(0, 8);

// ─── Event + result types ────────────────────────────────────────────

export type AnalyzeEvent =
  | { type: "log"; message: string }
  | { type: "progress"; completed: number; total: number }
  | {
      type: "analyzed-ad";
      adId: string;
      libraryId: string;
      hook: string;
      angle: string;
    }
  | {
      type: "failed-ad";
      adId: string;
      libraryId: string;
      error: string;
    }
  | { type: "done"; result: AnalyzeResult }
  | { type: "error"; message: string };

export type AnalyzeResult = {
  status: "success" | "partial" | "failed";
  total: number;
  analyzed: number;
  failed: number;
  skipped: number; // had no usable image
  analyzerVersion: string;
};

export type AnalyzeOptions = {
  competitorId: string;
  /** Max ads to process this run. Default = SCRAPE_MAX_ADS_PER_RUN or 50. */
  maxAds?: number;
  /** How many ads to run in parallel. Default = 5. */
  concurrency?: number;
  /** If true, re-analyze ads even if they already have a current-version row. */
  force?: boolean;
  /** Progress callback. */
  onEvent?: (event: AnalyzeEvent) => void;
};

// ─── Public entry point — batch over one competitor's ads ────────────

export async function analyzeAdsForCompetitor(
  opts: AnalyzeOptions
): Promise<AnalyzeResult> {
  const emit = (e: AnalyzeEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // never let a bad listener break the run
    }
  };

  const envMax = Number(process.env.SCRAPE_MAX_ADS_PER_RUN);
  const maxAds =
    opts.maxAds ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : 50);
  const concurrency = Math.max(1, opts.concurrency ?? 5);

  // Pull every ad for this competitor, then filter to the ones that need work.
  const allAds = await getAdsByCompetitor(opts.competitorId);
  const existing = await db
    .select({
      adId: adAnalyses.adId,
      analyzerVersion: adAnalyses.analyzerVersion,
      analysisFailedAt: adAnalyses.analysisFailedAt,
    })
    .from(adAnalyses);
  const stateByAd = new Map(
    existing.map((r) => [
      r.adId,
      { version: r.analyzerVersion, failedAt: r.analysisFailedAt },
    ])
  );

  const queue = allAds.filter((ad) => {
    if (opts.force) return true;
    const state = stateByAd.get(ad.id);
    // Need analyzing if: no row yet, OR row's version is stale, OR previous attempt failed.
    if (!state) return true;
    if (state.version !== ANALYZER_VERSION) return true;
    if (state.failedAt) return true;
    return false;
  });

  const toProcess = queue.slice(0, maxAds);
  const total = toProcess.length;

  emit({
    type: "log",
    message:
      total === 0
        ? "Nothing to analyze — every ad already has a current-version analysis."
        : `Analyzing ${total} ad${total === 1 ? "" : "s"} (${concurrency} in parallel)…`,
  });

  if (total === 0) {
    const result: AnalyzeResult = {
      status: "success",
      total: 0,
      analyzed: 0,
      failed: 0,
      skipped: 0,
      analyzerVersion: ANALYZER_VERSION,
    };
    emit({ type: "done", result });
    return result;
  }

  let analyzed = 0;
  let failed = 0;
  let skipped = 0;
  let completed = 0;

  // Bounded-concurrency worker pool. Simpler than promise-pool libs and
  // does exactly what we need.
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= toProcess.length) return;
      const ad = toProcess[idx];
      try {
        const outcome = await analyzeSingleAd(ad);
        if (outcome.kind === "analyzed") {
          analyzed++;
          emit({
            type: "analyzed-ad",
            adId: ad.id,
            libraryId: ad.libraryId,
            hook: outcome.analysis.hook,
            angle: outcome.analysis.angle,
          });
        } else if (outcome.kind === "skipped") {
          skipped++;
          emit({
            type: "log",
            message: `· skipped ${ad.libraryId} — ${outcome.reason}`,
          });
        }
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await logAnalysisError(ad, message);
        await markAdFailed(ad.id, message);
        emit({
          type: "failed-ad",
          adId: ad.id,
          libraryId: ad.libraryId,
          error: message,
        });
      } finally {
        completed++;
        emit({ type: "progress", completed, total });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () =>
    worker()
  );
  await Promise.all(workers);

  const status: AnalyzeResult["status"] =
    failed === 0 ? "success" : analyzed > 0 ? "partial" : "failed";

  const result: AnalyzeResult = {
    status,
    total,
    analyzed,
    failed,
    skipped,
    analyzerVersion: ANALYZER_VERSION,
  };
  emit({ type: "done", result });
  return result;
}

// ─── Single-ad worker ────────────────────────────────────────────────

type SingleAdOutcome =
  | { kind: "analyzed"; analysis: CreativeAnalysis }
  | { kind: "skipped"; reason: string };

async function analyzeSingleAd(ad: Ad): Promise<SingleAdOutcome> {
  const image = await readFirstImage(ad);
  if (!image) {
    return { kind: "skipped", reason: "no usable image on disk" };
  }

  const ai = getAIClient();
  const analysis = await ai.generate({
    schema: CreativeAnalysisSchema,
    staticPrompt: CREATIVE_ANALYZER_PROMPT_STATIC,
    prompt: buildCreativeAnalyzerPrompt({
      title: ad.title,
      caption: ad.caption,
      ctaLabel: ad.ctaLabel,
      mediaType: ad.mediaType,
    }),
    images: [image],
    model: "haiku",
    toolName: "record_result",
    toolDescription: "Record the structured creative analysis for this ad.",
  });

  await upsertAdAnalysis(ad.id, analysis, ad.ctaLabel);
  return { kind: "analyzed", analysis };
}

// ─── Media → base64 image input ──────────────────────────────────────

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * Detect the actual image format from magic bytes. Necessary because Meta
 * occasionally serves a PNG/WebP with a .jpg URL extension — and Anthropic's
 * vision API rejects the upload when the declared media type doesn't match
 * the actual bytes. Trusting the file extension caused ~3% of analyses to
 * fail on real Monday.com data; sniffing fixes them.
 */
function sniffImageMediaType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image/png";
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38)
    return "image/gif";
  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50 (RIFF....WEBP)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return null;
}

async function readFirstImage(ad: Ad): Promise<ImageInput | null> {
  const paths = ad.mediaPaths ?? [];
  for (const rel of paths) {
    const ext = path.extname(rel).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    try {
      const buf = await fs.readFile(abs);
      const mediaType = sniffImageMediaType(buf);
      if (!mediaType) continue; // not actually an image — skip
      return {
        source: {
          type: "base64",
          mediaType,
          data: buf.toString("base64"),
        },
      };
    } catch {
      // try the next file in the array
      continue;
    }
  }
  return null;
}

// ─── DB writes ───────────────────────────────────────────────────────

async function upsertAdAnalysis(
  adId: string,
  analysis: CreativeAnalysis,
  ctaLabel: string | null
) {
  const row = {
    adId,
    analyzerVersion: ANALYZER_VERSION,
    hook: analysis.hook,
    angle: analysis.angle,
    angleSecondary: analysis.angle_secondary ?? null,
    visualSummary: analysis.visual_summary,
    dominantColors: analysis.dominant_colors,
    textDensity: analysis.text_density,
    subject: analysis.subject,
    themes: analysis.themes,
    painPoints: analysis.pain_points,
    benefits: analysis.benefits,
    targetPersona: analysis.target_persona,
    emotionalTone: analysis.emotional_tone,
    // Derived from the Meta CTA, NOT the model. See lib/ads/cta-to-goal.ts.
    primaryConversionGoal: ctaToConversionGoal(ctaLabel),
    brandVoice: analysis.brand_voice,
    analysisFailedAt: null as string | null,
  };

  // ad_id is UNIQUE — Drizzle's onConflict updates all fields if the row exists.
  await db
    .insert(adAnalyses)
    .values(row)
    .onConflictDoUpdate({
      target: adAnalyses.adId,
      set: {
        ...row,
        updatedAt: new Date().toISOString(),
      },
    });
}

async function markAdFailed(adId: string, message: string) {
  // Write a stub row carrying analyzer_version + the failure timestamp.
  // The schema's hook/angle/etc are nullable so this is allowed.
  const failedAt = new Date().toISOString();
  await db
    .insert(adAnalyses)
    .values({
      adId,
      analyzerVersion: ANALYZER_VERSION,
      analysisFailedAt: failedAt,
    })
    .onConflictDoUpdate({
      target: adAnalyses.adId,
      set: {
        analyzerVersion: ANALYZER_VERSION,
        analysisFailedAt: failedAt,
        updatedAt: new Date().toISOString(),
      },
    });
  // Touch the ad row so downstream queries see something changed.
  void message;
  await db
    .update(adsTable)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(adsTable.id, adId));
}

// ─── Error logging to disk ───────────────────────────────────────────

const ANALYSIS_ERRORS_DIR = path.join(
  process.cwd(),
  "data",
  "analysis-errors"
);

async function logAnalysisError(ad: Ad, message: string) {
  try {
    await fs.mkdir(ANALYSIS_ERRORS_DIR, { recursive: true });
    const dest = path.join(ANALYSIS_ERRORS_DIR, `${ad.id}.json`);
    const payload = {
      ad_id: ad.id,
      library_id: ad.libraryId,
      competitor_id: ad.competitorId,
      analyzer_version: ANALYZER_VERSION,
      failed_at: new Date().toISOString(),
      error: message,
      caption_preview: (ad.caption ?? "").slice(0, 200),
      media_paths: ad.mediaPaths ?? [],
    };
    await fs.writeFile(dest, JSON.stringify(payload, null, 2));
  } catch {
    // disk errors shouldn't break the pipeline
  }
}

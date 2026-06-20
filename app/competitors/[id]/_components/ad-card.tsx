"use client";

import { Badge } from "@/components/ui/badge";
import type { Ad } from "@/lib/db/schema";
import {
  classify,
  bucketOf,
  BUCKET_LABEL,
  TAG_LABEL,
  type Bucket,
} from "@/lib/scoring/buckets";
import { AdDetailDialog, type AdScore } from "./ad-detail-dialog";

/** Display emoji per bucket — shared by the card and the grid's filter bar. */
export const BUCKET_EMOJI: Record<Bucket, string> = {
  winner: "🏆",
  new: "🧪",
  maturing: "🌱",
  flopped: "⚰️",
  retired: "📦",
  other: "○",
};

/**
 * One ad thumbnail card: image, score/bucket/tags, caption, CTA + days-active.
 * Clicking opens the full AdDetailDialog. Reused by the ad grid AND the strategy
 * summary's Winners / What's-new sections — keep it presentation-only.
 */
export function AdCard({
  ad,
  score,
}: {
  ad: Ad;
  score: AdScore | null;
}) {
  const firstMedia = ad.mediaPaths?.[0];
  const imageUrl = firstMedia ? mediaPathToUrl(firstMedia) : null;
  const extraCount = (ad.mediaPaths?.length ?? 0) - 1;
  const classified = score ? classify(ad, score.score) : null;
  const bucket = classified?.bucket ?? null;

  return (
    <AdDetailDialog ad={ad} score={score}>
      <button
        type="button"
        className={`group text-left rounded-lg border bg-card overflow-hidden flex flex-col w-full cursor-pointer transition-colors hover:border-primary/50 ${
          ad.isActive ? "border-border" : "border-border/50"
        }`}
      >
        <div className="relative aspect-square bg-muted overflow-hidden">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={ad.caption?.slice(0, 60) ?? "Ad creative"}
              className={`w-full h-full object-cover ${
                ad.isActive ? "" : "opacity-50 grayscale"
              }`}
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
              No image
            </div>
          )}

          {!ad.isActive && (
            <div className="absolute inset-0 bg-background/30 pointer-events-none" />
          )}

          {score && (
            <div className="absolute bottom-2 left-2">
              <Badge className={scoreBadgeClass(bucket)}>
                {Math.round(score.score)}
              </Badge>
            </div>
          )}

          <div className="absolute top-2 left-2 flex gap-1">
            {ad.mediaType === "carousel" && (
              <Badge variant="secondary" className="text-[10px] h-5">
                Carousel{extraCount > 0 ? ` · ${extraCount + 1}` : ""}
              </Badge>
            )}
            {ad.mediaType === "video" && (
              <Badge variant="secondary" className="text-[10px] h-5">
                Video
              </Badge>
            )}
          </div>

          <div className="absolute top-2 right-2">
            {ad.isActive ? (
              <Badge className="text-[10px] h-5 bg-green-500/20 text-green-400 border border-green-500/30">
                ● Active
              </Badge>
            ) : (
              <Badge className="text-[10px] h-5 bg-red-500/20 text-red-400 border border-red-500/30">
                ● Inactive
              </Badge>
            )}
          </div>
        </div>

        <div className="p-3 flex flex-col gap-2 flex-1">
          {bucket && (
            <div className="flex flex-wrap items-center gap-1">
              <Badge className={bucketLabelClass(bucket)}>
                {BUCKET_EMOJI[bucket]} {BUCKET_LABEL[bucket]}
              </Badge>
              {classified?.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] h-5">
                  {TAG_LABEL[t]}
                </Badge>
              ))}
            </div>
          )}

          <p className="text-sm leading-snug line-clamp-3 min-h-[3.6em]">
            {ad.caption || (
              <span className="text-muted-foreground italic">No caption</span>
            )}
          </p>

          <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-border">
            <div className="flex items-center gap-2 min-w-0">
              {ad.ctaLabel && (
                <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                  {ad.ctaLabel}
                </Badge>
              )}
              {ad.landingUrl && (
                <span
                  className="text-xs text-muted-foreground truncate"
                  title={ad.landingUrl}
                >
                  {hostnameOf(ad.landingUrl)}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {ad.daysActive}d
            </span>
          </div>
        </div>
      </button>
    </AdDetailDialog>
  );
}

/** Per-bucket accent for the body label pill (matches the count-bar chips). */
function bucketLabelClass(bucket: Bucket): string {
  const base = "text-[10px] h-5";
  switch (bucket) {
    case "winner":
      return `${base} bg-green-500/25 text-green-300 border border-green-500/40`;
    case "new":
      return `${base} bg-blue-500/25 text-blue-300 border border-blue-500/40`;
    case "maturing":
      return `${base} bg-amber-500/25 text-amber-300 border border-amber-500/40`;
    case "flopped":
      return `${base} bg-red-500/25 text-red-300 border border-red-500/40`;
    case "retired":
      return `${base} bg-slate-500/25 text-slate-300 border border-slate-500/40`;
    default:
      return `${base} bg-muted text-muted-foreground border border-border`;
  }
}

function scoreBadgeClass(bucket: ReturnType<typeof bucketOf> | null): string {
  switch (bucket) {
    case "winner":
      return "text-[11px] h-5 bg-green-500/25 text-green-300 border border-green-500/40";
    case "new":
      return "text-[11px] h-5 bg-blue-500/25 text-blue-300 border border-blue-500/40";
    case "maturing":
      return "text-[11px] h-5 bg-amber-500/25 text-amber-300 border border-amber-500/40";
    case "flopped":
      return "text-[11px] h-5 bg-red-500/25 text-red-300 border border-red-500/40";
    case "retired":
      return "text-[11px] h-5 bg-slate-500/25 text-slate-300 border border-slate-500/40";
    default:
      return "text-[11px] h-5 bg-background/80 text-foreground border border-border";
  }
}

export function mediaPathToUrl(stored: string): string {
  // DB stores paths like "data/ad-creatives/<uuid>-0.jpg"; route serves by filename.
  const filename = stored.split("/").pop();
  return filename ? `/api/creatives/${filename}` : "";
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

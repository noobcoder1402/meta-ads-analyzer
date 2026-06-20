"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { Ad, AdAnalysis } from "@/lib/db/schema";
import { SIGNAL_MAX } from "@/lib/scoring/performance-score";
import { classify, BUCKET_LABEL, TAG_LABEL } from "@/lib/scoring/buckets";

/** The score fields the dialog needs (subset of a performance_scores row). */
export type AdScore = {
  score: number;
  longevityPts: number;
  placementPts: number;
  recencyPts: number;
  explanation: string | null;
};

type Props = {
  ad: Ad;
  score: AdScore | null;
  analysis: AdAnalysis | null;
  /** The clickable card, rendered as the dialog trigger (Base UI `render` prop). */
  children: React.ReactElement;
};

export function AdDetailDialog({ ad, score, analysis, children }: Props) {
  // Pass the analysis so a Flopped ad with a promo angle/theme picks up the
  // `Likely campaign` tag. `analysis` (an AdAnalysis row or null) satisfies AdAnalysisSignal.
  const classified = score ? classify(ad, score.score, analysis) : null;
  const bucket = classified?.bucket ?? null;
  const tags = classified?.tags ?? [];

  const images = (ad.mediaPaths ?? []).map(mediaPathToUrl).filter(Boolean);

  return (
    <Dialog>
      <DialogTrigger render={children} />
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
            <span>Ad detail</span>
            {bucket && (
              <Badge className={bucketBadgeClass(bucket)}>
                {BUCKET_LABEL[bucket]}
              </Badge>
            )}
            {tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {TAG_LABEL[t]}
              </Badge>
            ))}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── Left: media + caption ── */}
          <div className="space-y-3">
            <div className="relative aspect-square rounded-lg bg-muted overflow-hidden">
              {images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={images[0]}
                  alt={ad.caption?.slice(0, 60) ?? "Ad creative"}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                  No image
                </div>
              )}
              {images.length > 1 && (
                <Badge
                  variant="secondary"
                  className="absolute bottom-2 right-2 text-[10px]"
                >
                  +{images.length - 1} more
                </Badge>
              )}
            </div>

            {ad.title && (
              <p className="text-sm font-semibold leading-snug">{ad.title}</p>
            )}

            <p className="text-sm leading-snug">
              {ad.caption || (
                <span className="text-muted-foreground italic">No caption</span>
              )}
            </p>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              {ad.displayFormat === "DCO" && (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  title="Meta is A/B-testing multiple creative versions within this single ad."
                >
                  Multiple versions (DCO)
                </Badge>
              )}
              {ad.collationCount != null && ad.collationCount > 1 && (
                <Badge
                  variant="secondary"
                  className="text-[10px]"
                  title="Number of separate ad instances Meta groups under this same creative — a scaling signal. Market-scoped."
                >
                  {ad.collationCount} ads use this creative
                </Badge>
              )}
              {ad.containsAiMedia && (
                <Badge variant="outline" className="text-[10px]">
                  AI-generated media
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              {ad.ctaLabel && (
                <Badge variant="outline" className="text-[10px]">
                  {ad.ctaLabel}
                </Badge>
              )}
              <span>{ad.daysActive}d running</span>
              <span>·</span>
              <span>{ad.isActive ? "Active" : "Inactive"}</span>
              {ad.landingUrl && (
                <a
                  href={ad.landingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline truncate"
                  title={ad.landingUrl}
                >
                  {hostnameOf(ad.landingUrl)} →
                </a>
              )}
            </div>
          </div>

          {/* ── Right: score breakdown + analysis ── */}
          <div className="space-y-5">
            {score ? (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">Performance score</h3>
                  <span className="text-2xl font-semibold tabular-nums">
                    {Math.round(score.score)}
                    <span className="text-sm text-muted-foreground">/100</span>
                  </span>
                </div>

                <SignalBar
                  label="Longevity"
                  pts={score.longevityPts}
                  max={SIGNAL_MAX.longevity}
                  detail={`${ad.daysActive}d running`}
                />
                <SignalBar
                  label="Placement"
                  pts={score.placementPts}
                  max={SIGNAL_MAX.placement}
                  detail={`${ad.placements.length} placement${
                    ad.placements.length === 1 ? "" : "s"
                  }`}
                />
                <SignalBar
                  label="Recency"
                  pts={score.recencyPts}
                  max={SIGNAL_MAX.recency}
                  detail={ad.isActive ? "Currently active" : "Paused"}
                />

                {score.explanation && (
                  <p className="text-xs text-muted-foreground pt-1">
                    {score.explanation}
                  </p>
                )}
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not scored yet.
              </p>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">AI analysis</h3>
              {analysis && !analysis.analysisFailedAt ? (
                <div className="space-y-3 text-sm">
                  <Field label="Hook" value={analysis.hook} />
                  <Field
                    label="Angle"
                    value={[analysis.angle, analysis.angleSecondary]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <Field label="Persona" value={analysis.targetPersona} />
                  <Field label="Tone" value={analysis.emotionalTone} />
                  <ChipList label="Themes" items={analysis.themes} />
                  <ChipList label="Pain points" items={analysis.painPoints} />
                  <ChipList label="Benefits" items={analysis.benefits} />
                </div>
              ) : analysis?.analysisFailedAt ? (
                <p className="text-sm text-muted-foreground">
                  Analysis failed — it&apos;ll retry on the next analyze run.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not analyzed yet. Use{" "}
                  <span className="text-foreground font-medium">Analyze ads</span>{" "}
                  to generate hooks, angles, and themes.
                </p>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignalBar({
  label,
  pts,
  max,
  detail,
}: {
  label: string;
  pts: number;
  max: number;
  detail: string;
}) {
  const pct = max > 0 ? Math.min(100, (pts / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {Math.round(pts)}/{max} · {detail}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="leading-snug">{value}</p>
    </div>
  );
}

function ChipList({ label, items }: { label: string; items: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1 mt-1">
        {items.map((it, i) => (
          <Badge key={`${it}-${i}`} variant="secondary" className="text-[10px]">
            {it}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function bucketBadgeClass(bucket: NonNullable<ReturnType<typeof classify>["bucket"]>): string {
  switch (bucket) {
    case "winner":
      return "bg-green-500/20 text-green-400 border border-green-500/30";
    case "new":
      return "bg-blue-500/20 text-blue-400 border border-blue-500/30";
    case "maturing":
      return "bg-amber-500/20 text-amber-400 border border-amber-500/30";
    case "flopped":
      return "bg-red-500/20 text-red-400 border border-red-500/30";
    case "retired":
      return "bg-slate-500/20 text-slate-400 border border-slate-500/30";
    default:
      return "bg-muted text-muted-foreground border border-border";
  }
}

function mediaPathToUrl(stored: string): string {
  const filename = stored.split("/").pop();
  return filename ? `/api/creatives/${filename}` : "";
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

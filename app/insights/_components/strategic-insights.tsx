"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StrategicInsights, StrategicInsight } from "@/lib/ai/schemas";

export type StrategicInsightsPanelProps = {
  /** The cached report, or null if none has been generated yet. */
  report: StrategicInsights | null;
  generatedAt: string | null;
  model: string | null;
  brandCount: number | null;
  adCount: number | null;
  /** True when the underlying numbers changed since this report was written. */
  stale: boolean;
  /** Read-only demo: hide the generate/regenerate button. */
  isDemo: boolean;
};

const CONFIDENCE_STYLE: Record<StrategicInsight["confidence"], string> = {
  high: "border-emerald-500/40 text-emerald-400",
  medium: "border-amber-500/40 text-amber-400",
  low: "border-muted-foreground/40 text-muted-foreground",
};

const CATEGORY_LABEL: Record<StrategicInsight["category"], string> = {
  longevity: "Longevity",
  cta: "CTA",
  creative: "Creative",
  media: "Media",
  copy: "Copy",
  localization: "Localization",
  messaging: "Messaging",
  placement: "Placement",
  velocity: "Velocity",
  other: "Other",
};

function timeAgo(iso: string): string {
  // iso is "YYYY-MM-DD HH:MM:SS" (UTC, from SQLite datetime('now')).
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function StrategicInsightsPanel(props: StrategicInsightsPanelProps) {
  const { report, generatedAt, model, brandCount, adCount, stale, isDemo } = props;
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/generate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Generation failed.");
        return;
      }
      router.refresh(); // re-reads the cached report from the server component
    } catch {
      setError("Network error — is the dev server still running?");
    } finally {
      setLoading(false);
    }
  }

  const button = isDemo ? null : (
    <Button size="sm" onClick={generate} disabled={loading}>
      {loading ? "Analyzing…" : report ? "Regenerate" : "Generate insights"}
    </Button>
  );

  // ─── Empty state: never generated ──────────────────────────────────
  if (!report) {
    return (
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardHeader>
          <CardTitle className="text-base">AI strategic insights</CardTitle>
          <p className="text-sm text-muted-foreground">
            AI reads every number below and writes a short strategic summary — what each
            brand is really doing, where your gaps are, and what to test. It runs only when
            you click, and the result is saved.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {button}
          {isDemo && (
            <p className="text-sm text-muted-foreground">
              Generation is disabled in the read-only demo.
            </p>
          )}
          {loading && (
            <p className="text-sm text-muted-foreground">
              Reading the numbers and writing the narrative — this takes ~20–40 seconds.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  // ─── Has a report ──────────────────────────────────────────────────
  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">AI strategic insights</CardTitle>
            <p className="text-sm text-muted-foreground">
              {generatedAt && <>Generated {timeAgo(generatedAt)}</>}
              {model && <> · {model}</>}
              {brandCount != null && adCount != null && (
                <> · over {adCount.toLocaleString()} ads across {brandCount} brands</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">{button}</div>
        </div>
        {stale && !isDemo && (
          <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            The underlying numbers changed since this was written (you&apos;ve scraped
            since). Regenerate to refresh the narrative.
          </div>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Headline */}
        <p className="text-[15px] font-medium leading-relaxed text-foreground">
          {report.headline}
        </p>

        {/* How to read longevity — the flagged caveat */}
        <div className="rounded-md border-l-2 border-primary/60 bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium text-foreground">How to read longevity: </span>
          <span className="text-muted-foreground">{report.howToReadLongevity}</span>
        </div>

        {/* Insight cards */}
        <ol className="space-y-4">
          {report.insights.map((ins, i) => (
            <li key={i} className="rounded-lg border border-border bg-background/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {i + 1}. {ins.title}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {CATEGORY_LABEL[ins.category]}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", CONFIDENCE_STYLE[ins.confidence])}
                >
                  {ins.confidence} confidence
                </Badge>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {ins.narrative}
              </p>

              {ins.evidence.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-muted-foreground/80">
                  {ins.evidence.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              )}

              <p className="mt-2 text-sm">
                <span className="font-medium text-primary">So what: </span>
                <span className="text-foreground/90">{ins.recommendation}</span>
              </p>
            </li>
          ))}
        </ol>

        {/* Caveats */}
        {report.caveats.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs font-medium text-foreground">Honest caveats</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {report.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/70">
          An AI interpretation of the numbers below. It treats long-running ads as a hint of
          what&apos;s working — Meta shows no spend, reach, or conversions, so nothing here is
          a claim about budget or market share.
        </p>
      </CardContent>
    </Card>
  );
}

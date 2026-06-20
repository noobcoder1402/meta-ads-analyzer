"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { AdAnalysis } from "@/lib/db/schema";
import type { SwipeFileAd } from "@/lib/db/queries";
import { bucketOf, classify, type Bucket } from "@/lib/scoring/buckets";
import { AdDetailDialog, type AdScore } from "@/app/competitors/[id]/_components/ad-detail-dialog";

type Props = {
  ads: SwipeFileAd[];
  scores: Record<string, AdScore>;
  analyses: Record<string, AdAnalysis>;
};

type SortKey = "score" | "longevity" | "recent";

/** Sections shown in order; "flopped" only when the toggle is on. */
const SECTIONS: {
  bucket: Bucket;
  emoji: string;
  title: string;
  subtitle: string;
  empty: string;
}[] = [
  {
    bucket: "winner",
    emoji: "🏆",
    title: "Winners",
    subtitle: "Proven ads competitors keep spending on — the safest things to copy.",
    empty: "No winners match these angles.",
  },
  {
    bucket: "new",
    emoji: "🧪",
    title: "New & testing",
    subtitle: "Ads launched in the last 14 days — a leading indicator of what's next.",
    empty: "No experiments in the last 14 days.",
  },
  {
    bucket: "flopped",
    emoji: "⚰️",
    title: "Flopped",
    subtitle:
      "Pulled after a short run — a 'don't replicate' reference. Ads tagged Likely campaign were planned promos, not failures.",
    empty: "No dropped ads match these angles.",
  },
];

/** kebab-case angle → "Title case" for the filter pills. */
function angleLabel(angle: string): string {
  return angle
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function SwipeGrid({ ads, scores, analyses }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [angle, setAngle] = useState<string>("all");
  const [showDropped, setShowDropped] = useState(false);

  // Angles actually present across analyzed ads → the filter pill row.
  const angles = useMemo(() => {
    const set = new Set<string>();
    for (const ad of ads) {
      const a = analyses[ad.id]?.angle;
      if (a) set.add(a);
    }
    return [...set].sort();
  }, [ads, analyses]);

  // Pre-bucket every ad once, applying the angle filter.
  const byBucket = useMemo(() => {
    const groups: Record<Bucket, SwipeFileAd[]> = {
      winner: [],
      new: [],
      maturing: [],
      flopped: [],
      retired: [],
      other: [],
    };
    for (const ad of ads) {
      const score = scores[ad.id] ?? null;
      if (!score) continue; // unscored ads can't be bucketed
      if (angle !== "all" && analyses[ad.id]?.angle !== angle) continue;
      groups[bucketOf(ad, score.score)].push(ad);
    }
    const sortFn = (a: SwipeFileAd, b: SwipeFileAd) => {
      if (sortKey === "score") {
        return (scores[b.id]?.score ?? -1) - (scores[a.id]?.score ?? -1);
      }
      if (sortKey === "recent") {
        return b.firstSeenAt.localeCompare(a.firstSeenAt);
      }
      return b.daysActive - a.daysActive;
    };
    for (const k of Object.keys(groups) as Bucket[]) groups[k].sort(sortFn);
    return groups;
  }, [ads, scores, analyses, angle, sortKey]);

  const visibleSections = SECTIONS.filter(
    (s) => s.bucket !== "flopped" || showDropped,
  );

  return (
    <div className="space-y-6">
      {/* Filter + sort controls */}
      <div className="flex flex-col gap-4">
        {angles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAngle("all")}
              className={pillClass(angle === "all")}
            >
              All angles
            </button>
            {angles.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAngle(a)}
                className={pillClass(angle === a)}
              >
                {angleLabel(a)}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
            <input
              type="checkbox"
              checked={showDropped}
              onChange={(e) => setShowDropped(e.target.checked)}
              className="h-4 w-4 rounded border-input bg-background"
            />
            <span>Show dropped ads</span>
          </label>

          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            {(
              [
                ["score", "Score"],
                ["longevity", "Longest running"],
                ["recent", "Recently added"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`px-2 py-1 rounded ${
                  sortKey === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      {visibleSections.map((section) => {
        const sectionAds = byBucket[section.bucket];
        return (
          <section key={section.bucket} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">
                {section.emoji} {section.title}{" "}
                <span className="text-muted-foreground font-normal">
                  ({sectionAds.length})
                </span>
              </h2>
              <p className="text-sm text-muted-foreground">{section.subtitle}</p>
            </div>
            {sectionAds.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
                {section.empty}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {sectionAds.map((ad) => (
                  <SwipeCard
                    key={ad.id}
                    ad={ad}
                    score={scores[ad.id] ?? null}
                    analysis={analyses[ad.id] ?? null}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SwipeCard({
  ad,
  score,
  analysis,
}: {
  ad: SwipeFileAd;
  score: AdScore | null;
  analysis: AdAnalysis | null;
}) {
  const firstMedia = ad.mediaPaths?.[0];
  const imageUrl = firstMedia ? mediaPathToUrl(firstMedia) : null;
  const bucket = score ? classify(ad, score.score, analysis).bucket : null;
  const hook = analysis?.hook?.trim() || ad.caption?.trim() || null;
  const isSelf = ad.competitorStatus === "self";

  return (
    <AdDetailDialog ad={ad} score={score} analysis={analysis}>
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
          {score && (
            <div className="absolute bottom-2 left-2">
              <Badge className={scoreBadgeClass(bucket)}>
                {Math.round(score.score)}
              </Badge>
            </div>
          )}
        </div>

        <div className="p-3 flex flex-col gap-2 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[10px] font-semibold shrink-0">
              {ad.competitorName.charAt(0).toUpperCase()}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {isSelf ? `${ad.competitorName} (You)` : ad.competitorName}
            </span>
          </div>

          <p className="text-sm leading-snug line-clamp-2 min-h-[2.5em]">
            {hook || (
              <span className="text-muted-foreground italic">No hook</span>
            )}
          </p>

          {analysis?.angle && (
            <div className="mt-auto pt-1">
              <Badge variant="outline" className="text-[10px] h-5">
                {angleLabel(analysis.angle)}
              </Badge>
            </div>
          )}
        </div>
      </button>
    </AdDetailDialog>
  );
}

function pillClass(selected: boolean): string {
  const base =
    "inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors";
  return selected
    ? `${base} border-foreground/40 bg-foreground/10 text-foreground`
    : `${base} border-border text-muted-foreground hover:text-foreground hover:border-foreground/30`;
}

function scoreBadgeClass(bucket: Bucket | null): string {
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

function mediaPathToUrl(stored: string): string {
  const filename = stored.split("/").pop();
  return filename ? `/api/creatives/${filename}` : "";
}

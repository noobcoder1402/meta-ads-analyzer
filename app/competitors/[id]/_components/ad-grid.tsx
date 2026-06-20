"use client";

import { useMemo, useState } from "react";
import type { Ad } from "@/lib/db/schema";
import { bucketOf, BUCKET_LABEL, type Bucket } from "@/lib/scoring/buckets";
import type { AdScore } from "./ad-detail-dialog";
import { AdCard, BUCKET_EMOJI } from "./ad-card";

type Props = {
  ads: Ad[];
  /** adId → score row. Built server-side in the page. */
  scores: Record<string, AdScore>;
};

type SortKey = "score" | "longevity";
type BucketFilter = Bucket | "all";

/** Display order for the bucket count/filter bar (emoji live in ad-card.tsx). */
const BUCKET_ORDER: Bucket[] = ["winner", "new", "maturing", "flopped", "retired", "other"];

/** Bucket of an ad, treating an unscored ad as "other". */
function bucketForAd(ad: Ad, score: AdScore | null): Bucket {
  return score ? bucketOf(ad, score.score) : "other";
}

export function AdGrid({ ads, scores }: Props) {
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>("all");

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      winner: 0,
      new: 0,
      maturing: 0,
      flopped: 0,
      retired: 0,
      other: 0,
    };
    for (const ad of ads) c[bucketForAd(ad, scores[ad.id] ?? null)]++;
    return c;
  }, [ads, scores]);

  const filtered = useMemo(() => {
    // Picking a bucket is an explicit intent, so it bypasses "Active only"
    // (otherwise selecting Flopped while Active-only is on shows nothing).
    let arr: Ad[];
    if (bucketFilter !== "all") {
      arr = ads.filter(
        (a) => bucketForAd(a, scores[a.id] ?? null) === bucketFilter,
      );
    } else {
      arr = showActiveOnly ? ads.filter((a) => a.isActive) : ads;
    }
    return [...arr].sort((a, b) => {
      if (sortKey === "score") {
        const sa = scores[a.id]?.score ?? -1;
        const sb = scores[b.id]?.score ?? -1;
        if (sa !== sb) return sb - sa; // highest score first
      }
      // longevity sort, and the tiebreaker for score sort
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.daysActive - a.daysActive;
    });
  }, [ads, bucketFilter, showActiveOnly, sortKey, scores]);

  const activeCount = ads.filter((a) => a.isActive).length;
  const inactiveCount = ads.length - activeCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setBucketFilter("all")}
          className={bucketChipClass("all", bucketFilter === "all")}
        >
          All {ads.length}
        </button>
        {BUCKET_ORDER.filter((b) => counts[b] > 0).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBucketFilter(b)}
            className={bucketChipClass(b, bucketFilter === b)}
          >
            <span>{BUCKET_EMOJI[b]}</span>
            <span>{counts[b]}</span>
            <span>{BUCKET_LABEL[b]}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <label
          className={`flex items-center gap-2 text-sm select-none ${
            bucketFilter === "all"
              ? "cursor-pointer"
              : "cursor-not-allowed opacity-50"
          }`}
          title={
            bucketFilter === "all"
              ? undefined
              : "Clear the bucket filter to use Active only"
          }
        >
          <input
            type="checkbox"
            checked={showActiveOnly}
            disabled={bucketFilter !== "all"}
            onChange={(e) => setShowActiveOnly(e.target.checked)}
            className="h-4 w-4 rounded border-input bg-background"
          />
          <span>Active only</span>
          <span className="text-xs text-muted-foreground">
            ({activeCount} active · {inactiveCount} inactive)
          </span>
        </label>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            <button
              onClick={() => setSortKey("score")}
              className={`px-2 py-1 rounded ${
                sortKey === "score"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Score
            </button>
            <button
              onClick={() => setSortKey("longevity")}
              className={`px-2 py-1 rounded ${
                sortKey === "longevity"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Longest running
            </button>
          </div>
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {ads.length}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
          No ads match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((ad) => (
            <AdCard key={ad.id} ad={ad} score={scores[ad.id] ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Count-bar chip. `selected` fills the accent; otherwise it's a quiet outline. */
function bucketChipClass(bucket: BucketFilter, selected: boolean): string {
  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors";
  if (!selected) {
    return `${base} border-border text-muted-foreground hover:text-foreground hover:border-foreground/30`;
  }
  switch (bucket) {
    case "winner":
      return `${base} border-green-500/50 bg-green-500/20 text-green-300`;
    case "new":
      return `${base} border-blue-500/50 bg-blue-500/20 text-blue-300`;
    case "maturing":
      return `${base} border-amber-500/50 bg-amber-500/20 text-amber-300`;
    case "flopped":
      return `${base} border-red-500/50 bg-red-500/20 text-red-300`;
    case "retired":
      return `${base} border-slate-500/50 bg-slate-500/20 text-slate-300`;
    default:
      return `${base} border-foreground/40 bg-foreground/10 text-foreground`;
  }
}


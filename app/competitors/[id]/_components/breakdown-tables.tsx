"use client";

import { useMemo, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Ad } from "@/lib/db/schema";
import { bucketOf, BUCKET_LABEL, type Bucket } from "@/lib/scoring/buckets";
import type { AdScore } from "./ad-detail-dialog";

type Props = {
  ads: Ad[];
  /** adId → score row. Built server-side in the page. */
  scores: Record<string, AdScore>;
};

const BUCKET_ORDER: Bucket[] = ["winner", "new", "maturing", "flopped", "retired", "other"];
const BUCKET_EMOJI: Record<Bucket, string> = {
  winner: "🏆",
  new: "🧪",
  maturing: "🌱",
  flopped: "⚰️",
  retired: "📦",
  other: "○",
};
/** Header accent per bucket — mirrors the chip colours used in the ad grid. */
const BUCKET_HEAD_CLASS: Record<Bucket, string> = {
  winner: "text-green-300",
  new: "text-blue-300",
  maturing: "text-amber-300",
  flopped: "text-red-300",
  retired: "text-slate-300",
  other: "text-muted-foreground",
};

/** Bucket of an ad, treating an unscored ad as "other" (matches the ad grid). */
function bucketForAd(ad: Ad, score: AdScore | null): Bucket {
  return score ? bucketOf(ad, score.score) : "other";
}

type Counts = Record<Bucket, number>;
function emptyCounts(): Counts {
  return { winner: 0, new: 0, maturing: 0, flopped: 0, retired: 0, other: 0 };
}

type MatrixRow = { key: string; label: ReactNode; counts: Counts; total: number };

export function BreakdownTables({ ads, scores }: Props) {
  // Each ad's bucket, computed once.
  const bucketed = useMemo(
    () =>
      ads.map((ad) => ({
        ad,
        bucket: bucketForAd(ad, scores[ad.id] ?? null),
      })),
    [ads, scores],
  );

  // ---- By format --------------------------------------------------------
  // Each ad is exactly one format, so column totals here equal the ad count.
  const format = useMemo(() => {
    const order: Array<{ key: NonNullable<Ad["mediaType"]> | "unknown"; label: string }> = [
      { key: "image", label: "Image" },
      { key: "video", label: "Video" },
      { key: "carousel", label: "Carousel" },
      { key: "unknown", label: "Unknown" },
    ];
    const byFormat = new Map<string, Counts>();
    for (const { ad, bucket } of bucketed) {
      const key = ad.mediaType ?? "unknown";
      let c = byFormat.get(key);
      if (!c) {
        c = emptyCounts();
        byFormat.set(key, c);
      }
      c[bucket] += 1;
    }
    const rows: MatrixRow[] = order
      .filter((o) => byFormat.has(o.key))
      .map((o) => {
        const counts = byFormat.get(o.key)!;
        return {
          key: o.key,
          label: o.label,
          counts,
          total: BUCKET_ORDER.reduce((s, b) => s + counts[b], 0),
        };
      });
    return { rows };
  }, [bucketed]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <MatrixCard
        title="Ads by format"
        rowHeader="Format"
        rows={format.rows}
        emptyHint="No ads to break down yet."
        footnote="Each ad is exactly one format, so column totals match the ad count."
      />
    </div>
  );
}

function MatrixCard({
  title,
  rowHeader,
  rows,
  emptyHint,
  footnote,
}: {
  title: string;
  rowHeader: string;
  rows: MatrixRow[];
  emptyHint: string;
  footnote: ReactNode;
}) {
  // Column totals across all rows (informational footer).
  const totals = useMemo(() => {
    const c = emptyCounts();
    let all = 0;
    for (const r of rows) {
      for (const b of BUCKET_ORDER) c[b] += r.counts[b];
      all += r.total;
    }
    return { c, all };
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{rowHeader}</TableHead>
                  {BUCKET_ORDER.map((b) => (
                    <TableHead
                      key={b}
                      className={`text-right whitespace-nowrap ${BUCKET_HEAD_CLASS[b]}`}
                      title={BUCKET_LABEL[b]}
                    >
                      {BUCKET_EMOJI[b]}
                    </TableHead>
                  ))}
                  <TableHead className="text-right font-medium">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="whitespace-nowrap">{r.label}</TableCell>
                    {BUCKET_ORDER.map((b) => (
                      <TableCell
                        key={b}
                        className={`text-right tabular-nums ${
                          r.counts[b] === 0 ? "text-muted-foreground/40" : ""
                        }`}
                      >
                        {r.counts[b]}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums font-medium">
                      {r.total}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-medium text-muted-foreground">
                    All
                  </TableCell>
                  {BUCKET_ORDER.map((b) => (
                    <TableCell
                      key={b}
                      className="text-right tabular-nums font-medium text-muted-foreground"
                    >
                      {totals.c[b]}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums font-medium text-muted-foreground">
                    {totals.all}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              {BUCKET_ORDER.map((b) => `${BUCKET_EMOJI[b]} ${BUCKET_LABEL[b]}`).join(
                " · ",
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {footnote}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

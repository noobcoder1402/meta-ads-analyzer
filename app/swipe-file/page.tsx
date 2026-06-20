import Link from "next/link";
import { getSwipeFileAds, getAllScores, getAllAnalyses } from "@/lib/db/queries";
import { Card, CardContent } from "@/components/ui/card";
import { SwipeGrid } from "./_components/swipe-grid";

export const dynamic = "force-dynamic";

export default async function SwipeFilePage() {
  const [ads, scoreRows, analysisRows] = await Promise.all([
    getSwipeFileAds(),
    getAllScores(),
    getAllAnalyses(),
  ]);

  const scores = Object.fromEntries(scoreRows.map((s) => [s.adId, s]));
  const analyses = Object.fromEntries(analysisRows.map((a) => [a.adId, a]));

  // Scoring is pure math over scraped columns, so a scored ad needs no analysis to
  // be bucketed. If nothing is scored yet, there's nothing to show.
  const hasScoredAds = ads.some((a) => scores[a.id]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Swipe File</h1>
        <p className="text-muted-foreground mt-1">
          The best ads across every tracked brand, grouped by inferred performance —
          what to copy and what to test next.
        </p>
      </div>

      {hasScoredAds ? (
        <SwipeGrid ads={ads} scores={scores} analyses={analyses} />
      ) : (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <p className="text-muted-foreground">
              No scored ads yet. Scrape a competitor&apos;s ads to populate the swipe
              file — scoring runs automatically after each scrape.
            </p>
            <Link
              href="/competitors"
              className="text-sm text-blue-400 hover:underline"
            >
              Go to competitors →
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAdsByCompetitor,
  getAdsNeedingAnalysisCount,
  getAnalysesForCompetitor,
  getCompetitorById,
  getLatestScrapeRun,
  getScoresForCompetitor,
  getSynthesisForCompetitor,
} from "@/lib/db/queries";
import { SynthesisPanel } from "./_components/synthesis-panel";
import { BreakdownTables } from "./_components/breakdown-tables";
import { ANALYZER_VERSION } from "@/lib/ai/analyzers/analyze-creative";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrapeAdsDialog } from "@/components/scrape-ads-dialog";
import { AnalyzeAdsDialog } from "@/components/analyze-ads-dialog";
import { SetMetaPageDialog } from "@/components/set-meta-page-dialog";
import { AdGrid } from "./_components/ad-grid";

export const dynamic = "force-dynamic";

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const competitor = await getCompetitorById(id);
  if (!competitor) notFound();

  const [
    ads,
    lastRun,
    pendingAnalysisCount,
    scoreRows,
    analysisRows,
    synthesis,
  ] = await Promise.all([
    getAdsByCompetitor(id),
    getLatestScrapeRun(id),
    getAdsNeedingAnalysisCount(id, ANALYZER_VERSION),
    getScoresForCompetitor(id),
    getAnalysesForCompetitor(id),
    getSynthesisForCompetitor(id),
  ]);

  // Key both by adId so AdGrid can look each ad's data up in O(1).
  const scores = Object.fromEntries(scoreRows.map((s) => [s.adId, s]));
  const analyses = Object.fromEntries(analysisRows.map((a) => [a.adId, a]));
  // Count of ads with a usable (non-failed) analysis — the synthesizer's input size.
  const analyzedCount = analysisRows.filter(
    (a) => !a.analysisFailedAt && a.hook
  ).length;
  const isDemo = process.env.DEMO_MODE === "true";

  const statusLabel =
    competitor.status === "self"
      ? "Your company"
      : competitor.status === "accepted"
      ? "Accepted"
      : competitor.status === "manual"
      ? "Manual"
      : "Suggested";

  const hasMetaPage = !!competitor.metaPageId;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/competitors" className="text-sm text-muted-foreground hover:text-foreground">
          ← All competitors
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center font-semibold text-xl">
            {competitor.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{competitor.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="outline">{statusLabel}</Badge>
              {competitor.metaPageId && (
                <span className="text-xs text-muted-foreground">
                  Page ID {competitor.metaPageId}
                </span>
              )}
              {competitor.metaPageUrl && (
                <a
                  href={competitor.metaPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:underline"
                >
                  Meta Ad Library →
                </a>
              )}
              {competitor.websiteUrl && (
                <a
                  href={competitor.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:underline"
                >
                  Website →
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasMetaPage ? (
            <>
              <ScrapeAdsDialog
                competitorId={competitor.id}
                competitorName={competitor.name}
                defaultCountry={competitor.country ?? "US"}
                trigger={<Button size="sm">Scrape ads</Button>}
              />
              {pendingAnalysisCount > 0 && (
                <AnalyzeAdsDialog
                  competitorId={competitor.id}
                  competitorName={competitor.name}
                  pendingCount={pendingAnalysisCount}
                  trigger={
                    <Button variant="outline" size="sm">
                      Analyze {pendingAnalysisCount} ad{pendingAnalysisCount === 1 ? "" : "s"}
                    </Button>
                  }
                />
              )}
            </>
          ) : (
            <SetMetaPageDialog
              competitorId={competitor.id}
              competitorName={competitor.name}
              trigger={<Button size="sm">Set Meta page</Button>}
            />
          )}
        </div>
      </header>

      {!hasMetaPage && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm flex items-start gap-3">
          <span className="text-yellow-400 mt-0.5">⚠</span>
          <div>
            <span className="font-medium">No verified Meta page yet.</span>{" "}
            <span className="text-muted-foreground">
              Set a Meta page above before scraping — without it we can&apos;t pull ads.
            </span>
          </div>
        </div>
      )}

      {lastRun && (
        <ScrapeRunStrip
          status={lastRun.status}
          startedAt={lastRun.startedAt}
          adsFound={lastRun.adsFound ?? 0}
          adsNew={lastRun.adsNew ?? 0}
          adsWentInactive={lastRun.adsWentInactive ?? 0}
          errorMessage={lastRun.errorMessage}
        />
      )}

      {competitor.suggestionReason && (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium mb-1">Why this is a competitor</p>
            <p className="text-sm text-muted-foreground">{competitor.suggestionReason}</p>
          </CardContent>
        </Card>
      )}

      {ads.length > 0 && (
        <>
          <SynthesisPanel
            competitorId={competitor.id}
            analyzedCount={analyzedCount}
            synthesis={synthesis}
            ads={ads}
            scores={scores}
            analyses={analyses}
            isDemo={isDemo}
          />
          <BreakdownTables ads={ads} scores={scores} />
        </>
      )}

      {ads.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <p className="text-muted-foreground">
              {lastRun
                ? "No ads scraped on the last run."
                : "No ads scraped yet."}
            </p>
            {hasMetaPage && (
              <p className="text-sm text-muted-foreground">
                Click <span className="text-foreground font-medium">Scrape ads</span> above to pull this brand&apos;s active ads from Meta&apos;s Ad Library.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <AdGrid ads={ads} scores={scores} analyses={analyses} />
      )}
    </div>
  );
}

function ScrapeRunStrip({
  status,
  startedAt,
  adsFound,
  adsNew,
  adsWentInactive,
  errorMessage,
}: {
  status: "success" | "partial" | "failed";
  startedAt: string;
  adsFound: number;
  adsNew: number;
  adsWentInactive: number;
  errorMessage: string | null;
}) {
  const dot =
    status === "success"
      ? "bg-green-500"
      : status === "partial"
      ? "bg-yellow-500"
      : "bg-red-500";

  return (
    <div className="rounded-lg border border-input bg-muted/30 px-4 py-3 text-sm flex items-center gap-3 flex-wrap">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="font-medium">Last scrape</span>
      <span className="text-muted-foreground">{timeAgo(startedAt)}</span>
      <span className="text-muted-foreground">·</span>
      <span>
        {adsFound} found{adsNew > 0 ? `, ${adsNew} new` : ""}
        {adsWentInactive > 0 ? `, ${adsWentInactive} went inactive` : ""}
      </span>
      {errorMessage && (
        <span className="text-red-400 text-xs ml-2">{errorMessage}</span>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  // SQLite's datetime('now') returns UTC without a tz suffix; treat as UTC.
  const normalised = iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z";
  const ms = Date.now() - new Date(normalised).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

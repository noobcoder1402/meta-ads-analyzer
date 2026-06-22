import { redirect } from "next/navigation";
import {
  countCompetitorsNeedingPageSetup,
  getActiveCompetitors,
  getSelfCompetitor,
  getSuggestedCompetitors,
} from "@/lib/db/queries";
import { CompetitorCard } from "@/components/competitor-card";
import { AddCompetitorDialog } from "@/components/add-competitor-dialog";
import { SetMetaPageDialog } from "@/components/set-meta-page-dialog";
import { ScrapeAdsDialog } from "@/components/scrape-ads-dialog";
import { Button } from "@/components/ui/button";
import { CompetitorRowActions } from "./_components/competitor-row-actions";
import { SuggestButton } from "./_components/suggest-button";
import { SuggestionsList } from "./_components/suggestions-list";
import type { Competitor } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Canonical Meta Ad Library URL for a brand (its verified page), for the "View on Meta"
 * link. Prefers the stored canonical URL; falls back to building one from the page id. */
function metaLibraryUrl(c: Competitor): string | null {
  if (c.metaPageUrl) return c.metaPageUrl;
  if (c.metaPageId)
    return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${c.metaPageId}`;
  return null;
}

export default async function CompetitorsPage() {
  if (process.env.DEMO_MODE !== "true") {
    const self = await getSelfCompetitor();
    if (!self) redirect("/onboarding");
  }

  const [all, suggestions, needsPageSetup] = await Promise.all([
    getActiveCompetitors(),
    getSuggestedCompetitors(),
    countCompetitorsNeedingPageSetup(),
  ]);
  const self = all.find((c) => c.status === "self") ?? null;
  const others = all.filter((c) => c.status !== "self");

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Competitors</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {others.length === 0
              ? "Track and analyze competitor ad strategies."
              : `${others.length} tracked. Open one to see ads once scraping is wired up.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddCompetitorDialog />
          <SuggestButton />
        </div>
      </header>

      {needsPageSetup > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm flex items-start gap-3">
          <span className="text-yellow-400 mt-0.5">⚠</span>
          <div>
            <span className="font-medium">Needs your help:</span>{" "}
            <span className="text-muted-foreground">
              {needsPageSetup} of your tracked competitor{needsPageSetup === 1 ? "" : "s"} {needsPageSetup === 1 ? "doesn't" : "don't"} have a verified Meta page yet, so we can&apos;t scrape their ads. Click <span className="text-foreground">Set Meta page</span> on each card below to fix.
            </span>
          </div>
        </div>
      )}

      {self && (
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Your company</h2>
          <div className="max-w-md">
            <CompetitorCard
              competitor={self}
              meta={
                !self.metaPageId ? (
                  <p className="text-xs text-yellow-400">
                    No verified Meta page yet — set one to scrape your own ads.
                  </p>
                ) : null
              }
              primaryAction={
                !self.metaPageId ? (
                  <SetMetaPageDialog
                    competitorId={self.id}
                    competitorName={self.name}
                    trigger={
                      <Button variant="default" size="sm">Set Meta page</Button>
                    }
                  />
                ) : (
                  <a href={metaLibraryUrl(self) ?? "#"} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm">View on Meta ↗</Button>
                  </a>
                )
              }
              secondaryActions={
                self.metaPageId ? (
                  <div className="flex items-center gap-1">
                    <ScrapeAdsDialog
                      competitorId={self.id}
                      competitorName={self.name}
                      trigger={
                        <Button variant="ghost" size="sm">Scrape ads</Button>
                      }
                    />
                  </div>
                ) : null
              }
            />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Tracked competitors ({others.length})
        </h2>
        {others.length === 0 ? (
          <EmptyState hasSuggestions={suggestions.length > 0} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {others.map((c) => (
              <OtherCompetitorCard key={c.id} competitor={c} />
            ))}
          </div>
        )}
      </section>

      {suggestions.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Suggested ({suggestions.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Accept to start tracking · Reject to dismiss
            </p>
          </div>
          <SuggestionsList suggestions={suggestions} />
        </section>
      )}
    </div>
  );
}

function EmptyState({ hasSuggestions }: { hasSuggestions: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="text-muted-foreground">
        {hasSuggestions
          ? "Accept a suggestion above to start tracking."
          : "No competitors tracked yet. Click ✨ Suggest 10 competitors above, or add one manually."}
      </p>
    </div>
  );
}

function OtherCompetitorCard({
  competitor,
}: {
  competitor: Competitor;
}) {
  const needsPage = !competitor.metaPageId;
  return (
    <CompetitorCard
      competitor={competitor}
      meta={
        <>
          {competitor.suggestionReason && <span>{competitor.suggestionReason}</span>}
          {needsPage && (
            <p className="text-xs text-yellow-400 mt-1">
              No verified Meta page yet — scraping won&apos;t work until you set one.
            </p>
          )}
        </>
      }
      primaryAction={
        needsPage ? (
          <SetMetaPageDialog
            competitorId={competitor.id}
            competitorName={competitor.name}
            trigger={
              <Button variant="default" size="sm">
                Set Meta page
              </Button>
            }
          />
        ) : (
          <a href={metaLibraryUrl(competitor) ?? "#"} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">View on Meta ↗</Button>
          </a>
        )
      }
      secondaryActions={
        <div className="flex items-center gap-1 flex-wrap">
          {!needsPage && (
            <ScrapeAdsDialog
              competitorId={competitor.id}
              competitorName={competitor.name}
              trigger={
                <Button variant="ghost" size="sm">
                  Scrape ads
                </Button>
              }
            />
          )}
          <CompetitorRowActions competitorId={competitor.id} />
        </div>
      }
    />
  );
}

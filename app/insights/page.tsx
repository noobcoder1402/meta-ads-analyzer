import {
  getRecommendations,
  getSynthesesForActiveCompetitors,
} from "@/lib/db/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Recommendation } from "@/lib/db/schema";
import { RecommendationsPanel } from "./_components/recommendations-panel";
import { CompetitorScoreboard } from "./_components/competitor-scoreboard";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const isDemo = process.env.DEMO_MODE === "true";
  const [recs, syntheses] = await Promise.all([
    getRecommendations(),
    getSynthesesForActiveCompetitors(),
  ]);
  const lastGeneratedAt = recs[0]?.lastGeneratedAt ?? null;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-generated GTM recommendations from comparing your positioning against
            every tracked competitor.
            {lastGeneratedAt ? ` · Last generated ${timeAgo(lastGeneratedAt)}` : ""}
          </p>
        </div>
      </header>

      <RecommendationsPanel hasRecommendations={recs.length > 0} isDemo={isDemo} />

      <CompetitorScoreboard rows={syntheses} />

      {recs.length === 0 ? (
        <EmptyState isDemo={isDemo} />
      ) : (
        <div className="space-y-4">
          {recs.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold leading-snug">{rec.title}</h2>
          <PriorityBadge priority={rec.priority} />
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
          {rec.rationale}
        </p>

        {rec.evidenceAdIds.length > 0 && (
          <div className="pt-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Evidence ({rec.evidenceAdIds.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {rec.evidenceAdIds.map((id) => (
                <a
                  key={id}
                  href={`https://www.facebook.com/ads/library/?id=${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex"
                >
                  <Badge
                    variant="outline"
                    className="text-[11px] font-mono hover:bg-accent transition-colors"
                  >
                    {id} ↗
                  </Badge>
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriorityBadge({ priority }: { priority: Recommendation["priority"] }) {
  const variant =
    priority === "high" ? "destructive" : priority === "medium" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="shrink-0 capitalize">
      {priority}
    </Badge>
  );
}

function EmptyState({ isDemo }: { isDemo: boolean }) {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-2">
        <p className="text-sm font-medium">No recommendations yet</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {isDemo
            ? "This demo has no generated recommendations."
            : "Synthesize at least one competitor (the “Find patterns” button on a competitor page), then click “Generate recommendations” above."}
        </p>
      </CardContent>
    </Card>
  );
}

function timeAgo(iso: string): string {
  const normalised = iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z";
  const ms = Date.now() - new Date(normalised).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

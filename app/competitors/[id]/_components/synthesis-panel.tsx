"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Ad, AdAnalysis, CompetitorSynthesis } from "@/lib/db/schema";
import { classify } from "@/lib/scoring/buckets";
import { angleLabel, angleBlurb } from "@/lib/ai/angle-info";
import type { AdScore } from "./ad-detail-dialog";
import { AdCard } from "./ad-card";

type Props = {
  competitorId: string;
  analyzedCount: number;
  synthesis: CompetitorSynthesis | null;
  ads: Ad[];
  scores: Record<string, AdScore>;
  analyses: Record<string, AdAnalysis>;
  isDemo: boolean;
};

/** How many ad cards to show inline per hero section before deferring to the grid. */
const CARD_LIMIT = 6;

export function SynthesisPanel({
  competitorId,
  analyzedCount,
  synthesis,
  ads,
  scores,
  analyses,
  isDemo,
}: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/synthesize`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Synthesis failed.");
      } else if (data?.status === "skipped") {
        setError(data?.reason ?? "Nothing to synthesize.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  const canRun = !isDemo && !running && analyzedCount > 0;
  const label = running
    ? "Finding patterns…"
    : synthesis
    ? "Refresh patterns"
    : "Find patterns";

  // Winners, Tried-&-dropped, and What's-new are all derived straight from the ad
  // data (grouped by angle), so they render even before "Find patterns" has run.
  // Only the Profile fact-sheet needs the synthesis.
  const { winnerGroups, droppedGroups, recent, recentAngles } = useMemo(
    () => deriveHeroSections(ads, scores, analyses),
    [ads, scores, analyses]
  );

  return (
    <Card>
      <CardContent className="p-5 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Ad strategy</h2>
            <p className="text-sm text-muted-foreground">
              {analyzedCount > 0
                ? `Based on ${analyzedCount} analyzed ad${analyzedCount === 1 ? "" : "s"}${
                    synthesis ? ` · patterns updated ${timeAgo(synthesis.updatedAt)}` : ""
                  }`
                : "Analyze this competitor's ads first — there's nothing to summarize yet."}
            </p>
          </div>
          <Button size="sm" onClick={run} disabled={!canRun}>
            {label}
          </Button>
        </div>

        {isDemo && (
          <p className="text-xs text-muted-foreground">
            Pattern-finding is disabled in the read-only demo.
          </p>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {analyzedCount > 0 && (
          <>
            {/* Plain-English takeaway (needs the synthesis tallies). */}
            {synthesis && <Takeaway s={synthesis} />}

            {/* ── 🏆 WINNERS ── grouped by angle, each with example creatives ── */}
            <Section
              emoji="🏆"
              title="Winners — what's working"
              sub="Their proven creative, grouped by angle: high-scoring ads still running after 60+ days."
            >
              {winnerGroups.length === 0 ? (
                <Empty>No live always-on winners — no currently-running ad has both scored high and run 60+ days. (Proven ads that were since paused appear in the full list below.)</Empty>
              ) : (
                <AngleGroups
                  groups={winnerGroups}
                  scores={scores}
                  analyses={analyses}
                  maxAngles={6}
                />
              )}
            </Section>

            {/* ── ⚰️ TRIED & DROPPED ── grouped by angle, each with example creatives ── */}
            <Section
              emoji="⚰️"
              title="Tried & dropped — what they backed away from"
              sub="Angles they tested, then stopped running — with the actual creatives."
            >
              {droppedGroups.length === 0 ? (
                <Empty>Nothing notable dropped — their angles have been stable.</Empty>
              ) : (
                <AngleGroups
                  groups={droppedGroups}
                  scores={scores}
                  analyses={analyses}
                  maxAngles={5}
                />
              )}
            </Section>

            {/* ── 🆕 WHAT'S NEW ── */}
            <Section
              emoji="🆕"
              title="What's new — recent launches"
              sub={
                recent.length > 0
                  ? `${recent.length} ad${recent.length === 1 ? "" : "s"} launched in the last 30 days.`
                  : "No new ads in the last 30 days."
              }
            >
              {recent.length > 0 && (
                <>
                  {recentAngles.length > 0 && (
                    <RecentAngleSummary angles={recentAngles} />
                  )}
                  <AdCardGrid items={recent} scores={scores} analyses={analyses} />
                </>
              )}
            </Section>

            {/* ── PROFILE (secondary, cleaned up) ── */}
            {synthesis && <Profile s={synthesis} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Hero-section derivation (pure, from the ad data) ──────────────────

type AdView = Ad & { _score: number };
/** One angle plus the ads that use it, used by the grouped Winners / Dropped sections. */
type AngleGroup = { code: string; ads: AdView[] };

function deriveHeroSections(
  ads: Ad[],
  scores: Record<string, AdScore>,
  analyses: Record<string, AdAnalysis>
): {
  winnerGroups: AngleGroup[];
  droppedGroups: AngleGroup[];
  recent: Ad[];
  recentAngles: { code: string; count: number }[];
} {
  // Winners = the strict "always-on" tag: LIVE, score ≥70, 60+ days. Dropped = paused
  // ads that aren't proven Winners (the flopped + retired buckets — what they tested
  // then stopped running). Both are then grouped by angle so each angle shows its
  // own example creatives.
  const winners: AdView[] = [];
  const dropped: AdView[] = [];
  for (const ad of ads) {
    const score = scores[ad.id];
    if (!score) continue;
    const { bucket, tags } = classify(ad, score.score, analyses[ad.id] ?? null);
    if (tags.includes("always-on")) {
      winners.push({ ...ad, _score: score.score });
    } else if (!ad.isActive && bucket !== "winner") {
      dropped.push({ ...ad, _score: score.score });
    }
  }

  const winnerGroups = groupByAngle(winners, analyses);
  const droppedGroups = groupByAngle(dropped, analyses);

  // Recent = live ads launched in the last 30 days, newest first. (daysActive on a
  // LIVE ad = days since Meta's start_date = real launch recency.)
  const live = ads.filter((a) => a.isActive);
  const newestFirst = (a: Ad, b: Ad) => a.daysActive - b.daysActive;
  const recent = live.filter((a) => a.daysActive <= 30).sort(newestFirst);

  // Top angles among the recent launches — the "what are they pushing now" read.
  const recentAngleCounts = new Map<string, number>();
  for (const r of recent) {
    const angle = analyses[r.id]?.angle;
    if (angle) recentAngleCounts.set(angle, (recentAngleCounts.get(angle) ?? 0) + 1);
  }
  const recentAngles = [...recentAngleCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return { winnerGroups, droppedGroups, recent, recentAngles };
}

/**
 * Group ads by their analyzed angle, best-scoring ad first within each group, and
 * order the groups by how many ads use that angle. Only analyzed ads (those with an
 * angle) participate — an unanalyzed ad has no angle to group under.
 */
function groupByAngle(
  items: AdView[],
  analyses: Record<string, AdAnalysis>
): AngleGroup[] {
  const map = new Map<string, AdView[]>();
  for (const ad of items) {
    const angle = analyses[ad.id]?.angle;
    if (!angle) continue;
    const arr = map.get(angle) ?? [];
    arr.push(ad);
    map.set(angle, arr);
  }
  return [...map.entries()]
    .map(([code, arr]) => ({
      code,
      ads: arr.sort((a, b) =>
        b._score !== a._score ? b._score - a._score : b.daysActive - a.daysActive
      ),
    }))
    .sort((a, b) => b.ads.length - a.ads.length);
}

// ─── Hero sub-components ───────────────────────────────────────────────

function Section({
  emoji,
  title,
  sub,
  children,
}: {
  emoji: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <span aria-hidden>{emoji}</span>
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Renders each angle as its own labeled block — angle name + plain-English blurb,
 * then 2-3 example creatives underneath it — so you read "this play, with these
 * ads" rather than a wall of thumbnails. Groups are ordered by ad count; each shows
 * up to `perAngle` creatives with a "+N more" pointer to the full list below.
 */
function AngleGroups({
  groups,
  scores,
  analyses,
  maxAngles,
  perAngle = 3,
}: {
  groups: AngleGroup[];
  scores: Record<string, AdScore>;
  analyses: Record<string, AdAnalysis>;
  maxAngles: number;
  perAngle?: number;
}) {
  return (
    <div className="space-y-5">
      {groups.slice(0, maxAngles).map((g) => {
        const shown = g.ads.slice(0, perAngle);
        const extra = g.ads.length - shown.length;
        return (
          <div key={g.code} className="space-y-2.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-medium">{angleLabel(g.code)}</span>
              <span className="text-sm text-muted-foreground">
                — {angleBlurb(g.code)}
              </span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {g.ads.length} ad{g.ads.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shown.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  score={scores[ad.id] ?? null}
                  analysis={analyses[ad.id] ?? null}
                />
              ))}
            </div>
            {extra > 0 && (
              <p className="text-xs text-muted-foreground">
                + {extra} more {angleLabel(g.code)} ad{extra === 1 ? "" : "s"} in the
                full list below.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One-line plain-English summary of what kind of ads they're launching now — names
 * the dominant angle(s) among the recent set. Mirrors the Winners "Mostly these
 * plays" read, but as a single sentence (it's a quick orientation, not a full table).
 */
function RecentAngleSummary({
  angles,
}: {
  angles: { code: string; count: number }[];
}) {
  const labels = angles.map((a) => angleLabel(a.code));
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Mostly </span>
      {labels.map((label, i) => (
        <span key={i}>
          <span className="font-medium">{label}</span>
          {listJoiner(i, labels.length)}
        </span>
      ))}
      <span className="text-muted-foreground">
        {labels.length === 1 ? " angle." : " angles."}
      </span>
    </p>
  );
}

/** Grammatical connector between item `i` and the next in a list of length `n`. */
function listJoiner(i: number, n: number): string {
  if (i === n - 1) return ""; // last item
  if (i === n - 2) return n === 2 ? " and " : ", and ";
  return ", ";
}

/** A capped grid of ad cards with a "+N more" note pointing at the full grid. */
function AdCardGrid({
  items,
  scores,
  analyses,
}: {
  items: Ad[];
  scores: Record<string, AdScore>;
  analyses: Record<string, AdAnalysis>;
}) {
  const shown = items.slice(0, CARD_LIMIT);
  const extra = items.length - shown.length;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            score={scores[ad.id] ?? null}
            analysis={analyses[ad.id] ?? null}
          />
        ))}
      </div>
      {extra > 0 && (
        <p className="text-xs text-muted-foreground">
          + {extra} more in the full ad list below.
        </p>
      )}
    </div>
  );
}

// ─── Takeaway headline (plain English, from the synthesis tallies) ─────

function Takeaway({ s }: { s: CompetitorSynthesis }) {
  const topAngle = sortedEntries(s.dominantAngles)[0];
  // "Selling motion" is the raw Meta CTA button (e.g. "Sign Up"), not a goal label.
  const topCta = sortedEntries(s.dominantCtas)[0];
  const topVoice = sortedEntries(s.dominantBrandVoice)[0];
  if (!topAngle && !topCta && !topVoice) return null;

  return (
    <p className="text-base leading-relaxed">
      {topAngle && (
        <>
          Mostly{" "}
          <span className="font-semibold">{angleLabel(topAngle[0])}</span> ads{" "}
          <span className="text-muted-foreground">
            ({pctOf(topAngle[1], sortedEntries(s.dominantAngles))}%)
          </span>
        </>
      )}
      {topCta && (
        <>
          {topAngle ? ", with a " : "With a "}
          <span className="font-semibold">{topCta[0]}</span> button
        </>
      )}
      {topVoice && (
        <>
          {", in a "}
          <span className="font-semibold">{topVoice[0]}</span> voice
        </>
      )}
      .
    </p>
  );
}

// ─── Profile (secondary dimensions, cleaned into a fact sheet) ─────────

function Profile({ s }: { s: CompetitorSynthesis }) {
  const voice = sortedEntries(s.dominantBrandVoice)[0];
  // Raw Meta CTA buttons ("Sign Up", "Learn More") — the user-facing selling motion.
  const ctas = sortedEntries(s.dominantCtas);
  const angles = sortedEntries(s.dominantAngles);
  const pains = s.topPainPoints ?? [];
  const benefits = s.topBenefits ?? [];
  const mediaMix = s.mediaMix;

  return (
    <section className="space-y-4 border-t border-border pt-5">
      <h3 className="text-base font-semibold">Profile</h3>

      {/* How they sell — one compact row of facts. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Fact label="Voice">{voice ? cap(voice[0]) : "—"}</Fact>
        <Fact label="Selling motion">
          {ctas.length > 0
            ? ctas
                .slice(0, 3)
                .map(([c, n]) => `${pctOf(n, ctas)}% ${c}`)
                .join(" · ")
            : "—"}
        </Fact>
        <Fact label="Media mix">
          {mediaMix && mediaMix.total > 0 ? mediaMixText(mediaMix) : "—"}
        </Fact>
      </div>

      {/* What they emphasize. */}
      {(pains.length > 0 || benefits.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pains.length > 0 && (
            <ChipList label="Pain points they hammer" items={pains} />
          )}
          {benefits.length > 0 && (
            <ChipList label="Benefits they promise" items={benefits} />
          )}
        </div>
      )}

      {/* Localization (shown once). */}
      <LanguagesSection languages={s.creativeLanguages} />

      {/* Full angle distribution — compact, collapsed by default. */}
      {angles.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            All angles ({angles.length})
          </summary>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {angles.map(([code, count]) => (
              <Badge key={code} variant="secondary" className="text-[11px]">
                {angleLabel(code)}
                <span className="text-muted-foreground ml-1">
                  {pctOf(count, angles)}%
                </span>
              </Badge>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="text-sm font-medium mt-0.5">{children}</div>
    </div>
  );
}

function ChipList({
  label,
  items,
}: {
  label: string;
  items: { value: string; count: number }[];
}) {
  return (
    <div>
      <SubLabel>{label}</SubLabel>
      <div className="flex flex-wrap gap-1.5">
        {items.map((e) => (
          <Badge key={e.value} variant="secondary" className="text-[11px]">
            {e.value}
            {e.count > 1 && (
              <span className="text-muted-foreground ml-1">×{e.count}</span>
            )}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function LanguagesSection({
  languages,
}: {
  languages: CompetitorSynthesis["creativeLanguages"];
}) {
  if (!languages || languages.languageCount === 0) return null;
  const { languages: langs, detectedFrom, undetected } = languages;

  return (
    <div>
      <SubLabel>Languages they write in</SubLabel>
      <div className="flex flex-wrap gap-1.5">
        {langs.map((l) => (
          <Badge
            key={l.code}
            variant={l.minor ? "outline" : "secondary"}
            className={`text-[11px] ${l.minor ? "text-muted-foreground" : ""}`}
            title={
              l.minor
                ? `Incidental — only ${l.count} ad${l.count === 1 ? "" : "s"}`
                : `${l.count} of ${detectedFrom} detected ads`
            }
          >
            <span className="mr-1">{l.flag}</span>
            {l.label}
            <span className="text-muted-foreground ml-1">
              {l.minor ? "minor" : `${Math.round(l.share * 100)}%`}
            </span>
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">
        How deeply they localize creative — not which countries they target.
        {undetected > 0 &&
          ` ${undetected} ad${undetected === 1 ? "" : "s"} had too little text to detect.`}
      </p>
    </div>
  );
}

// ─── Small shared bits ─────────────────────────────────────────────────

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
      {children}
    </p>
  );
}

function mediaMixText(m: NonNullable<CompetitorSynthesis["mediaMix"]>): string {
  const pct = (n: number) => Math.round((n / m.total) * 100);
  return [
    m.video > 0 ? `${pct(m.video)}% video` : null,
    m.image > 0 ? `${pct(m.image)}% image` : null,
    m.carousel > 0 ? `${pct(m.carousel)}% carousel` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pctOf(count: number, entries: [string, number][]): number {
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  return Math.round((count / total) * 100);
}

function sortedEntries(rec: Record<string, number> | null): [string, number][] {
  if (!rec) return [];
  return Object.entries(rec).sort((a, b) => b[1] - a[1]);
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

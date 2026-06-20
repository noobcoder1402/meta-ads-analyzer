import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { angleLabel } from "@/lib/ai/angle-info";
import type { CompetitorWithSynthesis } from "@/lib/db/queries";

/**
 * Deterministic (non-AI) side-by-side of every active competitor, the user (`self`)
 * pinned and highlighted at top. Every number is read straight from the saved
 * `competitor_syntheses` rows — no AI call, no cost, always reflects the last
 * "Find patterns" run. Complements the AI Recommendations (which compare you vs the
 * field narratively) with a scannable scoreboard of everyone vs everyone.
 *
 * Honest-data rules:
 *   - A competitor WITHOUT a synthesis renders a muted "not analyzed yet" row — we
 *     never silently drop it (you should see who's missing, not mistake them for empty).
 *   - If NOBODY has been synthesized, we show a nudge instead of an empty table.
 *   - The messaging-overlap highlight only fires on an EXACT (normalized) match, so a
 *     shared pain point / benefit is real, not fuzzy-guessed.
 */
export function CompetitorScoreboard({
  rows,
}: {
  rows: CompetitorWithSynthesis[];
}) {
  // Pre-onboarding (no competitors at all) → render nothing.
  if (rows.length === 0) return null;

  const analyzed = rows.filter((r) => r.synthesis !== null);

  // Pain points / benefits shared by 2+ companies (exact, normalized match). These get
  // a highlight — they mark where the field is crowding (or, by absence, the whitespace).
  // Computed over the SAME top-2 slice we display, so every ◆ has a visible twin on
  // another row (highlighting a match hidden off-screen would read as a bug).
  const sharedPains = sharedValues(analyzed, (s) => (s.topPainPoints ?? []).slice(0, 2));
  const sharedBenefits = sharedValues(analyzed, (s) => (s.topBenefits ?? []).slice(0, 2));

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Competitor scoreboard</h2>
          <p className="text-sm text-muted-foreground">
            Every tracked company side-by-side — rolled up from each one&apos;s{" "}
            <span className="text-foreground font-medium">Find patterns</span> run
            (no AI, no cost). Highlighted pain points / benefits are ones two or more
            companies share.
          </p>
        </div>

        {analyzed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No company has been analyzed yet. Run{" "}
            <span className="text-foreground font-medium">Find patterns</span> on a
            competitor (and on your own{" "}
            <span className="text-foreground font-medium">self</span> card) to populate
            this.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <Th className="sticky left-0 bg-card z-10">Company</Th>
                  <Th align="right">Ads</Th>
                  <Th>Media mix</Th>
                  <Th align="right">New (14d / 30d)</Th>
                  <Th align="right">Langs</Th>
                  <Th>Top CTA</Th>
                  <Th>Top voice</Th>
                  <Th>Top angle</Th>
                  <Th>Top pain points</Th>
                  <Th>Top benefits</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row
                    key={r.competitorId}
                    row={r}
                    sharedPains={sharedPains}
                    sharedBenefits={sharedBenefits}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  row,
  sharedPains,
  sharedBenefits,
}: {
  row: CompetitorWithSynthesis;
  sharedPains: Set<string>;
  sharedBenefits: Set<string>;
}) {
  const isSelf = row.status === "self";
  const rowClass = isSelf
    ? "border-b border-border bg-primary/5"
    : "border-b border-border";

  const nameCell = (
    <Td className={`sticky left-0 z-10 ${isSelf ? "bg-[#1b1d23]" : "bg-card"}`}>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="font-medium">{row.name}</span>
        {isSelf && (
          <Badge variant="secondary" className="text-[10px]">
            You
          </Badge>
        )}
      </div>
      {row.synthesis && (
        <span className="text-[11px] text-muted-foreground">
          synthesized {timeAgo(row.synthesis.updatedAt)}
        </span>
      )}
    </Td>
  );

  // Not analyzed yet → honest muted row, no fabricated numbers.
  if (!row.synthesis) {
    return (
      <tr className={`${rowClass} text-muted-foreground`}>
        {nameCell}
        <td colSpan={9} className="px-3 py-2.5 text-xs italic">
          Not analyzed yet — run “Find patterns” on this competitor.
        </td>
      </tr>
    );
  }

  const s = row.synthesis;
  const mix = s.mediaMix;
  const vel = s.launchVelocity;
  const pains = (s.topPainPoints ?? []).slice(0, 2);
  const benefits = (s.topBenefits ?? []).slice(0, 2);

  return (
    <tr className={rowClass}>
      {nameCell}
      <Td align="right">{s.adsAnalyzedCount ?? "—"}</Td>
      <Td>
        <MediaMix mix={mix} />
      </Td>
      <Td align="right" className="whitespace-nowrap">
        {vel ? `${vel.last14} / ${vel.last30}` : "—"}
      </Td>
      <Td align="right">{s.creativeLanguages?.languageCount || "—"}</Td>
      <Td>{topKey(s.dominantCtas) ?? "—"}</Td>
      <Td>{voiceLabel(topKey(s.dominantBrandVoice))}</Td>
      <Td>{angleLabel(topKey(s.dominantAngles))}</Td>
      <Td>
        <ValueList items={pains} shared={sharedPains} />
      </Td>
      <Td>
        <ValueList items={benefits} shared={sharedBenefits} />
      </Td>
    </tr>
  );
}

function MediaMix({
  mix,
}: {
  mix: { image: number; video: number; carousel: number; total: number } | null;
}) {
  if (!mix || !mix.total) return <span className="text-muted-foreground">—</span>;
  const pct = (n: number) => Math.round((n / mix.total) * 100);
  const parts: string[] = [];
  if (mix.video) parts.push(`🎬 ${pct(mix.video)}%`);
  if (mix.image) parts.push(`🖼 ${pct(mix.image)}%`);
  if (mix.carousel) parts.push(`🎠 ${pct(mix.carousel)}%`);
  return <span className="whitespace-nowrap text-xs">{parts.join(" · ")}</span>;
}

function ValueList({
  items,
  shared,
}: {
  items: Array<{ value: string; count: number }>;
  shared: Set<string>;
}) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {items.map((it) => {
        const isShared = shared.has(normalize(it.value));
        return (
          <span
            key={it.value}
            className={
              isShared
                ? "text-amber-400 text-xs"
                : "text-foreground text-xs"
            }
            title={isShared ? "Two or more companies share this" : undefined}
          >
            {it.value}
            {isShared && <span className="ml-1">◆</span>}
          </span>
        );
      })}
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

/** Highest-count key of a distribution map ({ "comparison": 12, ... }), or null. */
function topKey(dist: Record<string, number> | null | undefined): string | null {
  if (!dist) return null;
  let best: string | null = null;
  let bestN = -Infinity;
  for (const [k, n] of Object.entries(dist)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/** Brand voice has no shared label map; title-case the raw code. */
function voiceLabel(code: string | null): string {
  if (!code) return "—";
  return code
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Normalize a pain/benefit string for exact cross-company matching. */
function normalize(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * The set of normalized pain/benefit values that appear (in any company's top list)
 * for two or more DISTINCT companies. Exact match only — never fuzzy.
 */
function sharedValues(
  analyzed: CompetitorWithSynthesis[],
  pick: (s: NonNullable<CompetitorWithSynthesis["synthesis"]>) => Array<{
    value: string;
    count: number;
  }> | null
): Set<string> {
  const companiesPerValue = new Map<string, Set<string>>();
  for (const r of analyzed) {
    const items = pick(r.synthesis!) ?? [];
    // Dedup within a company first so one company can't count twice.
    const seen = new Set<string>();
    for (const it of items) {
      const key = normalize(it.value);
      if (seen.has(key)) continue;
      seen.add(key);
      const set = companiesPerValue.get(key) ?? new Set<string>();
      set.add(r.competitorId);
      companiesPerValue.set(key, set);
    }
  }
  const shared = new Set<string>();
  for (const [key, companies] of companiesPerValue) {
    if (companies.size >= 2) shared.add(key);
  }
  return shared;
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 font-medium text-xs uppercase tracking-wide ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 align-top ${
        align === "right" ? "text-right tabular-nums" : "text-left"
      } ${className}`}
    >
      {children}
    </td>
  );
}

function timeAgo(iso: string): string {
  const normalised =
    iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z";
  const ms = Date.now() - new Date(normalised).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

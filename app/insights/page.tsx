import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadCrossAnalysis, type BrandAds } from "@/lib/analysis/load";
import type { CompetitorAnalysis } from "@/lib/analysis/analyze-competitor";
import type { CrossAnalysis } from "@/lib/analysis/analyze-across";
import type { AnalysisAd } from "@/lib/analysis/types";
import {
  allCopy,
  ctaMix,
  copyLengthMix,
  inSegment,
  landingPages,
  mediaMix,
  placementSpread,
  structureMix,
  type Segment,
} from "@/lib/analysis/metrics";
import { topPhrases } from "@/lib/analysis/phrases";
import { aggregateLanguages } from "@/lib/lang/detect-languages";
import {
  ComparisonTable,
  type BrandColumn,
  type ComparisonRow,
} from "./_components/comparison-table";
import { SelfGapTable } from "./_components/self-gap-table";
import { CompanyScaleTable } from "./_components/company-scale-table";
import { StrategicInsightsPanel } from "./_components/strategic-insights";
import { getLatestInsightReport } from "@/lib/db/queries";
import { fingerprintBundle } from "@/lib/ai/analyzers/generate-insights";
import { StrategicInsightsSchema, type StrategicInsights } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

/** Below this many ads in a segment, the shares are too noisy to trust — grey them out. */
const MIN_SAMPLE = 8;

// ─── formatting helpers ──────────────────────────────────────────────
const pct = (n: number) => `${Math.round(n * 100)}%`;

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

type MiniTally = { label: string; count: number; share: number };

/** Pivot per-item tallies into rows (category down the left, item across the top).
 * Categories are ranked by total count (or by an explicit `order`); a missing category → null. */
function pivot<T>(
  items: T[],
  get: (x: T) => MiniTally[],
  opts: { max?: number; order?: string[] } = {},
): ComparisonRow[] {
  const per = items.map(get);
  const totals = new Map<string, number>();
  for (const ts of per) for (const t of ts) totals.set(t.label, (totals.get(t.label) ?? 0) + t.count);
  let labels = [...totals.keys()];
  const order = opts.order;
  if (order) {
    const idx = (l: string) => {
      const i = order.indexOf(l);
      return i === -1 ? order.length : i;
    };
    labels.sort(
      (a, b) => idx(a) - idx(b) || (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b),
    );
  } else {
    labels.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b));
  }
  if (opts.max) labels = labels.slice(0, opts.max);
  return labels.map((label) => ({
    label,
    values: per.map((ts) => {
      const t = ts.find((x) => x.label === label);
      return t ? `${pct(t.share)} · ${t.count}` : null;
    }),
  }));
}

/** Rows where each row is a rank (#1, #2, …) and each cell is that item's nth entry —
 * for cross-brand "top landing pages" where brands share no common categories. */
function rankRows<T>(items: T[], getTop: (x: T) => MiniTally[], maxRank: number): ComparisonRow[] {
  return Array.from({ length: maxRank }, (_, i) => ({
    label: `#${i + 1}`,
    values: items.map((x) => {
      const t = getTop(x)[i];
      return t ? `${truncate(t.label, 40)} · ${t.count}` : null;
    }),
  }));
}

/** Top repeated phrases for one set of ads, as MiniTally (share = % of ads in the set). */
function phraseTally(ads: AnalysisAd[], max = 8): MiniTally[] {
  const n = ads.length;
  return topPhrases(
    ads.map((a) => allCopy(a)),
    { top: max },
  ).map((p) => ({ label: p.phrase, count: p.count, share: n > 0 ? p.count / n : 0 }));
}

/** A simple scalar row: one number/string per brand (or null → "—"). */
function scalarRow(
  label: string,
  analyses: CompetitorAnalysis[],
  get: (a: CompetitorAnalysis) => string | number | null,
  opts: { hint?: string; strong?: boolean } = {},
): ComparisonRow {
  return {
    label,
    hint: opts.hint,
    strong: opts.strong,
    values: analyses.map((a) => {
      const v = get(a);
      return v === null ? null : String(v);
    }),
  };
}

function Section({
  title,
  description,
  analysis,
  tag,
  children,
}: {
  title: string;
  description?: string;
  analysis?: string;
  /** Small badge shown next to the title (e.g. the active segment filter). */
  tag?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {title}
          {tag}
        </CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        {analysis && (
          <div className="rounded-md border-l-2 border-primary/50 bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">Read: </span>
            <span className="text-muted-foreground">{analysis}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── deterministic per-section "reads" (no AI — templated from the numbers) ──
const name = (a: CompetitorAnalysis) => a.competitorName;

function maxByNum(analyses: CompetitorAnalysis[], f: (a: CompetitorAnalysis) => number): CompetitorAnalysis {
  return analyses.reduce((best, a) => (f(a) > f(best) ? a : best), analyses[0]);
}

const mediaShare = (a: CompetitorAnalysis, label: string) =>
  a.creative.media.find((s) => s.label === label)?.share ?? 0;
const structShare = (a: CompetitorAnalysis, label: string) =>
  a.creative.structure.find((s) => s.label === label)?.share ?? 0;
const copyShare = (a: CompetitorAnalysis, label: string) =>
  a.creative.copyLength.find((t) => t.label === label)?.share ?? 0;
const provenCount = (a: CompetitorAnalysis) =>
  a.longevity.tiers
    .filter((t) => t.key === "proven" || t.key === "hallOfFame")
    .reduce((s, t) => s + t.count, 0);
const testingShare = (a: CompetitorAnalysis) => {
  const live = a.longevity.liveCount;
  const t = a.longevity.tiers.find((x) => x.key === "testing");
  return live > 0 ? (t?.count ?? 0) / live : 0;
};
const provenShare = (a: CompetitorAnalysis) =>
  a.longevity.liveCount > 0 ? provenCount(a) / a.longevity.liveCount : 0;

// All reads below state defensible FACTS only — a leader on a clearly-defined metric, or
// a ranked list. No causal/behavioural inference ("stops ads early", "leans on") and no
// confounded raw counts (raw volume is inflated by ad-duplication build style), so we
// lean on the de-confounded numbers (distinct creatives) and within-brand shares.

function overviewRead(analyses: CompetitorAnalysis[]): string {
  const byDc = [...analyses].sort((a, b) => b.distinctLiveCreatives - a.distinctLiveCreatives);
  const dc = byDc.map((a) => `${name(a)} ${a.distinctLiveCreatives}`).join(", ");
  return `Unique active ads, with duplicates removed (each ad counted once): ${dc}. This is the fairest way to compare volume — a brand that reruns the same ad across many campaigns won't look bigger than it is.`;
}

function longevityRead(analyses: CompetitorAnalysis[]): string {
  const newest = maxByNum(analyses, testingShare);
  const seasoned = maxByNum(analyses, provenShare);
  return `${name(newest)} has the highest share of brand-new running ads (${pct(testingShare(newest))} under 30 days). ${name(seasoned)} has the highest share of ads running 90+ days (${pct(provenShare(seasoned))}). A long run isn't proof an ad works — Meta shows no spend or results — it only means the ad is still up.`;
}

function mediaRead(analyses: CompetitorAnalysis[]): string {
  const vid = maxByNum(analyses, (a) => mediaShare(a, "Video"));
  const s = mediaShare(vid, "Video");
  if (s < 0.1) return "Every brand is image-first; video is a small share for all.";
  return `${name(vid)} has the highest video share (${pct(s)} of its ads); the others are more image-weighted.`;
}

function structureRead(analyses: CompetitorAnalysis[]): string {
  const dco = maxByNum(analyses, (a) => structShare(a, "Dynamic creative (DCO)"));
  const s = structShare(dco, "Dynamic creative (DCO)");
  if (s < 0.1) return "All brands build mostly single image or video ads; dynamic creative (one ad that rotates several versions) is rare.";
  return `${name(dco)} has the highest share of dynamic-creative ads (${pct(s)}) — one ad that rotates several versions automatically.`;
}

function ctaRead(analyses: CompetitorAnalysis[]): string {
  const tops = analyses.filter((a) => a.cta[0]).map((a) => `${name(a)} → “${a.cta[0].label}”`);
  return tops.length ? `Top call-to-action by brand: ${tops.join("; ")}.` : "No CTA data yet.";
}

function placementRead(analyses: CompetitorAnalysis[]): string {
  const broad = maxByNum(analyses, (a) => a.placements.length);
  if (broad.placements.length === 0) return "No placement data yet.";
  return `${name(broad)} spreads across the most surfaces (${broad.placements.length}: ${broad.placements
    .map((p) => p.label)
    .join(", ")}); the others concentrate on fewer.`;
}

function copyRead(analyses: CompetitorAnalysis[]): string {
  const short = maxByNum(analyses, (a) => copyShare(a, "Short"));
  const long = maxByNum(analyses, (a) => copyShare(a, "Long"));
  return `${name(short)} has the highest share of short copy (${pct(copyShare(short, "Short"))}); ${name(long)} the highest share of long copy (${pct(copyShare(long, "Long"))}).`;
}

function languageRead(analyses: CompetitorAnalysis[]): string {
  const multi = maxByNum(analyses, (a) => a.languages.languageCount);
  const others = multi.languages.languages.filter((l) => l.code !== "eng").map((l) => l.label);
  if (others.length === 0) return "Every brand advertises almost entirely in English.";
  return `${name(multi)} localizes the most (${multi.languages.languageCount} languages — beyond English: ${others.slice(0, 3).join(", ")}). The others run mostly English.`;
}

function landingRead(brands: BrandAds[]): string {
  const tops = brands
    .map((b) => {
      const top = landingPages(b.ads, 1)[0];
      return top ? `${b.name} → ${top.label} (${top.count})` : null;
    })
    .filter((s): s is string => !!s);
  return tops.length ? `Most-advertised landing page by brand: ${tops.join("; ")}.` : "";
}

function messagingRead(brands: BrandAds[]): string {
  const tops = brands
    .map((b) => {
      const top = phraseTally(b.ads, 3).map((p) => `“${p.label}”`);
      return top.length ? `${b.name} → ${top.join(", ")}` : null;
    })
    .filter((s): s is string => !!s);
  return tops.length ? `Most-repeated phrases by brand: ${tops.join("; ")}.` : "";
}

function gapRead(cross: CrossAnalysis): string {
  const all = (Object.keys(cross.gaps) as (keyof CrossAnalysis["gaps"])[])
    .flatMap((area) => cross.gaps[area])
    .sort((a, b) => b.delta - a.delta);
  if (!all.length) return "Your mix matches the competitors on every area we measure.";
  const top = all[0];
  return `Your biggest gap: rivals use “${top.label}” on ${pct(top.competitorShare)} of ads vs your ${pct(top.selfShare)} — a ${pct(top.delta)} gap.`;
}

// ─── segment toggle (server-rendered links — no client state) ────────
const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "all", label: "All ads" },
  { key: "active", label: "Active ads" },
  { key: "inactive", label: "Inactive ads" },
];

function SegmentToggle({ current }: { current: Segment }) {
  return (
    <div className="inline-flex rounded-md border border-input bg-muted/30 p-0.5 text-sm">
      {SEGMENTS.map((o) => (
        <Link
          key={o.key}
          href={o.key === "all" ? "/insights" : `/insights?segment=${o.key}`}
          scroll={false}
          className={cn(
            "rounded px-3 py-1 transition-colors",
            current === o.key
              ? "bg-primary/15 font-medium text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const sp = await searchParams;
  const segment: Segment =
    sp.segment === "active" || sp.segment === "inactive" ? sp.segment : "all";

  const bundle = await loadCrossAnalysis();
  const { analyses, brands, cross, hasAnyAds } = bundle;

  // Cached AI narrative (generated on demand, never on load). Read defensively: the AI
  // report is OPTIONAL chrome on top of the deterministic page, so it must never block
  // the page — if its table is missing (migration not run yet) or its JSON is stale/
  // invalid, we silently fall back to the empty state instead of crashing the route.
  let latestReport: Awaited<ReturnType<typeof getLatestInsightReport>> = null;
  let aiReport: StrategicInsights | null = null;
  try {
    latestReport = await getLatestInsightReport();
    if (latestReport) {
      const parsed = StrategicInsightsSchema.safeParse(
        JSON.parse(latestReport.reportJson) as unknown,
      );
      if (parsed.success) aiReport = parsed.data;
    }
  } catch (err) {
    console.error("[insights] could not read cached AI report (run pnpm db:migrate?):", err);
    latestReport = null;
  }
  const aiStale = latestReport ? latestReport.dataFingerprint !== fingerprintBundle(bundle) : false;
  const isDemo = process.env.DEMO_MODE === "true";

  // All-ads columns (for the profile + scoreboard tables).
  const columns: BrandColumn[] = analyses.map((a) => ({
    id: a.competitorId,
    name: a.competitorName,
    isSelf: a.isSelf,
  }));

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-muted-foreground text-sm mt-1">
          A side-by-side comparison of every brand you track, built only from the ads we
          scraped. No AI — every number is counted directly from those ads.
        </p>
      </div>
      <a
        href="/api/raw-data"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        title="Download every scraped ad as a CSV you can open in Excel or Google Sheets"
      >
        ↓ Download raw data (CSV)
      </a>
    </header>
  );

  if (analyses.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No competitors yet. Add some on the Competitors page to see the comparison.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasAnyAds) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No ads scraped yet. Scrape at least one brand (Competitors → a brand → Scrape
            ads) to fill in the comparison.
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Overview ──────────────────────────────────────────────────────
  const overviewRows: ComparisonRow[] = [
    scalarRow("Total ads", analyses, (a) => a.totalAds, {
      hint: "Every scraped ad (active + inactive)",
      strong: true,
    }),
    scalarRow("Active ads", analyses, (a) => a.liveCount, {
      hint: "Running now — Meta marks it active and we saw it on the most recent scrape",
      strong: true,
    }),
    scalarRow("Inactive ads", analyses, (a) => a.notLiveCount, {
      hint: "Paused or ended — not running in the most recent scrape",
    }),
    scalarRow("Unique active ads", analyses, (a) => a.distinctLiveCreatives, {
      hint: "Active ads with duplicates removed — each creative counted once, even when a brand reruns it across many campaigns",
      strong: true,
    }),
    scalarRow("Top CTA", analyses, (a) => a.cta[0]?.label ?? null, {
      hint: "Most-used call-to-action button",
    }),
    scalarRow("Top media", analyses, (a) => a.creative.media[0]?.label ?? null),
    scalarRow("Top language", analyses, (a) => a.languages.languages[0]?.label ?? null),
  ];

  // ─── Longevity tiers (live only) — count + % of that brand's live ads ──
  const tierCount = analyses[0]?.longevity.tiers.length ?? 0;
  const longevityRows: ComparisonRow[] = [
    scalarRow(
      "Typical run length — all ads",
      analyses,
      (a) => (a.medianDaysActiveAll != null ? `${a.medianDaysActiveAll} days` : null),
      {
        hint: "The middle value for how many days each ad has run — half run longer, half shorter — across running and stopped ads. The bands below cover running ads only.",
        strong: true,
      },
    ),
    scalarRow("Active ads (basis for %)", analyses, (a) => a.longevity.liveCount, { strong: true }),
    ...Array.from({ length: tierCount }, (_, i) => ({
      label: analyses[0].longevity.tiers[i].label,
      hint: tierHint(analyses[0].longevity.tiers[i]),
      values: analyses.map((a) => {
        const t = a.longevity.tiers[i];
        const live = a.longevity.liveCount;
        return live > 0 ? `${t.count} (${pct(t.count / live)})` : String(t.count);
      }),
    })),
  ];

  // ─── Advertiser & cadence (re-scrape to populate) ──────────────────
  const advertiserRows: ComparisonRow[] = [
    scalarRow("Page followers", analyses, (a) =>
      a.advertiser.pageLikeCount != null ? compactNumber(a.advertiser.pageLikeCount) : null,
    ),
    scalarRow("New ads (last 14 days)", analyses, (a) =>
      a.velocity.hasDates ? a.velocity.last14 : null,
    ),
    scalarRow("New ads (last 30 days)", analyses, (a) =>
      a.velocity.hasDates ? a.velocity.last30 : null,
    ),
  ];

  // ─── Segmented (lensed) mix tables ─────────────────────────────────
  const segAds: AnalysisAd[][] = brands.map((b) =>
    b.ads.filter((ad) => inSegment(ad, b.latestScrapeAt, segment)),
  );
  const segColumns: BrandColumn[] = brands.map((b, i) => ({
    id: b.id,
    name: b.name,
    isSelf: b.isSelf,
    subLabel: segment === "all" ? undefined : `n=${segAds[i].length}`,
    muted: segment !== "all" && segAds[i].length < MIN_SAMPLE,
  }));
  const onlyAll = segment === "all"; // reads are computed on all-ads; only show them in the all view

  // When a segment is active, badge the sections the filter actually re-lenses (the
  // creative & messaging tables) so it's obvious which numbers changed — important
  // because the sticky control can be toggled from anywhere on the page.
  const segLabel = segment === "inactive" ? "Inactive" : "Active";
  const filterTag = onlyAll ? undefined : (
    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
      {segLabel}
    </span>
  );

  return (
    <div className="space-y-6">
      {header}

      {/* Sticky segment filter — pinned under the top nav so it's reachable from
          anywhere on the page. It re-lenses the creative & messaging tables below
          (the sections badged with the active segment); the scoreboard/longevity
          sections always show all ads, since those ARE the active/inactive split. */}
      <div className="sticky top-14 z-40 -mx-4 border-y border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="text-sm text-muted-foreground">
            Filter the <span className="text-foreground">creative &amp; messaging</span> tables
          </span>
          <SegmentToggle current={segment} />
        </div>
      </div>

      <StrategicInsightsPanel
        report={aiReport}
        generatedAt={latestReport?.generatedAt ?? null}
        model={latestReport?.model ?? null}
        brandCount={latestReport?.brandCount ?? null}
        adCount={latestReport?.adCount ?? null}
        stale={aiStale}
        isDemo={isDemo}
      />

      <Section
        title="Head-to-head overview"
        description="A one-glance scoreboard. 'Unique active ads' removes duplicates: a brand running the same creative across many campaigns is counted once, so it doesn't look bigger than it really is."
        analysis={overviewRead(analyses)}
      >
        <ComparisonTable columns={columns} rows={overviewRows} />
      </Section>

      <Section
        title="How long ads have run"
        description="How long each brand's currently-running ads have been live, grouped into bands and shown as a count and share of that brand's active ads. Stopped ads aren't counted here."
        analysis={longevityRead(analyses)}
      >
        <ComparisonTable
          columns={columns}
          rows={longevityRows}
          caption="Active ads only, grouped by how long they've run. A longer run isn't a quality score — Meta shows no spend or results — it only means the ad is still up."
        />
      </Section>

      <Section
        title="Languages"
        description="The languages each brand writes its ads in, detected from the ad text (not the button, which Meta auto-translates)."
        analysis={onlyAll ? languageRead(analyses) : undefined}
        tag={filterTag}
      >
        <ComparisonTable
          columns={segColumns}
          rows={pivot(segAds, (ads) =>
            aggregateLanguages(ads.map((a) => a.caption ?? a.title)).languages.map((l) => ({
              label: `${l.flag} ${l.label}`,
              count: l.count,
              share: l.share,
            })),
          )}
          caption="Shares are out of the ads where we could confidently detect a language, not every ad."
        />
      </Section>

      <Section
        title="Company scale & regional reach"
        description="Company-level context to read the ad strategy against — not from Meta. Public-company figures are from audited filings; private ClickUp's are self-reported / third-party estimates (tagged)."
        analysis="Where the ad data agrees with the filings: ClickUp's Portuguese ads line up with Brazil being its #2 market; Asana's heavy German & French copy lines up with its EMEA traction; Monday's French copy lines up with its strong EMEA revenue."
      >
        <CompanyScaleTable columns={columns} />
      </Section>

      {/* ─── Lensed group: creative & messaging, filterable by the sticky segment bar ─── */}
      <div className="pt-2">
        <h2 className="text-lg font-semibold">Creative &amp; messaging</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the filter above to switch between <span className="text-foreground">active ads</span>{" "}
          (running now) and <span className="text-foreground">inactive ads</span> (paused or ended),
          and compare what each brand runs now vs what it has stopped. Each column shows how many ads
          it&apos;s based on; columns with very few ads (under {MIN_SAMPLE}) are greyed out because the
          percentages aren&apos;t reliable.
        </p>
      </div>

      <Section
        title="Creative mix"
        description="The mix of image, video, and carousel ads for each brand, shown as share · count."
        analysis={onlyAll ? mediaRead(analyses) : undefined}
        tag={filterTag}
      >
        <ComparisonTable columns={segColumns} rows={pivot(segAds, (ads) => mediaMix(ads))} />
      </Section>

      <Section
        title="Ad structure"
        description="How each ad is built. 'Dynamic creative' means one ad that rotates several versions automatically — different from a swipeable carousel."
        analysis={onlyAll ? structureRead(analyses) : undefined}
        tag={filterTag}
      >
        <ComparisonTable columns={segColumns} rows={pivot(segAds, (ads) => structureMix(ads))} />
      </Section>

      <Section
        title="Button mix"
        description="The call-to-action buttons on each brand's ads (e.g. 'Sign Up', 'Learn More'), by share of ads (top 10)."
        analysis={onlyAll ? ctaRead(analyses) : undefined}
        tag={filterTag}
      >
        <ComparisonTable columns={segColumns} rows={pivot(segAds, (ads) => ctaMix(ads), { max: 10 })} />
      </Section>

      <Section
        title="Copy length"
        description="How long each ad's main text is: Short (under 80 characters), Medium (80–200), Long (200+)."
        analysis={onlyAll ? copyRead(analyses) : undefined}
        tag={filterTag}
      >
        <ComparisonTable
          columns={segColumns}
          rows={pivot(segAds, (ads) => copyLengthMix(ads), {
            order: ["Short", "Medium", "Long", "No primary copy"],
          })}
        />
      </Section>

      <Section
        title="Messaging"
        description="The phrases (2–4 words) each brand repeats most across its ad text, counted once per ad. #1 is the most repeated; shown as phrase · number of ads."
        analysis={onlyAll ? messagingRead(brands) : undefined}
        tag={filterTag}
      >
        <ComparisonTable
          columns={segColumns}
          rows={rankRows(segAds, (ads) => phraseTally(ads, 8), 8)}
          caption="Counts written text only — body copy, headline, link description. It can't read words inside an image or video, and it treats a headline word the same as one buried deep in the copy. So a brand may emphasize a word in its visuals or button without it showing up here."
        />
      </Section>

      <Section
        title="Where ads run"
        description="Which Meta surfaces each brand runs on — Facebook, Instagram, Messenger, and so on. This shows reach across surfaces, not how many ads they run."
        analysis={onlyAll ? placementRead(analyses) : undefined}
        tag={filterTag}
      >
        <ComparisonTable columns={segColumns} rows={pivot(segAds, (ads) => placementSpread(ads))} />
      </Section>

      <Section
        title="Landing pages"
        description="The web pages each brand sends ad clicks to, most-advertised first. Since every brand links to its own site, the useful signal is which page or offer — e.g. a 'get started' page vs a pricing page."
        analysis={onlyAll ? landingRead(brands) : undefined}
        tag={filterTag}
      >
        <ComparisonTable
          columns={segColumns}
          rows={rankRows(segAds, (ads) => landingPages(ads, 5), 5)}
          caption="The pages each brand drives ad traffic to. Switch between active and inactive to compare where current ads point vs where stopped ones did."
        />
      </Section>

      <Section
        title="Advertiser & launch pace"
        description="Who's behind the ads and how often they launch new ones."
        analysis="Re-scrape any brand to fill in follower counts and launch pace — we started collecting these after the current ads were pulled."
      >
        <ComparisonTable
          columns={columns}
          rows={advertiserRows}
          caption="Followers and launch dates show “—” until each brand is re-scraped."
        />
      </Section>

      {cross.selfPresent && (
        <Section
          title="Your gaps"
          description="Where competitors, on average, do more of something than your brand does — the clearest “they lean on this and you don't” signals."
          analysis={gapRead(cross)}
        >
          <SelfGapTable cross={cross} />
        </Section>
      )}
    </div>
  );
}

function tierHint(tier: { minDays: number; maxDays: number }): string {
  if (!Number.isFinite(tier.maxDays)) return `${tier.minDays}+ days`;
  return `${tier.minDays}–${tier.maxDays} days`;
}

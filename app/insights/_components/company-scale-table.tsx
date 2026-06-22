import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { BrandColumn } from "./comparison-table";

/**
 * Company-scale context — EXTERNAL data, NOT from Meta's ad library.
 *
 * The rest of the Insights page is deterministic math over scraped ads (and never claims
 * spend/reach/market-share, which Meta doesn't expose). This block is deliberately
 * different: hand-curated, cited company-level figures pulled from public filings
 * (audited) and, for the private brand, self-reported/third-party numbers (flagged as
 * estimates). It is fenced off visually + labelled so it never contaminates the ad-derived
 * metrics. Figures are static — update them by hand when the sources refresh.
 */

type Provenance = "audited" | "estimate";

/** A single figure with where it came from. */
type Figure = { value: string; provenance: Provenance };

type CompanyScale = {
  /** Ownership / listing. */
  status: string;
  /** Revenue or ARR (most recent reported). */
  revenue: Figure;
  /** Paying-customer / account count (definition varies — noted inline). */
  customers: Figure;
  /** Valuation or public listing. */
  valuation: Figure;
  /** Headquarters city, country. */
  hq: string;
  /** Geographic reach. */
  countries: Figure;
  /** Where the brand performs strongest (1–2 lines, plain English). */
  strongestRegions: string;
  /** Period the figures describe (e.g. "FY2025"). */
  asOf: string;
  sources: { label: string; url: string }[];
};

/** Keyed by lowercased competitor name (matches the `competitors.name` we scrape). */
const SCALE: Record<string, CompanyScale> = {
  clickup: {
    status: "Private",
    revenue: { value: "~$300M ARR", provenance: "estimate" },
    customers: { value: "100k+ paying · 20M+ users", provenance: "estimate" },
    valuation: { value: "$4B (2021 Series C)", provenance: "estimate" },
    hq: "San Diego, US",
    countries: { value: "Global", provenance: "estimate" },
    strongestRegions:
      "US dominant (~57% of customers); Brazil #2 (~9%), UK #3 (~7%). Fast EMEA growth (300k+ teams, +233% YoY, new Dublin hub) and Latin America.",
    asOf: "2024–2025",
    sources: [
      { label: "Press release (ARR)", url: "https://finance.yahoo.com/news/clickup-accelerating-300-million-annual-130000796.html" },
      { label: "Sacra (valuation/funding)", url: "https://sacra.com/c/clickup/" },
      { label: "6sense (country mix)", url: "https://6sense.com/tech/project-collaboration/clickup-market-share" },
      { label: "ClickUp blog (EMEA)", url: "https://clickup.com/blog/clickup-expands-senior-emea-team/" },
    ],
  },
  asana: {
    status: "Public (NYSE: ASAN)",
    revenue: { value: "$723.9M (+11% YoY)", provenance: "audited" },
    customers: { value: "24,297 core (≥$5k/yr)", provenance: "audited" },
    valuation: { value: "Public (NYSE: ASAN)", provenance: "audited" },
    hq: "San Francisco, US",
    countries: { value: "US 60% / Intl 40% of revenue", provenance: "audited" },
    strongestRegions:
      "US is ~60% of revenue; ~40% international, with cited traction in EMEA & APAC. Matches the heavy German/French in their ad copy.",
    asOf: "FY2025 (ended Jan 31, 2025)",
    sources: [
      { label: "SEC 8-K (FY2025 results)", url: "https://www.sec.gov/Archives/edgar/data/0001477720/000147772025000033/asana8-kex991q4fy25.htm" },
      { label: "SEC 10-K (geography)", url: "https://www.sec.gov/Archives/edgar/data/1477720/000147772025000045/asan-20250131.htm" },
    ],
  },
  "monday.com": {
    status: "Public (NASDAQ: MNDY)",
    revenue: { value: "$1.23B (+27% YoY)", provenance: "audited" },
    customers: { value: "~245k total · 1,603 at >$100k ARR", provenance: "audited" },
    valuation: { value: "Public (NASDAQ: MNDY)", provenance: "audited" },
    hq: "Tel Aviv, Israel",
    countries: { value: "200+ countries & territories", provenance: "audited" },
    strongestRegions:
      "US largest market (~$364M in 2023); strong EMEA (~$157M) and UK (~$73M). Consistent with the French in their ad copy.",
    asOf: "FY2025",
    sources: [
      { label: "SEC 20-F (FY2025 results)", url: "https://www.stocktitan.net/sec-filings/MNDY/20-f-monday-com-ltd-files-annual-report-foreign-issuer-64dc6d704fa6.html" },
      { label: "Investor relations (FY2025)", url: "https://ir.monday.com/news-and-events/news-releases/news-details/2026/monday-com-Announces-Fourth-Quarter-and-Fiscal-Year-2025-Results/default.aspx" },
    ],
  },
};

function lookup(name: string): CompanyScale | undefined {
  return SCALE[name.trim().toLowerCase()];
}

function EstBadge() {
  return (
    <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
      est.
    </span>
  );
}

function Cell({ figure }: { figure: Figure | null }) {
  if (!figure) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      {figure.value}
      {figure.provenance === "estimate" && <EstBadge />}
    </span>
  );
}

type Row = {
  label: string;
  hint?: string;
  /** Cell alignment. Numeric figures are right-aligned; long prose reads better left. */
  align?: "left" | "right";
  render: (s: CompanyScale) => React.ReactNode;
};

const ROWS: Row[] = [
  { label: "Ownership", render: (s) => <span>{s.status}</span> },
  { label: "Revenue / ARR", hint: "Most recent reported", render: (s) => <Cell figure={s.revenue} /> },
  { label: "Paying customers", hint: "Definition varies per company", render: (s) => <Cell figure={s.customers} /> },
  { label: "Valuation / listing", render: (s) => <Cell figure={s.valuation} /> },
  { label: "Headquarters", render: (s) => <span>{s.hq}</span> },
  { label: "Countries / reach", render: (s) => <Cell figure={s.countries} /> },
  {
    label: "Strongest regions",
    hint: "Where each brand performs best",
    align: "left",
    render: (s) => (
      <span className="block max-w-[15rem] text-sm font-normal leading-snug">{s.strongestRegions}</span>
    ),
  },
];

/**
 * External company-scale comparison. `columns` are the same brand columns the rest of the
 * page uses (so ordering/`self` highlight match); brands with no curated data render "—".
 */
export function CompanyScaleTable({ columns }: { columns: BrandColumn[] }) {
  const scales = columns.map((c) => lookup(c.name));
  const selfClass = "bg-primary/5";

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-amber-600 dark:text-amber-400">External context — not from Meta ad data.</span>{" "}
        Company-level figures from public filings (audited) and, for private ClickUp,
        self-reported / third-party numbers (tagged <EstBadge />). Everything else on this page
        is counted from the scraped ads.
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Metric</TableHead>
            {columns.map((c) => (
              <TableHead key={c.id} className={cn("text-right align-bottom", c.isSelf && selfClass)}>
                <span className="inline-flex items-center gap-1.5">
                  {c.name}
                  {c.isSelf && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      You
                    </span>
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="align-top">
                <div>{row.label}</div>
                {row.hint && <div className="text-xs text-muted-foreground">{row.hint}</div>}
              </TableCell>
              {scales.map((s, i) => (
                <TableCell
                  key={columns[i].id}
                  className={cn(
                    "align-top",
                    // TableCell defaults to whitespace-nowrap; prose rows must wrap.
                    row.align === "left" ? "whitespace-normal text-left" : "text-right",
                    columns[i].isSelf && selfClass,
                  )}
                >
                  {s ? row.render(s) : <span className="text-muted-foreground">—</span>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="space-y-1 text-xs text-muted-foreground">
        {columns.map((c, i) => {
          const s = scales[i];
          if (!s) return null;
          return (
            <p key={c.id}>
              <span className="font-medium text-foreground">{c.name}</span> ({s.asOf}):{" "}
              {s.sources.map((src, j) => (
                <span key={src.url}>
                  {j > 0 && " · "}
                  <a href={src.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                    {src.label}
                  </a>
                </span>
              ))}
            </p>
          );
        })}
      </div>
    </div>
  );
}

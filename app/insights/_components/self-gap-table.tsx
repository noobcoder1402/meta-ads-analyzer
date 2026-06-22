import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CrossAnalysis } from "@/lib/analysis/analyze-across";

const AREA_LABELS: Record<keyof CrossAnalysis["gaps"], string> = {
  cta: "CTA",
  media: "Media",
  language: "Language",
  placement: "Placement",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * "Where rivals out-index you" — flattens the four gap dimensions into one ranked
 * table (biggest share gap first). A gap means competitors use something, on average,
 * a lot more than the user's own `self` brand does. SHARE only, never spend.
 */
export function SelfGapTable({ cross }: { cross: CrossAnalysis }) {
  const rows = (Object.keys(cross.gaps) as (keyof CrossAnalysis["gaps"])[])
    .flatMap((area) => cross.gaps[area].map((g) => ({ area, ...g })))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No notable gaps — your mix matches the competitors on every area we measure
        (within 10 percentage points).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Area</TableHead>
            <TableHead>What rivals lean on</TableHead>
            <TableHead className="text-right">Rivals (avg)</TableHead>
            <TableHead className="text-right">You</TableHead>
            <TableHead className="text-right">Gap</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.area}:${r.label}`}>
              <TableCell className="text-muted-foreground">{AREA_LABELS[r.area]}</TableCell>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(r.competitorShare)}</TableCell>
              <TableCell className="text-right tabular-nums">{pct(r.selfShare)}</TableCell>
              <TableCell className="text-right tabular-nums font-medium text-primary">
                +{pct(r.delta)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        A share comparison only — a higher rival share means they run more of that, not
        that they spend more (Meta doesn&apos;t share spend).
      </p>
    </div>
  );
}

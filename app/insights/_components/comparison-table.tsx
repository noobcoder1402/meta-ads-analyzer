import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type BrandColumn = {
  id: string;
  name: string;
  isSelf: boolean;
  /** Small caption under the brand name (e.g. the segment size "n=180"). */
  subLabel?: string;
  /** Grey this column out (e.g. sample too small to trust the shares). */
  muted?: boolean;
};

export type ComparisonRow = {
  /** Metric name shown in the left column. */
  label: string;
  /** Optional muted sub-label under the metric name. */
  hint?: string;
  /** One value per brand column (same order). `null` renders as a muted "—". */
  values: (string | null)[];
  /** Emphasise this row (headline metric). */
  strong?: boolean;
};

/**
 * A spec-sheet comparison: metrics down the left, one brand per column. The user's
 * own (`self`) brand column is highlighted and tagged "You". Pure presentational —
 * all values arrive pre-formatted as strings (or null for "no data").
 */
export function ComparisonTable({
  columns,
  rows,
  caption,
}: {
  columns: BrandColumn[];
  rows: ComparisonRow[];
  caption?: string;
}) {
  const selfClass = "bg-primary/5";

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">Metric</TableHead>
            {columns.map((c) => (
              <TableHead
                key={c.id}
                className={cn("text-right align-bottom", c.isSelf && selfClass, c.muted && "opacity-50")}
              >
                <span className="inline-flex items-center gap-1.5">
                  {c.name}
                  {c.isSelf && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      You
                    </span>
                  )}
                </span>
                {c.subLabel && (
                  <span className="block text-xs font-normal text-muted-foreground">{c.subLabel}</span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className={cn("align-top", row.strong && "font-medium")}>
                <div>{row.label}</div>
                {row.hint && (
                  <div className="text-xs text-muted-foreground">{row.hint}</div>
                )}
              </TableCell>
              {row.values.map((v, i) => (
                <TableCell
                  key={columns[i].id}
                  className={cn(
                    "text-right tabular-nums",
                    row.strong && "font-medium",
                    columns[i].isSelf && selfClass,
                    columns[i].muted && "opacity-50",
                  )}
                >
                  {v ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

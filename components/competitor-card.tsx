import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Competitor } from "@/lib/db/schema";

type Props = {
  competitor: Competitor;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  meta?: React.ReactNode;
};

const STATUS_LABELS: Record<Competitor["status"], string> = {
  self: "Your company",
  accepted: "Accepted",
  suggested: "Suggested",
  manual: "Manual",
};

const STATUS_STYLES: Record<Competitor["status"], string> = {
  self: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  accepted: "bg-green-500/15 text-green-300 border-green-500/30",
  suggested: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  manual: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

export function CompetitorCard({ competitor, primaryAction, secondaryActions, meta }: Props) {
  const initial = competitor.name.charAt(0).toUpperCase();
  return (
    <Card className="flex flex-col h-full">
      <CardContent className="p-5 flex flex-col flex-1 gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center font-semibold text-base shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate" title={competitor.name}>
              {competitor.name}
            </h3>
            <Badge variant="outline" className={`mt-1 ${STATUS_STYLES[competitor.status]}`}>
              {STATUS_LABELS[competitor.status]}
            </Badge>
          </div>
        </div>

        {meta && <div className="text-sm text-muted-foreground">{meta}</div>}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {primaryAction}
          {secondaryActions}
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cross-competitor GTM recommendations.
        </p>
      </header>

      <Card>
        <CardContent className="p-8 text-center space-y-2">
          <p className="text-sm font-medium">Coming soon</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            The recommendations engine is being rebuilt. Scraping and performance
            scoring continue to work in the meantime.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

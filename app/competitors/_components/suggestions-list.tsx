"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Competitor } from "@/lib/db/schema";

export function SuggestionsList({ suggestions }: { suggestions: Competitor[] }) {
  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-3">
      {suggestions.map((s, idx) => (
        <SuggestionRow
          key={s.id}
          suggestion={s}
          index={idx + 1}
          total={suggestions.length}
        />
      ))}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  index,
  total,
}: {
  suggestion: Competitor;
  index: number;
  total: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: "accept" | "reject") {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/competitors/${suggestion.id}/${action}`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || `Failed to ${action}.`);
      setBusy(null);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className="text-xs text-muted-foreground font-mono pt-2 shrink-0 w-10">
          {index}/{total}
        </div>
        <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center font-semibold text-base shrink-0">
          {suggestion.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{suggestion.name}</h3>
            <Badge variant="outline" className="bg-yellow-500/15 text-yellow-300 border-yellow-500/30">
              Suggested
            </Badge>
          </div>
          {suggestion.suggestionReason && (
            <p className="text-sm mt-1 text-muted-foreground">
              {suggestion.suggestionReason}
            </p>
          )}
          {suggestion.metaPageUrl && (
            <a
              href={suggestion.metaPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline mt-2 inline-block"
            >
              Likely Meta page →
            </a>
          )}
          {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        </div>
        <div className="flex flex-col gap-2 shrink-0 min-w-[8rem]">
          <Button size="sm" onClick={() => call("accept")} disabled={busy !== null}>
            {busy === "accept" ? "…" : "Accept"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => call("reject")} disabled={busy !== null}>
            {busy === "reject" ? "…" : "Reject"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

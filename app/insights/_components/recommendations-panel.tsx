"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  hasRecommendations: boolean;
  isDemo: boolean;
};

export function RecommendationsPanel({ hasRecommendations, isDemo }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/recommendations/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Generating recommendations failed.");
      } else if (data?.status === "skipped") {
        setError(data?.reason ?? "Nothing to compare yet.");
      } else {
        router.refresh(); // re-fetch the server component to show the new set
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  const label = running
    ? "Generating…"
    : hasRecommendations
    ? "Regenerate"
    : "Generate recommendations";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" onClick={run} disabled={isDemo || running}>
          {label}
        </Button>
        <span className="text-xs text-muted-foreground">
          One AI call (~$0.06). Replaces the previous set.
        </span>
      </div>

      {isDemo && (
        <p className="text-xs text-muted-foreground">
          Generating recommendations is disabled in the read-only demo.
        </p>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CompetitorRowActions({ competitorId }: { competitorId: string }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (!confirm("Remove this competitor? You can't undo this from the UI.")) return;
    setRemoving(true);
    const res = await fetch(`/api/competitors/${competitorId}/reject`, { method: "POST" });
    setRemoving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to remove competitor.");
      return;
    }
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={remove} disabled={removing} className="text-muted-foreground hover:text-red-400">
      {removing ? "Removing…" : "Remove"}
    </Button>
  );
}

import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db/client";
import { competitors, type Competitor } from "@/lib/db/schema";
import { getAIClient } from "@/lib/ai/client";
import { CompetitorSuggestionsSchema } from "@/lib/ai/schemas";
import {
  COMPETITOR_SUGGESTER_PROMPT_STATIC,
  buildCompetitorSuggesterPrompt,
} from "@/lib/ai/prompts/competitor-suggester";

const COMPANY_MD_PATH = path.join(process.cwd(), "context", "company.md");

export type SuggestCompetitorsResult = {
  inserted: Competitor[];
  excludedCount: number;
};

export async function suggestCompetitors(count = 10): Promise<SuggestCompetitorsResult> {
  let companyProfileMarkdown: string;
  try {
    companyProfileMarkdown = await fs.readFile(COMPANY_MD_PATH, "utf8");
  } catch {
    throw new Error(
      "Cannot run suggestions — context/company.md does not exist. Complete onboarding first."
    );
  }

  const existing = await db
    .select({ name: competitors.name, deletedAt: competitors.deletedAt })
    .from(competitors);

  const excludeNames = Array.from(
    new Set(existing.map((c) => c.name.trim()).filter(Boolean))
  );

  const ai = getAIClient();
  const result = await ai.generate({
    schema: CompetitorSuggestionsSchema,
    staticPrompt: COMPETITOR_SUGGESTER_PROMPT_STATIC,
    prompt: buildCompetitorSuggesterPrompt({
      companyProfileMarkdown,
      excludeNames,
      count,
    }),
    model: "sonnet",
    toolName: "record_result",
    toolDescription: "Record the structured list of competitor suggestions.",
  });

  const excludeNameSet = new Set(excludeNames.map((n) => n.toLowerCase()));
  const newRows = result.suggestions
    .filter((s) => !excludeNameSet.has(s.name.trim().toLowerCase()))
    .slice(0, count)
    .map((s) => ({
      name: s.name.trim(),
      status: "suggested" as const,
      suggestionReason: s.why,
      metaPageUrl: s.likely_meta_page_url ?? null,
    }));

  if (newRows.length === 0) {
    return { inserted: [], excludedCount: excludeNames.length };
  }

  const inserted = await db.insert(competitors).values(newRows).returning();
  return { inserted, excludedCount: excludeNames.length };
}

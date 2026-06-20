import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { competitors, type Competitor } from "@/lib/db/schema";
import { getAIClient } from "@/lib/ai/client";
import { CompanyProfileSchema, type CompanyProfile } from "@/lib/ai/schemas";
import {
  COMPANY_PROFILE_PROMPT_STATIC,
  buildCompanyProfilePrompt,
} from "@/lib/ai/prompts/company-profile";

const COMPANY_MD_PATH = path.join(process.cwd(), "context", "company.md");

export type GenerateProfileInput = {
  websiteUrl: string;
  metaPageUrl?: string;
  scrapedText: string;
  fallbackText?: string;
};

export type GenerateProfileResult = {
  profile: CompanyProfile;
  selfCompetitor: Competitor;
  markdownPath: string;
};

export async function generateCompanyProfile(
  input: GenerateProfileInput
): Promise<GenerateProfileResult> {
  const ai = getAIClient();

  const profile = await ai.generate({
    schema: CompanyProfileSchema,
    staticPrompt: COMPANY_PROFILE_PROMPT_STATIC,
    prompt: buildCompanyProfilePrompt(input.scrapedText, input.fallbackText),
    model: "haiku",
    toolName: "record_company_profile",
    toolDescription: "Record the structured company profile.",
  });

  const markdown = renderCompanyMarkdown(profile, input.websiteUrl);
  await fs.mkdir(path.dirname(COMPANY_MD_PATH), { recursive: true });
  await fs.writeFile(COMPANY_MD_PATH, markdown, "utf8");

  const selfCompetitor = await upsertSelfCompetitor({
    name: profile.company_name,
    websiteUrl: input.websiteUrl,
    metaPageUrl: input.metaPageUrl,
  });

  return { profile, selfCompetitor, markdownPath: COMPANY_MD_PATH };
}

function renderCompanyMarkdown(profile: CompanyProfile, websiteUrl: string): string {
  return `# ${profile.company_name}

> Auto-generated from ${websiteUrl}. Edit freely — manual edits are preserved on re-scrape.

## What we do

${profile.what_we_do}

## Who we serve

${profile.who_we_serve}

## How we're different

${profile.how_were_different}

## Goals

<!-- Optional. What are you trying to achieve? e.g., "Test founder-led content this quarter" -->
`;
}

async function upsertSelfCompetitor(args: {
  name: string;
  websiteUrl: string;
  metaPageUrl?: string;
}): Promise<Competitor> {
  const existing = await db
    .select()
    .from(competitors)
    .where(eq(competitors.status, "self"))
    .limit(1);

  if (existing[0]) {
    const updated = await db
      .update(competitors)
      .set({
        name: args.name,
        websiteUrl: args.websiteUrl,
        metaPageUrl: args.metaPageUrl ?? existing[0].metaPageUrl,
        updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
        deletedAt: null,
      })
      .where(eq(competitors.id, existing[0].id))
      .returning();
    return updated[0];
  }

  const inserted = await db
    .insert(competitors)
    .values({
      name: args.name,
      status: "self",
      websiteUrl: args.websiteUrl,
      metaPageUrl: args.metaPageUrl,
    })
    .returning();
  return inserted[0];
}

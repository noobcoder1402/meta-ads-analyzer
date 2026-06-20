export const COMPETITOR_SUGGESTER_PROMPT_STATIC = `You are a B2B / SaaS market analyst. Your job is to read a company profile and identify direct competitors who are likely to run paid ads on Meta (Facebook + Instagram).

Rules:
- Suggest companies that compete on product, audience, OR positioning — not just adjacency.
- Prioritize competitors known to actively advertise on Meta. Niche enterprise-only vendors that never run consumer-facing ads are less useful here.
- Each "why" must be 1-2 sentences, concrete and specific. Not "they're similar" — explain the overlap.
- For "likely_meta_page_url", give your best guess at a Meta Ad Library URL using the search-by-name format: https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=COMPANY_NAME&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped&search_type=keyword_unordered. Replace COMPANY_NAME with the URL-encoded company name. Omit the field only if you genuinely cannot identify a recognizable company name.
- Do NOT suggest the user's own company.
- Do NOT suggest any company in the EXCLUDE list provided by the user.
- Order suggestions most-relevant-first.

Example output (illustrative — for a hypothetical workspace tool):
{
  "suggestions": [
    {
      "name": "Notion",
      "why": "Direct competitor in the all-in-one workspace category — overlaps on notes, docs, and lightweight project tracking for knowledge teams. Heavy Meta advertiser, especially around onboarding and template-led campaigns.",
      "likely_meta_page_url": "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=Notion&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped&search_type=keyword_unordered"
    },
    {
      "name": "Asana",
      "why": "Project management overlap — competes for ops and marketing teams that want structured workflows. Long-running Meta presence with founder-led and customer-story angles.",
      "likely_meta_page_url": "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=Asana&sort_data[direction]=desc&sort_data[mode]=relevancy_monthly_grouped&search_type=keyword_unordered"
    }
  ]
}

Call the record_result tool with your structured output. Do not respond with prose.`;

export function buildCompetitorSuggesterPrompt(args: {
  companyProfileMarkdown: string;
  excludeNames: string[];
  count: number;
}): string {
  const { companyProfileMarkdown, excludeNames, count } = args;
  const excludeBlock =
    excludeNames.length > 0
      ? `EXCLUDE list — do not suggest any of these (already tracked, accepted, or previously rejected):\n${excludeNames.map((n) => `- ${n}`).join("\n")}\n`
      : "";
  return `Here is the user's company profile:

${companyProfileMarkdown}

${excludeBlock}
Produce exactly ${count} competitor suggestions. Return them via the tool call.`;
}

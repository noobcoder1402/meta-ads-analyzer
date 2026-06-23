# Meta Ads Analyzer

*Track your competitors' Meta ads and see a side-by-side comparison of their strategy.*

**🔗 [Live demo](https://meta-ads-analyzer-alpha.vercel.app/insights)** — a read-only tour with example data (no setup required).

Open-source, self-hosted competitor intelligence for Meta ads. It scrapes the public
[Meta Ad Library](https://www.facebook.com/ads/library/) for the brands you track and
builds a deterministic, side-by-side **Insights** comparison — how long each brand's ads
have run, their creative and call-to-action mix, the phrases they repeat, the languages
they write in, and more.

The analysis is **deterministic and neutral**: every number is plain math over the ads
already scraped — no AI, no cost. Meta never exposes spend, reach, or results, so the tool
never claims an ad is "good" or a "winner". It only reports facts. AI is used in just two
places, and only when you click a button: onboarding (generating your company profile +
suggesting competitors) and an optional "Strategic insights" narrative on the Insights page.

Single-user by design — no login, one SQLite file per install.

## Requirements

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io)
- An [Anthropic API key](https://console.anthropic.com) (only needed for the two AI features)

## Setup

```bash
pnpm install                 # install dependencies
pnpm exec playwright install chromium   # browser used for scraping
cp .env.example .env         # then open .env and paste your ANTHROPIC_API_KEY
pnpm db:migrate              # create the SQLite database (data/app.db)
pnpm dev                     # start the app at http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000). The first run takes you through
**onboarding**: it scrapes your website to draft a company profile and suggests competitors
to track. Nothing is scraped from the Ad Library until you explicitly click **Scrape ads**
on a brand.

## Everyday use

1. **Add the brands you want to track** on the Competitors page (your own company is added
   automatically as the pinned `self` brand).
2. **Scrape their ads** — click **Scrape ads** on a card (pick a mode + countries), or use
   the CLI (see below). This is the only step that pulls from Meta.
3. **Open Insights** — the side-by-side comparison across every brand, with an
   All / Active / Inactive segment filter. Optionally click **Generate** for the AI
   strategic-insights narrative, and **Download raw data (CSV)** to analyze in a spreadsheet.

## Commands

```bash
pnpm dev              # dev server
pnpm db:migrate       # apply database migrations
pnpm db:studio        # browse the database in Drizzle Studio
pnpm test             # run the unit tests
pnpm typecheck        # type-check
pnpm lint             # lint
pnpm scrape --competitor-id=<uuid> [--mode=active|active_plus_sample|active_plus_all] [--country=US|ALL]
pnpm backfill:pages   # convert AI-guessed page URLs into verified ones
```

See `meta-ads-analyzer/CLAUDE.md` for the full architecture and `docs/` for detailed
references on each area (scraping, analysis, the dashboard, the AI pipeline, and what Meta
actually exposes).

## Environment variables

All optional except the Anthropic key. See `.env.example` for the full list.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required for the two AI features (onboarding + strategic insights). |
| `MODEL_PROVIDER` | `anthropic` (default). `gemini` is a stub and not implemented. |
| `INSIGHTS_MODEL` | Override the strategic-insights model: `haiku` \| `sonnet` \| `opus` (default opus). |
| `DEMO_MODE` | Set to `true` for a read-only deployment — disables every write and paid AI call. |
| `DATABASE_URL` | Override the SQLite path (default `./data/app.db`). |

## Notes & limitations

- **Scraping is local-only.** It drives a real browser (Playwright), which does not run on
  serverless hosts like Vercel. A deployed copy can only be a read-only demo (`DEMO_MODE=true`).
- **Meta exposes no spend, reach, or results for commercial ads** — only what's visible in
  the public library. The tool never infers performance from the ad library.
- This is **not** multi-tenant SaaS — it's a single-user tool you run yourself.

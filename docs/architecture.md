# Architecture

Read this before refactoring across layers or changing how data moves through the system.

## System overview

```
┌────────────────────────────────────────────────────────────┐
│                  Next.js Dashboard (read+write)             │
│  Server components read SQLite. Client components trigger   │
│  API routes for onboarding + scraping. Deterministic        │
│  analysis (lib/analysis/) is recomputed on every read.      │
└──────────────────────────┬─────────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │   SQLite app.db │
                  │   (Drizzle ORM) │
                  └────────▲────────┘
                           │
   ┌───────────────┬───────────────┐
   │               │               │
┌──▼──────────┐ ┌──▼────┐ ┌────────▼──────┐
│ Meta scraper│ │Website│ │ Deterministic │
│ (Playwright)│ │scraper│ │  analysis     │
│ scrape.ts   │ │+ prof-│ │ (lib/analysis)│
│             │ │ ile   │ │ recomputed    │
│             │ │ gen   │ │ on read       │
└─────────────┘ └───────┘ └───────────────┘
        │           │            ▲
        │ writes    │ writes     │ reads ads columns
        │ ads +     │ self       │ at request time
        │ creatives │ competitor │ (persists nothing)
        ▼           │ + company  │
                    │ profile    │
                    ▼           (scraper writes to SQLite)
```

There is no persisted scoring step. The deterministic analysis layer (`lib/analysis/`) reads the scraped `ads` columns at request time, computes everything fresh, and is not persisted to a table — see `docs/analysis.md`. (The old per-ad scoring engine + `performance_scores` table were removed 2026-06-22.)

## Data flow lifecycle

### Onboarding (one-time, before any other lifecycle steps)

0. **User submits company name/URL + optional Meta page URL.** Website scrape runs, Meta Ad Library is searched if no URL given, the company profile generator produces `context/company.md`, and a row is inserted into `competitors` with status=`self`. User confirms/edits the profile on a confirmation screen before continuing. No ad scraping happens during onboarding — only the profile is generated.

### For each competitor (including the `self` competitor)

1. **Added** — user accepts a suggestion, pastes a Meta page URL, or (for `self`) completes onboarding. Row inserted into `competitors` (status=`accepted` / `manual` / `self`).
2. **Scraped** — Playwright fetches active ads from the Ad Library, downloads creatives to `data/ad-creatives/`, upserts rows into `ads`. Each ad gets `first_seen_at`, `is_active`, `days_active`, `placements`, etc. For the `self` competitor, this only runs when the user explicitly clicks `Scrape ads` — never automatically.
3. **Analyzed (on read)** — the deterministic analysis layer in `lib/analysis/` reads the `ads` columns at request time. It is pure (zero AI), persists nothing, and is recomputed on every read: longevity run-length tiers, active/inactive split, creative & CTA mix, phrase mining, placements, landing domains, and a distinct-creatives de-confound using Meta's `collation_id`. It composes per-competitor analysis plus a cross-competitor head-to-head / self-gap, rendered by the **Insights** page. See `docs/analysis.md`.

Each step is independently re-runnable. Steps 1–2 are persisted to SQLite; step 3 is recomputed live and stored nowhere. Order matters within a competitor; competitors are independent. The `self` competitor flows through the exact same pipeline — no special-case code paths.

## Why this structure

- **SQLite as the only shared state** — no caches, no message queues, no Redis. Anyone can clone the repo, look at `data/app.db` with Drizzle Studio, and understand the entire system state.
- **Scripts are dumb workers** — they take inputs, write to SQLite, exit. The Next.js app is a read layer + thin trigger layer. This separation lets the deployed demo run with zero workers.
- **Provider abstraction at one boundary** — `lib/ai/client.ts` is the only file that knows whether we're calling Anthropic or Gemini. Everything else takes a typed client.
- **No background job queue, by deliberate constraint** — the heavy local work (scraping, plus onboarding's AI calls) runs only on the local Node process. Vercel serverless timeouts (10/60/300s by plan) preclude running it on the demo, and the `DEMO_MODE=true` guard 403s every mutating route, which removes the need for a queue. Local routes stream progress via SSE; closing the tab is fine, but **runs are not crash-resumable** — a local restart mid-run loses progress and the user re-clicks. Fine for a single-user self-hosted tool; multi-user hosting would need BullMQ + Redis or Inngest.

## Re-run behavior (what happens on the second scrape and beyond)

The first run is clean by definition — empty DB, fresh scrape. Repeat runs introduce complexity that this section captures in one place. None of these are optional; they're what prevent the app from breaking or silently lying on run 2+.

**`scrape_runs` table**: one row per scrape invocation (success, partial, or failed). Foundation for the "last scrape: X, diff Y" UI and failed-scrape recovery. Schema and write rules in `docs/scraping.md`.

**Ad upsert**: existing ads get `last_seen_at`, `is_active`, `days_active` updated; new ads inserted with full row. We do NOT mark missing ads inactive (snapshot model — see `docs/analysis.md`). Creative and caption never overwritten — they're immutable per Meta's library ID.

**History is NOT tracked in v1**. The analysis is recomputed on every read from the current `ads` columns; nothing is snapshotted over time. Trajectory views (sparklines, "running longer each week" filters) are deferred. Adding a history table later is non-breaking — the current schema doesn't preclude it.

## What lives where (and why)

| Concern | Location | Rationale |
|---|---|---|
| DB schema | `lib/db/schema.ts` | Drizzle convention; one source of truth |
| DB queries | `lib/db/queries.ts` | Centralized so both API routes and scripts use the same |
| AI prompts | `lib/ai/prompts/*.ts` | One file per task: company-profile, competitor-suggester. Export as string constants. Easy to A/B. |
| Zod schemas | `lib/ai/schemas.ts` | Centralized so AI tasks + tests share definitions: company profile, competitor suggestions, `ConversionGoalEnum`. |
| Provider abstraction | `lib/ai/client.ts` | The single Anthropic-or-Gemini decision point |
| AI analyzers | `lib/ai/analyzers/*.ts` | Onboarding tasks: `generate-company-profile`, `suggest-competitors`. Pure: input → LLM call → validated output → DB write. |
| Deterministic analysis | `lib/analysis/*.ts` | Pure functions, zero AI, no I/O. Read `ads` columns at request time and compute per-competitor + cross-competitor metrics. Recomputed on every read; persisted nowhere. See `docs/analysis.md`. |
| Scraper | `scripts/scrape.ts` | CLI-only; also imported by `/api/competitors/:id/scrape`. Writes to `scrape_runs` on every invocation. |
| Website scraper | `scripts/scrape-website.ts` | Lightweight homepage+pricing+about crawl used only during onboarding and Re-scrape website. Separate from the Meta scraper. |
| Scrape run history | `scrape_runs` table | Foundation for "last scrape: X, diff Y" UI and future history features. |
| API routes | `app/api/**/*.ts` | Thin layer; import from `lib/` |
| Onboarding | `app/onboarding/page.tsx` + `/api/onboarding/*` | Runs once; creates the `self` competitor + `context/company.md` |
| User company profile | `context/company.md` | The single auto-generated, user-editable file. Source of truth for positioning. |
| UI components | `components/` + `app/**/page.tsx` | Server components by default |

## Deletion behavior

When a competitor is removed from the dashboard (via the `⋯` menu on the card):

- The `competitors` row is **soft-deleted** (`deleted_at` timestamp set, never a hard `DELETE`). All foreign-key rows (`ads`, `scrape_runs`) stay in place — they're history, not garbage.
- The Competitors and Insights pages filter out soft-deleted competitors by default (`WHERE deleted_at IS NULL`). Centralize this filter in `lib/db/queries.ts` — every read-path query goes through it.
- The `self` competitor cannot be deleted. The remove button is hidden on its card, and the API route rejects `delete` on a row where `status='self'` with a 400.

## Failure boundaries

- **Scraper fails** (Meta changed DOM): scrape script writes error + screenshot to `data/scrape-errors/{competitor-id}-{timestamp}/`. UI surfaces a card with "View error" link.
- **Provider rate limit** (onboarding AI): exponential backoff in `lib/ai/client.ts`.
- **DB locked** (concurrent writes): better-sqlite3 is synchronous and single-threaded so this shouldn't happen, but if it does, the API route returns 503 and asks the user to retry.

## Performance constraints

- Demo dashboard must load in < 1 second from a cold cache. Server components + SQLite reads make this easy. Don't add client-side data fetching that defers the first paint.
- The bundled `demo-snapshot.json` should stay under 5 MB so the repo clone is fast.

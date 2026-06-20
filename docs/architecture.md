# Architecture

Read this before refactoring across layers or changing how data moves through the system.

## System overview

```
┌────────────────────────────────────────────────────────────┐
│                  Next.js Dashboard (read+write)             │
│  Server components read SQLite. Client components trigger   │
│  API routes for onboarding, scraping, analysis, synthesis.  │
└──────────────────────────┬─────────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │   SQLite app.db │
                  │   (Drizzle ORM) │
                  └────────▲────────┘
                           │
   ┌───────────────┬───────┼────────────┬────────────────┐
   │               │       │            │                │
┌──▼──────────┐ ┌──▼────┐ ┌▼──────────┐ ┌──▼─────────┐ ┌─▼─────────────┐
│ Meta scraper│ │Website│ │AI Analyzer│ │ Synthesizer│ │ Recommender   │
│ (Playwright)│ │scraper│ │(LLM,      │ │ (LLM, text)│ │ (LLM, text)   │
│ scrape.ts   │ │+ prof-│ │ vision)   │ │            │ │               │
│             │ │ ile   │ │ analyze.ts│ │            │ │               │
│             │ │ gen   │ │           │ │            │ │               │
└─────────────┘ └───────┘ └───────────┘ └────────────┘ └───────────────┘
        │           │           │            │              │
        │ writes    │ writes    │ writes     │ writes       │ writes
        │ ads +     │ self      │ analyses + │ syntheses    │ recommen-
        │ creatives │ competitor│ scores     │              │ dations
        ▼           │ + company │ ▼          │ ▼            │ ▼
                    │ profile   │
                    ▼           (all to SQLite)
```

## Data flow lifecycle

### Onboarding (one-time, before any other lifecycle steps)

0. **User submits company name/URL + optional Meta page URL.** Website scrape runs, Meta Ad Library is searched if no URL given, the company profile generator produces `context/company.md`, and a row is inserted into `competitors` with status=`self`. User confirms/edits the profile on a confirmation screen before continuing. No ad scraping happens during onboarding — only the profile is generated.

### For each competitor (including the `self` competitor)

1. **Added** — user accepts a suggestion, pastes a Meta page URL, or (for `self`) completes onboarding. Row inserted into `competitors` (status=`accepted` / `manual` / `self`).
2. **Scraped** — Playwright fetches active ads from the Ad Library, downloads creatives to `data/ad-creatives/`, upserts rows into `ads`. Each ad gets `first_seen_at`, `is_active`, `days_active`, `placements`, etc. For the `self` competitor, this only runs when the user explicitly clicks `Scrape ads` — never automatically.
3. **Analyzed** — for every ad without a row in `ad_analyses`, run the creative analyzer (vision + structured output). Writes hook, angle, themes, etc.
4. **Scored** — pure function computes the performance score from `ads` columns; writes to `performance_scores`. This is deterministic and re-runnable any time.
5. **Synthesized** — across all analyses for one competitor, generate `competitor_syntheses` (dominant angles, top hooks, always-on winners, recent pivots, active-experiments, abandoned-patterns) via the stratified-bucket prompt structure. The `self` competitor's synthesis is the "what the user actually runs" signal used by the recommender. See `docs/ai-pipeline.md` task #3.
6. **Recommended** — across all `accepted`/`manual` competitor syntheses + the `self` synthesis (if it exists) + `context/company.md`, generate `recommendations`. This is cross-cutting and updates the Insights page.

Each step is independently re-runnable. Order matters within a competitor; competitors are independent. The `self` competitor flows through the exact same pipeline — no special-case code paths.

## Why this structure

- **SQLite as the only shared state** — no caches, no message queues, no Redis. Anyone can clone the repo, look at `data/app.db` with Drizzle Studio, and understand the entire system state.
- **Scripts are dumb workers** — they take inputs, write to SQLite, exit. The Next.js app is a read layer + thin trigger layer. This separation lets the deployed demo run with zero workers.
- **Provider abstraction at one boundary** — `lib/ai/client.ts` is the only file that knows whether we're calling Anthropic or Gemini. Everything else takes a typed client.
- **No background job queue, by deliberate constraint** — paid AI work (analyze, synthesize, recommend) runs only on the local Node process. Vercel serverless timeouts (10/60/300s by plan) preclude running this on the demo, and the `DEMO_MODE=true` guard 403s every mutating route, which is what removes the need for a queue. Local routes stream progress via SSE; closing the tab is fine, but **runs are not crash-resumable** — a local restart mid-run loses progress and the user re-clicks. Fine for a single-user self-hosted tool; multi-user hosting would need BullMQ + Redis or Inngest.

## Re-run behavior (what happens on the second scrape and beyond)

The first run is clean by definition — empty DB, fresh scrape. Repeat runs introduce complexity that this section captures in one place. None of these are optional; they're what prevent the app from breaking or silently lying on run 2+.

**`scrape_runs` table**: one row per scrape invocation (success, partial, or failed). Foundation for the "last scrape: X, diff Y" UI and failed-scrape recovery. Schema and write rules in `docs/scraping.md`.

**Ad upsert**: existing ads get `last_seen_at`, `is_active`, `days_active` updated; new ads inserted with full row; missing ads marked `is_active=false`. Creative and caption never overwritten — they're immutable per Meta's library ID.

**Analyzer versioning**: `ad_analyses.analyzer_version` is an auto-computed hash of the static prompt + schema. Mismatch surfaces a re-analyze banner in the dashboard. See `docs/ai-pipeline.md` task #2 for the hash logic and `docs/dashboard.md` for the banner UX.

**Synthesis and recommendations are user-triggered only**. The single biggest cost guardrail. Details in `docs/ai-pipeline.md` cost guardrails.

**Recommendation deduplication**: re-running the recommender doesn't replace the table — it reconciles by `stable_hash`. Full logic in `docs/ai-pipeline.md` task #4. `actioned_at` is DB-persisted (not localStorage) — required by the dedup reconciliation across devices.

**Score history is NOT tracked in v1**. Scoring is recomputed on every read from the current `ads` columns; only the latest score is stored in `performance_scores`. Trajectory views (sparklines, "climbing fast" filters) are deferred. Adding a `performance_score_history` table later is non-breaking — the current schema doesn't preclude it.

**Synthesis history is NOT tracked in v1**. Each re-synthesis overwrites the prior `competitor_syntheses` row. Deltas between synthesis runs (e.g., "Comparison dropped from 14 ads to 6") are deferred. The `recent_pivots` field continues to be the model's inference from the ad analyses, not a real diff. Acceptable for v1; upgradeable later.

## What lives where (and why)

| Concern | Location | Rationale |
|---|---|---|
| DB schema | `lib/db/schema.ts` | Drizzle convention; one source of truth |
| DB queries | `lib/db/queries.ts` | Centralized so both API routes and scripts use the same |
| AI prompts | `lib/ai/prompts/*.ts` | One file per task. Export as string constants. Easy to A/B. |
| Zod schemas | `lib/ai/schemas.ts` | Centralized so analyzer + tests share definitions |
| Provider abstraction | `lib/ai/client.ts` | The single Anthropic-or-Gemini decision point |
| Analyzers | `lib/ai/analyzers/*.ts` | One per task (incl. company profile generator). Pure: input → LLM call → validated output → DB write. |
| Scoring | `lib/scoring/performance-score.ts` | Pure functions, no I/O, unit-testable |
| Ad buckets | `lib/scoring/buckets.ts` | Pure predicates (`isWinner`, `isExperiment`, `isAbandoned`, `bucketOf`). Shared by synthesizer prompt builder and dashboard sections — single source of truth so the AI's bucket counts can't drift from what the UI shows. |
| Scraper | `scripts/scrape.ts` | CLI-only; also imported by `/api/competitors/:id/scrape`. Writes to `scrape_runs` on every invocation. |
| Website scraper | `scripts/scrape-website.ts` | Lightweight homepage+pricing+about crawl used only during onboarding and Re-scrape website. Separate from the Meta scraper. |
| Scrape run history | `scrape_runs` table | Foundation for "last scrape: X, diff Y" UI and future history features. |
| API routes | `app/api/**/*.ts` | Thin layer; import from `lib/` |
| Onboarding | `app/onboarding/page.tsx` + `/api/onboarding/*` | Runs once; creates the `self` competitor + `context/company.md` |
| User company profile | `context/company.md` | The single auto-generated, user-editable file. Source of truth for positioning. |
| UI components | `components/` + `app/**/page.tsx` | Server components by default |

## Deletion behavior

When a competitor is removed from the dashboard (via the `⋯` menu on the card):

- The `competitors` row is **soft-deleted** (`deleted_at` timestamp set, never a hard `DELETE`). All foreign-key rows (`ads`, `ad_analyses`, `competitor_syntheses`, `scrape_runs`, `performance_scores`) stay in place — they're history, not garbage, and the recommender may have cited their ads as evidence.
- Dashboard, swipe file, and recommender filter out soft-deleted competitors by default (`WHERE deleted_at IS NULL`). Centralize this filter in `lib/db/queries.ts` — every read-path query goes through it.
- **`recommendations` rows that cite ads from a deleted competitor are NOT auto-archived** — the advice may still be sound. Cited ad thumbnails in the evidence row render with a "Source removed" tag (same treatment as paused ads).
- The `self` competitor cannot be deleted. The remove button is hidden on its card, and the API route rejects `delete` on a row where `status='self'` with a 400.

## Failure boundaries

- **Scraper fails** (Meta changed DOM): scrape script writes error + screenshot to `data/scrape-errors/{competitor-id}-{timestamp}/`. UI surfaces a card with "View error" link.
- **Analyzer fails** (schema validation): retry once, then mark ad with `analysis_failed_at` timestamp. UI shows a "Retry" button.
- **Provider rate limit**: exponential backoff in `lib/ai/client.ts`. Surface progress to UI via SSE.
- **DB locked** (concurrent writes): better-sqlite3 is synchronous and single-threaded so this shouldn't happen, but if it does, the API route returns 503 and asks the user to retry.

## Performance constraints

- Demo dashboard must load in < 1 second from a cold cache. Server components + SQLite reads make this easy. Don't add client-side data fetching that defers the first paint.
- Analyzing one ad should complete in < 10 seconds end-to-end. If it takes longer, something is wrong with the prompt or the provider.
- The bundled `demo-snapshot.json` should stay under 5 MB so the repo clone is fast.

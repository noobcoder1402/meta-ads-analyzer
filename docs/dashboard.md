# Dashboard

Read this before adding a page, route, or shadcn component.

## Next.js conventions in this project

- **App Router only.** No `pages/`. Routes live in `app/`.
- **Server components by default.** Add `'use client'` only when you need state, effects, or browser APIs. Most pages should be server components that read SQLite directly.
- **Don't use `getServerSideProps`, `getStaticProps`** — App Router patterns only.
- **Data fetching**: in server components, call `lib/db/queries.ts` functions directly. Don't fetch through your own API routes from a server component (that's a network hop for nothing).
- **Loading and error states**: use the App Router conventions — `loading.tsx` and `error.tsx` in each route segment.

## Page-by-page specifications

Each page below specifies: data shown, layout, key interactions, and required states (empty, loading, error). Component implementation details are left to Claude Code, but the information architecture below is not optional.

### Layout shell (`app/layout.tsx`)

- **Top nav** (sticky): logo+name on left, nav items center (`Competitors` / `Insights`), settings icon right (theme toggle, link to GitHub). The user's own company profile is edited from the "Your company" card on the Competitors grid — no separate Context nav item. (There is no Swipe File or per-competitor detail page — both were removed 2026-06-22; see `changelog.md`.)
- **Demo mode banner** at top when `DEMO_MODE=true`: *"You're viewing the live demo with cached data. [Clone on GitHub →]"*. Dismissible per-session via localStorage.
- **Dark theme by default.** No theme toggle visible in v1.
- Max content width: 1280px, centered with horizontal padding.

### Onboarding (`app/onboarding/page.tsx`)

**Purpose**: one-time setup that collects the user's own company and bootstraps the `self` competitor + auto-generated profile. Runs on first launch (when no `self` competitor exists in the DB). Demo mode skips this entirely — the demo ships with a pre-seeded `self` competitor.

**Step 1 — Single screen, two inputs**:

```
What is your company name?
[ Company name or website URL                     ]
[ Meta Ad Library page URL (optional)             ]
                                    [ Continue → ]
```

Help text under the Meta field: "Don't have one handy? We'll search for it automatically."

**Step 2 — Background work + progress strip** (no user interaction needed):

After `Continue`, show a progress strip with three steps. Stream via SSE:

- "Scraping your website..." ✓ (visits homepage + pricing + about page if discoverable)
- "Checking Meta Ad Library..." ✓ (if no URL was provided, searches by company name; if URL provided, validates it)
- "Generating profile..." ✓

Takes ~10-15 seconds. If the user closes the tab the work completes anyway.

**Step 3 — Confirmation screen**:

```
Here's what we understood about your company:
[Editable profile — see Company profile editor below]

Which country's ads should we analyze?
[ Dropdown: All countries | United States | United Kingdom | India | ... ]
  Help text: "Meta's Ad Library is country-scoped. Pick one specific 
  country to focus on, or 'All countries' to ignore the filter. 
  You can change this later per scrape."

Meta ads:
  ✓ Found page: facebook.com/acme — 12 active ads
  (or)
  ⚠ Found page: facebook.com/acme — no active ads
  (or)
  ✗ No Meta page found. [Add one manually →]

                  [ Looks good — continue → ]
```

The profile is editable inline before continuing. **Important**: do NOT auto-scrape the Meta ads here. The user clicks Scrape on their `self` card after onboarding completes. Show the ad count as a preview only.

The country selector is a single dropdown — exactly one option selected. Default is `All countries` if the user didn't otherwise indicate a market during onboarding. The chosen value is stored as a user preference and becomes the default for every subsequent scrape (user can override per-scrape from the `Scrape ads` button's dropdown). It governs which Meta Ad Library view is scraped.

**Step 4 — Land on `/competitors`**. The `self` card is now created and pinned. The user can click `✨ Suggest 10 competitors` from the header to populate the `Suggested` section (see Suggest competitors below).

**Fallback — both website scrape AND Meta search fail**:

Show a textarea: "We couldn't find much information automatically. Tell us about your company in a few sentences." The text becomes the seed for the auto-generated profile.

**States**:
- *Disambiguation needed* (Meta search returns multiple plausible pages): show a "Which one is yours?" picker with up to 3 candidates (favicon, page name, follower count). Don't block the flow if the top match is high confidence; only show the picker for genuinely ambiguous matches.
- *Website scrape thin* (one-pager with little content): proceed but mark the relevant profile fields as "Add detail →" prompts in the confirmation screen.



**The "Your company" card is always pinned at the top of the grid** (status `self`). It looks like any other competitor card but with a `Your company` badge instead of `Accepted`/`Suggested`/`Manual`, sits in its own row above the others, and cannot be removed. Its actions live on the card itself (Set Meta page / Scrape ads / View on Meta).

If the user reached the dashboard without completing onboarding, they are redirected to `/onboarding` first (see Onboarding flow below).

**Data shown** (per card):
- Brand name + favicon (or first-letter avatar fallback)
- Status badge: `Your company` / `Accepted` / `Suggested` / `Manual`
- For a `self` card with no Meta page yet, shows "No Meta page connected — [Add →]".
- **Scrape summary line** (from the latest `scrape_runs` row): "Last scrape: 2h ago — 3 new, 25 unchanged". For never-scraped, shows "Never scraped". For failed last run, shows "Last scrape failed 1h ago — [View error]" in a warning color.
- **One primary action button** per card: `Set Meta page` (no verified page) or, once a page is set, **`View on Meta ↗`** (opens the brand's Meta Ad Library page — the per-competitor detail page was removed, so the real ads are viewed on Meta). `Scrape ads` sits alongside.
- **A secondary `⋯` menu** carries `Remove` (hidden on the `self` card). Per-brand analysis lives on the **Insights** page, not per-card.

**Layout**: responsive grid, 3 columns on desktop / 2 on tablet / 1 on mobile. Cards equal height. The `self` card occupies its own row at the top, spanning a single card width on desktop with a visual separator below it.

**Filter row above grid**: `All` / `Accepted` / `Suggested` pills. URL state. The `self` card is never filtered out; it always renders above the filter row.

**CTA row** in the page header: `+ Add competitor` (manual) and `✨ Suggest 10 competitors` (inline AI flow — populates the `Suggested` section, excluding already-tracked competitors).

**States**:
- *Empty (only `self` card present, no suggestions accepted yet)*: the `Tracked competitors` section shows a dashed-border empty state pointing back at the header CTA ("Click ✨ Suggest 10 competitors above, or add one manually").
- *Loading*: skeleton cards.
- *Error*: card-level error with retry; never crash the whole page.

### Removed pages (2026-06-22)

The **Swipe File** (`app/swipe-file/`) and the **per-competitor detail page**
(`app/competitors/[id]/`) — along with their ad grid, ad-detail dialog, breakdown matrix,
and the whole `lib/scoring/` engine that fed them — were removed. The product is now two
surfaces: the **Competitors** list (add/manage/scrape) and the **Insights** comparison. The
actual ad creatives are viewed on Meta itself via each card's **View on Meta ↗** link. Don't
reintroduce a per-ad "score" or Winner/Flopped bucket.

### Scrape ads dialog — scrape mode + market mode (`components/scrape-ads-dialog.tsx`)

Shared by every competitor card (incl. the `self` card). Two independent radio groups, each option with a one-line plain-language trade-off:

**"Which ads to pull?"** (the scrape mode → sent as `mode`, routed through `scrapeCompetitorByMode`):

| Mode | Sends | Copy emphasis |
|---|---|---|
| **All active ads** | `mode: "active"` | "Every ad the brand is running right now. Uncapped. Fastest." |
| **All active + sample of paused** (default) | `mode: "active_plus_sample"` | "Every active ad, plus up to 200 paused ads as a sample of what they've retired. Balanced." |
| **All active + all paused** | `mode: "active_plus_all"` | "Every ad ever, live and paused. Most complete — can take several minutes for big brands." |

**"Which market?"** (orthogonal):

| Mode | Sends | Copy emphasis |
|---|---|---|
| **All countries** (default) | `country: "ALL"` | "Widest volume and the most reliable live/paused status. Meta hides which country each ad runs in." |
| **Specific country** | `country: <code>` (reveals a ~18-country dropdown, defaults to home country) | "Scopes to one market — for investigating a single country." |

There is **no ad-count picker** anymore — the mode decides the slice; active/all are uncapped, only the paused sample is bounded (200). The dropdown country list (`COUNTRY_OPTIONS`) comes from `lib/markets.ts`. See `docs/scraping.md` "Scrape mode" + "Country selection" for engine behavior (incl. why the active pass runs last, and why "All" records no country). The scrape streams progress over SSE; closing the dialog doesn't kill the server-side run.

### Insights (`app/insights/page.tsx`)

**The cross-competitor comparison hub** — a stack of deterministic, zero-AI side-by-side tables. Server component (`force-dynamic`); reads nothing AI, calls `loadCrossAnalysis()` (`lib/analysis/load.ts`), which runs every active competitor's ads through `analyzeCompetitor` + `analyzeAcross`, recomputed on every request (no analysis table, no cache).

- **Layout: brands as columns, metrics as rows** (a spec-sheet — best for the handful of brands tracked). The `self` brand column is pinned first and highlighted with a "You" tag.
- **Tables** (each a `Card` + `ComparisonTable`; the UI title is in **bold**, the internal concept in parens): **Head-to-head overview** (Total / Active / Inactive ad counts + "Unique active ads" = distinct-live-creatives via `collation_id`, the de-confounded volume number) · **How long ads have run** (longevity tiers, live only, `count (% of that brand's active ads)`, neutral run-length bands — NOT a quality score) · **Languages (segment-lensed)** · **Company scale & regional reach** (the ONE external-data block — see below) · **[Creative & messaging — segment-lensed]** Creative mix · Ad structure (DCO ≠ carousel) · **Button mix** (CTA mix) · Copy length (fixed order Short→Medium→Long) · Messaging (top repeated phrases) · **Where ads run** (placement spread) · **Landing pages** (each brand's top host+path offers — domain alone is useless since every brand links to itself) · **Advertiser & launch pace** · **Your gaps** (`SelfGapTable`, only when a `self` brand exists). **Note:** UI titles are written for an external reader (no `collation_id`, no "DCO", no "n-gram") — see "Writing user-facing copy" below; the internal names here are for the codebase only.
- **Company scale & regional reach (`company-scale-table.tsx`) — the one EXTERNAL-DATA exception**: every other table is deterministic math over scraped ads; this one is hand-curated company-level context (revenue/ARR, paying customers, valuation, HQ, countries + strongest regions) sourced from public filings (audited) and, for private ClickUp, self-reported/third-party numbers. It is deliberately **fenced off** — an amber "External context — not from Meta ad data" banner, an `est.` badge on every estimate, and per-brand source links — so it never contaminates the ad-derived metrics or the "never claim spend/reach/market-share from Meta data" rule (that rule is about *inferring* from the ad library; clearly-cited external facts are a different provenance). Figures are **static** — keyed by lowercased competitor name in the component; update by hand when sources refresh. Its "Read" line notes where the ad-language signal cross-validates the filings (ClickUp Portuguese↔Brazil, Asana German/French↔EMEA).
- **Sticky segment filter** (`SegmentToggle`, URL-param `?segment=all|active|inactive` — server-rendered `Link`s, no client state): lives in a **sticky bar pinned under the top nav** (`sticky top-14 z-40`, full-bleed via negative margins + backdrop blur) so it's reachable from anywhere on the page. Labels are **All ads / Active ads / Inactive ads**. `active` = every currently-live ad (`isLive`); `inactive` = the complement (paused/ended); they partition `all`. No value judgment — just live vs not-live. Re-lenses the "Creative & messaging" group, computed in the page from `brands[].ads` filtered by `inSegment` (the loader exposes raw ads for this). Each affected `Section` shows a small **segment badge** (the `tag` prop) when a non-`all` segment is active, so it's obvious which tables changed. **The Languages table is also segment-lensed** (same `segAds`/`segColumns`/`filterTag` treatment via `aggregateLanguages` per segment). **Sample-size guard:** each segmented column shows its `n`; columns under `MIN_SAMPLE` (8) are greyed (`BrandColumn.muted`) because the shares aren't reliable. The other tables (overview, longevity, advertiser, gaps, and the external company-scale block) always show all ads.
- **Per-section "Read"**: each `Section` renders a 1–2 line **deterministic** takeaway beneath its table (`overviewRead`/`longevityRead`/… in `page.tsx`). No AI. **Facts only — a leader on a clearly-defined metric or a ranked list. NO causal/behavioural inference** (no "stops its ads early", "leans on video"), **no confounded raw counts** (raw volume is inflated by ad-duplication build style — lean on distinct creatives + within-brand shares), and **no quality verdicts** (a long run is not "proof it works"). This is a hard rule — the reads regressed into causal claims once and were stripped back. Shown on all-ads tables only (lensed tables hide the read in any non-`all` segment view). Metric definitions (active/inactive, distinct creatives) live as `hint` sub-labels on the rows.
- **AI strategic-insights panel** (top of page, `strategic-insights.tsx`): user-triggered Opus narrative over the deterministic numbers, cached in `ai_insight_reports`. Leads with a "how to read longevity" caveat (a long run is strategy-biased, not a quality score). See `docs/ai-pipeline.md`.
- **Components**: `app/insights/_components/comparison-table.tsx` (reusable, dumb — takes pre-formatted string cells, `null` → "—") and `self-gap-table.tsx`. Both server components rendering the shadcn `table` primitive.
- **Empty states**: no competitors → prompt to add some; competitors but no scraped ads → prompt to scrape. **Re-scrape-dependent rows** (page followers, launch velocity) show "—" until each brand is re-scraped (those columns post-date the current ads).
- **Download raw data (CSV)**: a styled `<a href="/api/raw-data" download>` in the page header (server-rendered, `buttonVariants`). Streams every scraped ad as a CSV (`GET /api/raw-data` → `getAllAdsForExport`) for manual analysis in Excel/Sheets — brand name + ~24 human-labelled columns (copy, CTA, dates, run length, status, placements, landing URL, etc.), UTF-8 BOM so non-English copy renders. It's a READ, so it's unguarded and works in the demo. No on-screen preview page (user chose download-only).
- Read-only — no writes, so it works on the Vercel demo.

### Company profile editor (accessed from the `self` competitor card)

**Purpose**: edit the auto-generated `context/company.md` that describes the user's own company. There is no standalone `/context` page, and (since the per-competitor detail page was removed) no `Ads` tab — the profile editor is reached from the `self` card's actions on `/competitors`.

**Layout**:
- Profile editor content:
  - Markdown editor with live preview (e.g., `@uiw/react-md-editor`).
  - Sections rendered with inline help text:
    - `## What we do` — auto-filled from website scrape
    - `## Who we serve` — auto-filled from website scrape
    - `## How we're different` — auto-filled from website scrape
    - `## Goals` — empty by default. Help text: "Optional. What are you trying to achieve? (e.g., 'Test founder-led content this quarter')"
  - `Save` button (auto-save on blur is fine).
  - `Re-scrape website` button. Behavior is non-destructive: opens a diff view showing the new auto-generated draft alongside the current saved version, with manual edits preserved by default. User explicitly chooses which sections to overwrite. Never silently replaces user edits.
  - `Re-search Meta page` button (visible only when no Meta page is connected, or when the connected page is suspected wrong).

**Single file rule**: there is exactly one user-editable context file, `context/company.md`. There are no `current-angles.md` or `goals.md` files — goals (if any) live in the `## Goals` section of the same file.

**Demo mode**: editor renders read-only with a banner — "Demo mode: clone the repo to edit your company profile."

**States**:
- *Just-onboarded (profile freshly generated, never edited)*: highlight the editor with a "Review and edit before continuing" callout.
- *Meta page connected but no ads scraped yet*: in the Ads tab, show "Click 'Scrape ads' on this card to pull your own active ads." Scraping is never automatic — user always clicks.

### Suggest competitors (inlined into `/competitors`)

**Purpose**: AI-driven competitor discovery from the user's company profile. Lives directly on `/competitors` — there is no separate `/suggest` page. The flow is: click the `✨ Suggest 10 competitors` button in the page header → suggestions appear as a `Suggested (N)` section between the user's `self` card and the `Tracked competitors` grid.

**Layout**:
- Header CTA row: `+ Add competitor` (manual) and `✨ Suggest 10 competitors` (AI, calls `POST /api/competitors/suggest`).
- `Suggested` section (only rendered when `suggestions.length > 0`): cards in vertical list form, each with brand name, AI rationale, "Likely Meta Page" link, `Accept` / `Reject` buttons.
- On accept/reject, the card stays in place but transforms visually (`✓ Accepted` badge, or struck-through `Rejected`). On next page load, accepted cards have moved to the `Tracked competitors` grid (DB status flip from `suggested` → `accepted`) and rejected cards are soft-deleted.
- Already-tracked competitors are filtered out *before* the AI call (`getActiveCompetitors().map(c => c.name)` passed as the exclude list).

**Why inline, not its own page**: the original `/suggest` page added a navigation step with no value — the user is already on `/competitors`, and that's where the accepted cards land. Two surfaces meant two refreshes, two mental models, and a worse "where did the card go?" experience. One page = one place where competitors live.

**States**:
- *No `self` competitor yet* (user hasn't completed onboarding): the parent page redirects to `/onboarding`.
- *AI overloaded* (Anthropic 529 after retry): the `SuggestButton` surfaces a friendly inline message ("Claude is temporarily overloaded. Please try again in a moment."). The button stays clickable.
- *Thin profile* (deferred): would show a soft "Better profile = better suggestions" banner. Not yet implemented.

## Loading and error conventions

- Every route has a `loading.tsx` with skeletons matching the page layout — never blank screens.
- Every route has an `error.tsx` showing a friendly message + retry button + "Submit issue" link.
- Long-running operations (scrape) show progress via SSE in a persistent strip at the top of the relevant page. Strip stays until completion. Never block the whole UI.

## Repeat-run conventions

These rules cover what the UI does on second and subsequent scrapes. They exist so the app feels alive rather than static, and so users don't get surprise bills.

- **Scrape summary toast**: every completed scrape shows a toast: "Notion: 28 ads found — 3 new, 25 already tracked, 2 went inactive." Data comes from the latest `scrape_runs` row. The same diff is reflected in the competitor card's scrape summary line until the next scrape.
- **Contextual button labels**: the primary card button label is driven by state: `Scrape ads` / `Set Meta page` / `Re-scrape (last: 2d)`. Plain language only — no internal jargon.
- **Failed-scrape state**: if the latest `scrape_runs` row has `status='failed'`, the competitor card shows the error inline ("Last scrape failed: Meta DOM changed") with a `View error` link to the error directory and `Retry` button.
- **Never auto-trigger paid work on a schedule**: scraping is the only heavy job and is always an explicit user click. Hints and badges are fine; auto-runs are not.
- **Pruning accumulated dead ads (`pnpm clean:ads`)**: a CLI-only maintenance command (no UI button). It deletes ads that are BOTH paused (`is_active = false`) AND have no successful `ad_analyses` row, cascading to their orphaned `ad_analyses` rows and creative files. Keeps every active ad and every ad with an analysis row. Pure, zero AI, demo-guarded; `--dry-run` previews. See `docs/scraping.md` "Pruning dead ads."

## Information hierarchy rules

- **The Insights comparison is the product.** The side-by-side, brand-as-columns spec sheet is what the tool sells — the Competitors page is just where you add brands and trigger scrapes.
- **Facts over verdicts.** Every surfaced number is descriptive (run length, active/inactive, mix share). There is no "score" or "winner/flop" label anywhere — Meta exposes no spend/results, so the UI never editorializes an ad as good or bad.
- **Neutral, defined metrics.** Each row carries a `hint` defining exactly what it counts; shares are always "% of ads", never "% of spend".

## Writing user-facing copy

**Every word a user reads must be written for an external, non-technical marketer — NOT for us, the builders.** This is a hard rule, applies to all UI copy (page text, table titles, hints, captions, button labels, empty/error states) AND the AI strategic-insights output (the prompt carries the same rule).

- **Plain English, short sentences.** If you'd have to explain a sentence out loud, rewrite it.
- **No internal jargon.** Banned from user-facing copy: Meta field names (`collation_id`, `ad_archive_id`, `landing_url`, `active_status`), math/eng terms (`deterministic`, `de-confound`, `n-gram`, `document-frequency`, `DCO` without a gloss, `segment`, `pivot`), and insider phrasing ("the fairest volume read", "build style", "ad-sets" → say "campaigns").
- **Explain any unavoidable term inline, in a few plain words.** e.g. "dynamic creative — one ad that rotates several versions", "unique active ads — each ad counted once even when reused".
- **Never verbose.** Cut every word that isn't pulling weight. A caption is one or two sentences, not a paragraph.
- **Say what it means, not how it's computed.** "How long each brand's running ads have been live" beats "median days_active over the live-segment partition".
- When you add or edit UI copy, re-read it as if you'd never seen the codebase. If a term only makes sense because you wrote the code, it fails.

## API routes

`GET` routes that only READ (e.g. `GET /api/raw-data`, the CSV export) need no demo guard — they don't write or call paid AI, so they're safe on the Vercel demo. Only state-changing routes need the guard below.

All `POST`/`PUT`/`DELETE` routes MUST start with the demo guard:

```ts
if (process.env.DEMO_MODE === 'true') {
  return NextResponse.json(
    { error: 'Demo mode: write operations are disabled. Clone the repo to use full functionality.' },
    { status: 403 }
  );
}
```

This is non-negotiable. Add a unit test that fails if any mutating route lacks this guard.

Long-running routes (scrape) use **Server-Sent Events** to stream progress:

```ts
// app/api/competitors/[id]/scrape/route.ts
export async function POST(req: Request, { params }) {
  // demo mode guard...
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of scrapeCompetitor(params.id)) {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

Client consumes via `EventSource` or `fetch` + reader. Show progress in the UI as it arrives.

## shadcn / Tailwind conventions

- **All UI primitives from `components/ui/`.** If a needed primitive isn't there, install it: `pnpm dlx shadcn@latest add <component>`.
- **Project components go in `components/`** (not in `app/`). One component per file. Named exports.
- **Dark-mode-first.** Background is dark. Use the shadcn default dark theme tokens. Don't write light-mode overrides unless explicitly adding light mode.
- **No raw colors.** Use Tailwind tokens that map to CSS variables (`bg-background`, `text-foreground`, `border-border`). This keeps the theme consistent and switchable later.
- **Spacing scale**: stick to Tailwind's default scale. Don't write arbitrary values like `mt-[13px]`.

## State and interactivity rules

- URL state over component state for filters, sort, selected tab — `useSearchParams` + `router.replace`. Free shareable links and back-button behavior.
- Mutations: `'use server'` actions or POST to API routes, then `router.refresh()`.
- No client-side data caching libraries (no SWR, no React Query) — server components handle this.

## Demo mode UI behavior

When `process.env.DEMO_MODE === 'true'`:

- Demo ships with a pre-seeded `self` competitor; onboarding skipped on first visit.
- All write-action buttons render disabled with tooltip: "Demo mode — clone the repo locally to use this."
- `CompanyProfileEditor` is read-only.
- Persistent banner at top: "You're viewing the live demo with cached data. [Clone on GitHub →]"
- Don't hide features — disabled-with-tooltip so visitors understand the tool.

## Performance and accessibility

- Server-render dashboard pages from SQLite. First paint must not depend on client fetches.
- Don't import the Anthropic/Gemini SDKs into client components — keep AI in API routes or server actions.
- Next.js `<Image>` with the local `data/ad-creatives/` path; `images.unoptimized = true` for the demo.
- shadcn primitives cover keyboard focus, label association, and color-plus-text patterns. Don't fight them. Status badges already pair color with text.

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

- **Top nav** (sticky): logo+name on left, nav items center (`Competitors` / `Swipe File` / `Insights`), settings icon right (theme toggle, link to GitHub). The user's own company profile is edited from the "Your company" card on the Competitors grid — no separate Context nav item.
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

The country selector is a single dropdown — exactly one option selected. Default is `All countries` if the user didn't otherwise indicate a market during onboarding. The chosen value is stored as a user preference and becomes the default for every subsequent scrape (user can override per-scrape from the `Scrape ads` button's dropdown). Conversion goal and brand voice are NOT collected on this screen — they're per-ad data points extracted by the creative analyzer from each ad's CTA and copy, not user-level fields.

**Step 4 — Land on `/competitors`**. The `self` card is now created and pinned. The user can click `✨ Suggest 10 competitors` from the header to populate the `Suggested` section (see Suggest competitors below).

**Fallback — both website scrape AND Meta search fail**:

Show a textarea: "We couldn't find much information automatically. Tell us about your company in a few sentences." The text becomes the seed for the auto-generated profile.

**States**:
- *Disambiguation needed* (Meta search returns multiple plausible pages): show a "Which one is yours?" picker with up to 3 candidates (favicon, page name, follower count). Don't block the flow if the top match is high confidence; only show the picker for genuinely ambiguous matches.
- *Website scrape thin* (one-pager with little content): proceed but mark the relevant profile fields as "Add detail →" prompts in the confirmation screen.



**The "Your company" card is always pinned at the top of the grid** (status `self`). It looks like any other competitor card but with a `Your company` badge instead of `Accepted`/`Suggested`/`Manual`, sits in its own row above the others, and cannot be removed. Clicking it opens the competitor detail view (where the user edits their company profile — see Company profile editor below).

If the user reached the dashboard without completing onboarding, they are redirected to `/onboarding` first (see Onboarding flow below).

**Data shown** (per card):
- Brand name + favicon (or first-letter avatar fallback)
- Status badge: `Your company` / `Accepted` / `Suggested` / `Manual`
- **Bucket mini-summary**: three small inline counts — *"12 winners · 3 new · 5 dropped"*. Each count is a link that scrolls the competitor detail page to its corresponding section. Predicates come from `lib/scoring/buckets.ts` (see `docs/scoring.md`). For a `self` card with no Meta page yet, shows "No Meta page connected — [Add →]" instead.
- Top scoring ad's score (folds into the winners count tooltip)
- Dominant angle pill (the most-used angle from `competitor_syntheses`)
- **Scrape summary line** (from the latest `scrape_runs` row): "Last scrape: 2h ago — 3 new, 25 unchanged, 2 went inactive". For never-scraped, shows "Never scraped". For failed last run, shows "Last scrape failed 1h ago — [View error]" in a warning color.
- **One primary action button** per card, label determined by the card's current pipeline state. The card always shows the single most obvious next step, in plain language:

  | Card state                                       | Primary button label          | Button style       |
  |--------------------------------------------------|-------------------------------|--------------------|
  | Never scraped                                    | `Scrape ads`                  | Primary, solid     |
  | Scraped, N unanalyzed (N > 0)                    | `Analyze {N} ads`             | Primary, solid     |
  | All ads analyzed, no synthesis yet               | `Find patterns`               | Primary, solid     |
  | Synthesis older than latest scrape               | `Refresh patterns ({age})`    | Primary, outlined  |
  | Fully up to date                                 | `Re-scrape`                   | Ghost / secondary  |

  Plain language only. No internal jargon in user-facing copy — "Find patterns" not "Synthesize," "Analyze N ads" not "Analyze unanalyzed." If a user has to read docs to understand a button label, the label is wrong.

- **A secondary `⋯` menu** for everything else, contextual to state: `Re-scrape`, `Re-analyze all` (only listed when drift detected), `Regenerate from full ad set` (only listed when synthesis exists and competitor has >50 analyzed ads), `Remove` (hidden on the `self` card).

- **Inline drift alert** on the card body (not a button) when `analyzer_version` mismatch is detected on one or more rows:

  > ⚠ Analyzer updated — 23 ads have outdated analyses. [Re-analyze →]

  Tapping the link opens the cost-estimate confirmation modal documented in the Repeat-run conventions section below. Dismissible per session; returns next session until cleared.

This collapses the previous three-to-four parallel buttons into one obvious next action plus a discoverable menu. Users always see the one thing the card needs them to do next; re-runs and dangerous actions are reachable but not in their face. The state machine is computed from existing DB state — no new schema columns required.

**Layout**: responsive grid, 3 columns on desktop / 2 on tablet / 1 on mobile. Cards equal height. The `self` card occupies its own row at the top, spanning a single card width on desktop with a visual separator below it.

**Filter row above grid**: `All` / `Accepted` / `Suggested` pills. URL state. The `self` card is never filtered out; it always renders above the filter row.

**CTA row** in the page header: `+ Add competitor` (manual) and `✨ Suggest 10 competitors` (inline AI flow — populates the `Suggested` section, excluding already-tracked competitors).

**States**:
- *Empty (only `self` card present, no suggestions accepted yet)*: the `Tracked competitors` section shows a dashed-border empty state pointing back at the header CTA ("Click ✨ Suggest 10 competitors above, or add one manually").
- *Loading*: skeleton cards.
- *Error*: card-level error with retry; never crash the whole page.

### Competitor detail (`app/competitors/[id]/page.tsx`)

**Header strip**:
- Breadcrumb: `← All competitors`
- Brand name (large), favicon
- Stat row: active ads count, top angle pill, top score, last scraped timestamp
- Action buttons: same state-machine primary action as on the home card (`Scrape ads` / `Analyze {N} ads` / `Find patterns` / `Re-scrape`), plus a `⋯` menu (Re-scrape, Re-analyze all, Regenerate from full ad set, Remove)

**Scrape ads dialog — two market modes** (`components/scrape-ads-dialog.tsx`, shared by the home cards and this page): the dialog's "Which markets?" radio group offers two mutually exclusive modes, each with a one-line plain-language trade-off so the user understands what they're choosing:

| Mode | Sends | Copy emphasis |
|---|---|---|
| **All countries** (default) | `country: "ALL"` | "Widest volume and the most reliable live/paused status. Meta hides which country each ad runs in." |
| **Specific country** | `country: <code>` (reveals a ~18-country dropdown, defaults to home country) | "Scopes to one market — for investigating a single country." |

The `ad cap` picker (25/50/100) is per scrape. The dropdown country list (`COUNTRY_OPTIONS`) comes from `lib/markets.ts`. See `docs/scraping.md` "Country selection" for the engine behavior, including why "All" deliberately records no country. (The old third "Geo sweep" mode and the whole per-country footprint feature were removed — Meta exposes essentially no reliable per-ad geography.)

**"Ad strategy" summary card** (`app/competitors/[id]/_components/synthesis-panel.tsx`) — redesigned 2026-06-03 around three reader-first hero sections + a secondary profile. The old flat stack of ~11 equal-weight enum-badge rows is gone (it read as jargon and buried the signal).

- **Plain-English takeaway** (one line, from the synthesis tallies): e.g. *"Mostly Product demo ads (35%), leading with a 'Sign Up' CTA, in a professional voice."* Angle codes render via the shared `lib/ai/angle-info.ts` label map; the selling motion is the **raw Meta CTA** (from `dominant_ctas`), never the internal conversion-goal taxonomy.
- **🏆 Winners — what's working** (grouped by angle): the strict always-on set (score ≥70, 60+ days), derived **directly from the ad data** (`classify()` from `buckets.ts`), so it renders even before "Find patterns" is run. Rendered **grouped by angle**: each angle block shows its label + blurb (from `angle-info.ts`), then 2-3 real example ad cards (reused `AdCard`) beneath it, ordered by ad count, with a "+N more" pointer to the full grid below. (Replaced the old text angle-list + flat thumbnail grid.)
- **⚰️ Tried & dropped — what they backed away from** (grouped by angle): now **derived client-side from the ad data** — the paused, non-winner, analyzed ads (the flopped + retired buckets) grouped by angle, same block shape as Winners (angle label + blurb, then 2-3 example creatives, "+N more"). It renders **even before "Find patterns" is run** and **no longer reads the synthesis's `abandoned_patterns` field** (that AI field is no longer used by this section).
- **🆕 What's new — recent launches**: live ads launched in the last **30 days** (`isActive && daysActive <= 30`), newest first. Opens with a one-line summary naming the dominant angle(s) among the recent set (`RecentAngleSummary`, e.g. *"Mostly Product demo, Social proof, and UGC-style angles."*), then real ad cards (capped at 6 with a "+N more" pointer). The sub line states the count ("36 ads launched in the last 30 days").
- **Profile** (secondary, cleaned into a fact sheet): *Voice · Selling motion (raw CTA split, e.g. "75% Sign Up · 20% Learn More" from `dominant_ctas`) · Media mix* as a 3-up row; *Pain points / Benefits* chip lists; *Languages they write in* (shown ONCE — the old duplicate localization block is removed); and a collapsed *All angles* distribution. (The "Hooks they lead with" list was **removed** — the real winner/dropped creatives now show their headlines directly.)

The reusable `AdCard` (+ `BUCKET_EMOJI`, `mediaPathToUrl`, `hostnameOf`) was extracted from `ad-grid.tsx` into `app/competitors/[id]/_components/ad-card.tsx` so the summary and the full grid share one card. Empty states are per-section and plain-language. Header button: `Find patterns` (none yet) / `Refresh patterns` (exists) / `Finding patterns…` (running).

The full filterable ad grid (`ad-grid.tsx`) still renders below the summary — the summary is curated highlights, the grid is the complete explorable list.

**Ads sections** — stacked sections (not tabs; tabs hide content) corresponding to the buckets defined in `docs/scoring.md`. Each section is a compact table showing the top 10 ads by score with a "View all {N} →" link that expands the section inline. URL state tracks which sections are expanded.

| Section header                  | Bucket                | Plain-language sub-header                                  |
|---------------------------------|-----------------------|------------------------------------------------------------|
| 🏆 **Winners** ({count})        | Winner                | *"Score 70+, running 30+ days"*                            |
| 🧪 **New & testing** ({count})  | Active experiment     | *"Live ads under 14 days old"*                             |
| 🌱 **Maturing** ({count})       | Maturing              | *"Live, 14–29 days — proving out, watch these"*           |
| ⚰️ **Flopped** ({count})        | Flopped               | *"Paused after a short run (under 14 days)"*               |

Sub-header text is rendered under each section title so users understand the categorization without reading docs. Within **Flopped**, ads whose creative reads as a deal/urgency push carry a **`Likely campaign`** tag (see `docs/scoring.md`) so a planned one-time promo isn't mistaken for a true flop — un-analyzed flops carry no tag.

**Other ads** (the implicit catch-all bucket — includes mid-score long-runners and proven-but-paused ads that ran a while then went quiet) hide behind a `Show all {N} other ads` toggle at the bottom of the page.

**Per-section table**:
- Columns: Thumbnail | Hook | Angle | Score | Days active | Variants | Placements
- Default sort within each section: Score desc
- All columns sortable (URL state, per section)
- Click row → opens drawer
- Angle multi-select filter above all three sections, applies across them

**Empty-section handling** — empty sections collapse to a single muted one-liner of the same height as a table row:
- Winners: *"No winners yet — no analyzed ad has score ≥ 70 with 30+ days active."*
- New & testing: *"No experiments in the last 14 days."*
- Maturing: *"Nothing in the 14–29 day window right now."*
- Flopped: *"No ads were pulled after a short run."*

**States**:
- *No ads scraped yet*: "No ads found yet. Click 'Scrape ads' to pull active ads from the Meta Ad Library." Sections don't render.
- *Ads scraped but not analyzed*: sections render (scoring is pure, doesn't need analyses) but Angle column shows "Run analyze →" inline button.
- *Loading scrape/analyze*: progress strip at top, sections render with skeleton rows.

### Ad detail drawer (`components/creative-breakdown-drawer.tsx`)

> **As-built (2026-05-30):** shipped as a **dialog (modal)**, not a slide-in drawer, at `app/competitors/[id]/_components/ad-detail-dialog.tsx` (Base UI `Dialog`). No standalone `app/competitors/[id]/ads/[adId]/page.tsx` page exists yet. The dialog covers items 1–10 below in a two-column layout (media + caption left; score breakdown + analysis right), except: the Variants bar is greyed out with a "Not tracked yet" note (the `variant_count` signal is still dead — see `changelog.md`), and the visual-breakdown swatches/conversion-goal/brand-voice pills (items 6–7, 10) are not yet rendered. The drawer + shareable standalone page remain the target design. (The footer no longer renders per-ad "Runs in" country badges — the footprint feature was removed.)

Opens from any ad row click. Slides in from the right, ~50% width on desktop, full-screen on mobile. Also available as standalone page at `app/competitors/[id]/ads/[adId]/page.tsx` for shareable links.

**Content**, top to bottom:
1. **Media preview**: image, video first-frame (with "Play on Meta" overlay), or carousel (swipeable). Aspect-ratio preserved.
2. **Score card**: big composite score (87), 4 horizontal bars beneath labeled Longevity / Variants / Placement / Recency with their point contributions. Hover/tap any bar for the methodology explainer. "Inferred score" footnote.
3. **Hook**: large quoted text, the extracted hook.
4. **Angles**: primary pill (larger) + secondary pill (smaller, muted).
5. **Caption**: full original ad caption in a quote block.
6. **CTA**: button label (the raw Meta CTA, e.g. "Sign Up") + landing URL (truncated, click to expand). The derived `conversion goal` is no longer surfaced as a pill here — it's computed and stored (`ad_analyses.primary_conversion_goal`) but internal-only now; the raw CTA is what's shown.
7. **Visual breakdown**: dominant colors as swatches (5 max), text density label, subject type. Two-column.
8. **Themes / Pain points / Benefits**: three columns of tag pills.
9. **Target persona**: prose paragraph.
10. **Tone & voice**: two labels side by side — `Emotional tone` (single label with color coding) and `Brand voice` pill (from `ad_analyses.brand_voice`, e.g., `playful`).
11. **Footer**: ad metadata — library ID, first seen, last seen, placements list, "View on Meta Ad Library →" external link. (Per-ad country badges were removed with the footprint feature.)

**States**:
- *Analysis missing*: drawer still shows media + caption + score + metadata, but the AI-analysis sections show "Not analyzed yet — [Run analysis]" inline button.

### Swipe file (`app/swipe-file/page.tsx`)

> **As-built (2026-05-31):** shipped. Server component (`force-dynamic`) loads three read-only cross-competitor queries (`getSwipeFileAds` / `getAllScores` / `getAllAnalyses`) and keys scores/analyses by `adId`; the interactive grid is `app/swipe-file/_components/swipe-grid.tsx`. Two intentional deviations from the spec below, both confirmed with the user: (1) **scope includes the user's own `self` ads** alongside competitors' — each card is brand-labeled and `self` ads read "Brand (You)" — not competitors-only; (2) the brand mark is a **letter avatar**, not a favicon. Also: filter/sort/toggle are **local React state, not URL state** (URL state is a future nice-to-have), and the empty-state gate is "no *scored* ads" (scoring is pure math, needs no AI analysis), linking to `/competitors`. The detail drawer reuses the competitor page's `AdDetailDialog` verbatim. The Maturing/Other buckets are not given their own sections (only Winners / New / Flopped, per spec).

**Purpose**: the "steal-worthy" gallery — what to copy and what to test next, across all tracked brands. Uses the same buckets as the competitor detail page (see `docs/scoring.md`).

**Layout**:
- Header: title + sort dropdown (Score / Longevity / Recently added). Applies within each section.
- **Angle filter pills row** (URL state): `All` + one per angle in taxonomy. Applies across sections.
- **Show dropped ads** toggle (default off). Off because the primary use case is "what should I copy"; dropped ads are the rarer "what to avoid" view.
- **🏆 Winners** — primary section. Grid of ad cards, 4 cols desktop / 2 mobile.
- **🧪 New & testing** — what competitors are currently launching. Leading-indicator view.
- **⚰️ Flopped** — shown only when toggle is on. Cards muted. Subtitle: *"What competitors pulled after a short run — useful as a 'don't replicate' reference."* Ads tagged `Likely campaign` are planned one-time promos, not failures.

**Card shape** (same in all sections):
- Thumbnail (square crop)
- Brand favicon + name (small)
- Score badge (top right corner overlay)
- Hook text (2 lines max, truncated)
- Angle pill at bottom
- Click → opens drawer

**States**:
- *No analyzed ads yet*: "Analyze at least one competitor to populate the swipe file." with link to home.
- *Filtered to zero in a visible section*: per-section empty state instead of a global one — *"No winners match these angles."* / *"No experiments in the last 14 days."* / *"No dropped ads match these angles."*

### Insights (`app/insights/page.tsx`)

**Purpose**: GTM recommendations from the cross-competitor recommender, plus one deterministic (non-AI) comparison view — a competitor scoreboard.

**Competitor scoreboard panel** (`app/insights/_components/competitor-scoreboard.tsx`, fed by `getSynthesesForActiveCompetitors`): a **non-AI, zero-cost** side-by-side table of every active competitor, with the user (`self`) pinned and highlighted at top (a "You" badge + tinted row). Every number is read straight from the saved `competitor_syntheses` rows — no model call — so it always reflects each competitor's last `Find patterns` run (each row shows a "synthesized {age}" staleness stamp). Columns: ads analyzed · media mix (image/video/carousel %) · launch velocity (new live ads 14d/30d) · language count · **top CTA** (raw Meta CTA from `dominant_ctas`, e.g. "Sign Up") · top brand voice · top angle · top 2 pain points · top 2 benefits. Angle codes pass through `lib/ai/angle-info.ts` (`angleLabel`); the CTA is the raw label (no goal taxonomy); brand voice is title-cased inline — so no jargon leaks. **Honest-data rules**: a competitor without a synthesis renders a muted "Not analyzed yet — run Find patterns" row (never silently dropped); if nobody has been synthesized, the panel shows a nudge instead of an empty table. The pain-point / benefit **shared-highlight** (an amber `◆`) fires only on an **exact, normalized match across the displayed top-2 of two or more distinct companies** — computed over the same slice that's shown so every `◆` has a visible twin, and never fuzzy (exact free-text AI strings rarely collide, so the highlight is deliberately rare-but-trustworthy). The table is horizontally scrollable on narrow screens rather than cramped. Sits alongside the AI recommender. (The former "Market gaps" panel was removed with the footprint feature.)

**Header strip**:
- Title + a subtitle line that explains the page and appends "· Last generated {age}" inline (from `recs[0].lastGeneratedAt`) once a set exists.
- No tab switcher. There is no `Archive` (or `Active`) view — recommendations are replace-on-run (see below).

**Generate / Regenerate** (`app/insights/_components/recommendations-panel.tsx`): a single button above the cards — `Generate recommendations` when none exist, `Regenerate` once a set exists, `Generating…` while running. Disabled in demo mode (with an explanatory line). Beside it, a fixed helper line: "One AI call (~$0.06). Replaces the previous set." There is no stale-age label on the button. On success the client calls `router.refresh()` to re-render the server component with the new set; a `status:"skipped"` response surfaces its `reason` inline rather than as an error.

**Replace-on-run** (the core model — full logic in `docs/ai-pipeline.md` task #4 and the "Recommendations are replace-on-run" convention in `CLAUDE.md`): each run fully replaces the previous set via `replaceRecommendations()` (delete old rows, insert new). There is **no** done/actioned state, **no** `New` badge, **no** archive, and **no** cross-run reconciliation. The only dedup is *within* a single run, by `stable_hash` = SHA-1(trimmed title + sorted evidence ad IDs). The `actioned_at` / `archived_at` columns still exist in the schema but are unused (always null) — left in place to avoid a SQLite table rebuild.

**Recommendation cards**, stacked vertically, sorted by priority:
- Priority badge (High / Medium / Low) — `high` → destructive, `medium` → secondary, `low` → outline.
- Title (large).
- Rationale (prose, 2-4 sentences).
- **Evidence row**: one monospace badge per cited ad, labeled with the Meta `library_id` and linking out to that ad on the Meta Ad Library (`facebook.com/ads/library/?id=<library_id>`) in a new tab. These are catalog-validated library IDs (see the "Recommendations cite only catalog ad IDs" convention) — not internal UUIDs, not thumbnails, and they don't open the in-app ad drawer. Hidden when a rec has no evidence.

**States**:
- *No recommendations yet*: "No recommendations yet" with guidance to synthesize at least one competitor (the "Find patterns" button) then click "Generate recommendations". The demo variant says the demo has no generated recommendations.

### Company profile editor (accessed from the `self` competitor card)

**Purpose**: edit the auto-generated `context/company.md` that describes the user's own company. There is no standalone `/context` page — the editor lives on the `self` competitor's detail page as a `Profile` tab alongside the normal `Ads` tab.

**Layout**:
- Tab switcher at the top of the `self` competitor detail page: `Profile` / `Ads`.
- `Profile` tab content:
  - Markdown editor with live preview (e.g., `@uiw/react-md-editor`).
  - Sections rendered with inline help text:
    - `## What we do` — auto-filled from website scrape
    - `## Who we serve` — auto-filled from website scrape
    - `## How we're different` — auto-filled from website scrape
    - `## Goals` — empty by default. Help text: "Optional. What are you trying to achieve? (e.g., 'Test founder-led content this quarter')"
  - `Save` button (auto-save on blur is fine).
  - `Re-scrape website` button. Behavior is non-destructive: opens a diff view showing the new auto-generated draft alongside the current saved version, with manual edits preserved by default. User explicitly chooses which sections to overwrite. Never silently replaces user edits.
  - `Re-search Meta page` button (visible only when no Meta page is connected, or when the connected page is suspected wrong).

**Single file rule**: there is exactly one user-editable context file, `context/company.md`. There are no `current-angles.md` or `goals.md` files — current angles are derived automatically from the user's own scraped ads via the synthesizer, and goals (if any) live in the `## Goals` section of the same file.

**Demo mode**: editor renders read-only with a banner — "Demo mode: clone the repo to edit your company profile."

**States**:
- *Just-onboarded (profile freshly generated, never edited)*: highlight the editor with a "Review and edit before continuing" callout.
- *Meta page connected but no ads scraped yet*: in the Ads tab, show "Click 'Scrape ads' on this card to pull your own active ads." Scraping is never automatic — user always clicks.

### Suggest competitors (inlined into `/competitors`)

**Purpose**: AI-driven competitor discovery from the user's company profile. Lives directly on `/competitors` — there is no separate `/suggest` page. The flow is: click the `✨ Suggest 10 competitors` button in the page header → suggestions appear as a `Suggested (N)` section between the user's `self` card and the `Tracked competitors` grid.

**Layout**:
- Header CTA row: `+ Add competitor` (manual) and `✨ Suggest 10 competitors` (AI, calls `POST /api/competitors/suggest`).
- `Suggested` section (only rendered when `suggestions.length > 0`): cards in vertical list form, each with brand name, AI rationale, "Likely Meta Page" link, `Accept` / `Reject` buttons.
- On accept/reject, the card stays in place but transforms visually (`✓ Accepted` badge with `Open →` link to the detail page, or struck-through `Rejected`). On next page load, accepted cards have moved to the `Tracked competitors` grid (DB status flip from `suggested` → `accepted`) and rejected cards are soft-deleted.
- Already-tracked competitors are filtered out *before* the AI call (`getActiveCompetitors().map(c => c.name)` passed as the exclude list).

**Why inline, not its own page**: the original `/suggest` page added a navigation step with no value — the user is already on `/competitors`, and that's where the accepted cards land. Two surfaces meant two refreshes, two mental models, and a worse "where did the card go?" experience. One page = one place where competitors live.

**States**:
- *No `self` competitor yet* (user hasn't completed onboarding): the parent page redirects to `/onboarding`.
- *AI overloaded* (Anthropic 529 after retry): the `SuggestButton` surfaces a friendly inline message ("Claude is temporarily overloaded. Please try again in a moment."). The button stays clickable.
- *Thin profile* (deferred): would show a soft "Better profile = better suggestions" banner. Not yet implemented.

## Loading and error conventions

- Every route has a `loading.tsx` with skeletons matching the page layout — never blank screens.
- Every route has an `error.tsx` showing a friendly message + retry button + "Submit issue" link.
- Long-running operations (scrape, analyze, synthesize, recommend) show progress via SSE in a persistent strip at the top of the relevant page. Strip stays until completion. Never block the whole UI.

## Repeat-run conventions

These rules cover what the UI does on second and subsequent scrapes. They exist so the app feels alive rather than static, and so users don't get surprise bills.

- **Scrape summary toast**: every completed scrape shows a toast: "Notion: 28 ads found — 3 new, 25 already tracked, 2 went inactive." Data comes from the latest `scrape_runs` row. The same diff is reflected in the competitor card's scrape summary line until the next scrape.
- **Contextual button labels**: the primary card button label is driven by pipeline state (see the table in the Competitors grid section). Ages are folded into the label when relevant — `Refresh patterns (5d)`, `Re-scrape (last: 2d)`. First-time actions use neutral labels (`Scrape ads`, `Find patterns`). No "Synthesize" or "Re-synthesize" in user-facing copy.
- **Re-analyze confirmation modal**: when the user clicks `Re-analyze all` (or when the analyzer-version-drift banner is clicked), show a modal: "Re-analyze 487 ads with the updated analyzer? Estimated cost: ~$1.95. This will overwrite existing analyses." Two buttons: `Yes, re-analyze` / `Cancel`. Never proceed without explicit click.
- **Analyzer drift banner**: when the dashboard detects that any `ad_analyses` row has an outdated `analyzer_version`, show a dismissible banner on the home grid: "Analyzer updated. 487 ads have outdated analyses. [Re-analyze all]". Dismissed per-session, returns next session until cleared.
- **Synthesis staleness hint**: on the competitor detail page, if the latest `competitor_syntheses` row is older than the latest `scrape_runs` row for that competitor, show a subtle hint above the synthesis card: "Synthesis is from before your last scrape. [Regenerate]". Hint only — no auto-action.
- **Failed-scrape state**: if the latest `scrape_runs` row has `status='failed'`, the competitor card shows the error inline ("Last scrape failed: Meta DOM changed") with a `View error` link to the error directory and `Retry` button.
- **Never auto-trigger paid work on a schedule**: scraping, analysis, synthesis, recommendations — all require an explicit user click. Hints and badges are fine; auto-runs are not.
- **Pruning accumulated dead ads (`pnpm clean:ads`)**: a CLI-only maintenance command (no UI button) for trimming the noise that builds up over many re-scrapes. It deletes ads that are BOTH paused (`is_active = false`) AND not successfully analyzed, cascading to their orphaned `performance_scores` + `ad_analyses` rows and the creative files on disk. It **keeps** every active ad and every successfully-analyzed ad (including paused analyzed ones — still signal for the synthesizer). Pure, zero AI cost, demo-mode guarded; `--dry-run` previews the deletions. See `docs/scraping.md` "Pruning dead ads."

## Information hierarchy rules

- **The score is the most prominent metric** on any ad card or row. It's what the whole product is selling.
- **The hook is the second most prominent**. It's the human-readable summary of "what is this ad."
- **The angle pill is the third**. It's the categorization that makes patterns visible.
- Everything else (caption, themes, persona) is supporting detail surfaced in the drawer, not in cards or rows.

## API routes

All `POST`/`PUT`/`DELETE` routes MUST start with:

```ts
if (process.env.DEMO_MODE === 'true') {
  return NextResponse.json(
    { error: 'Demo mode: write operations are disabled. Clone the repo to use full functionality.' },
    { status: 403 }
  );
}
```

This is non-negotiable. Add a unit test that fails if any mutating route lacks this guard.

Long-running routes (scrape, analyze, synthesize) use **Server-Sent Events** to stream progress:

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
- shadcn primitives cover keyboard focus, label association, and color-plus-text patterns. Don't fight them. The angle pills already pair color with text.

# Scraping

Read this before touching `scripts/scrape.ts`, `scripts/scrape-website.ts`, `lib/scraper/`, or anything Playwright. Meta's DOM is hostile.

There are three scrapers in this project:

1. **Meta Ad Library scraper** (`scripts/scrape.ts`) — the main one. Pulls ads for any tracked competitor. Covered in most of this doc.
2. **Meta page-ID resolver** (`lib/scraper/resolve-meta-page.ts`) — converts a brand name into a verified Meta `page_id` + canonical `view_all_page_id=<ID>` URL. Used by `scripts/backfill-meta-pages.ts` and (in the future) by the suggester / competitor `Find Meta page` UI.
3. **Website scraper** (`scripts/scrape-website.ts`) — lightweight, runs only during onboarding and when the user clicks `Re-scrape website`. Covered at the bottom.

> **Important note on this doc (2026-05-22):** the previous version of this file described a DOM-scraping strategy with `text=/Library ID:/` selectors. That approach is dead — Meta no longer renders "Library ID:" as visible card text. Extraction is now via **JSON-intercept of Meta's GraphQL responses**. The selectors section below describes the new approach.

## What we scrape (Meta Ad Library)

The public Meta Ad Library at `facebook.com/ads/library/`. Canonical per-brand URL:

```
https://www.facebook.com/ads/library/?active_status={STATUS}&ad_type=all&country={COUNTRY}&search_type=page&view_all_page_id={PAGE_ID}
```

`active_status` defaults to `all` (both live + paused, each with its real `is_active` flag — the authoritative mode). It's configurable via `--active-status=active|inactive` (engine option `activeStatus`, threaded through `buildAdLibraryUrl`), which the scrape modes use to pull live vs. paused slices — see "Scrape mode" below.

We extract per ad (mapped from Meta's JSON `snapshot` object):

- **`ad_archive_id`** → our `library_id` (the only stable identifier across scrapes)
- **`start_date`** / **`end_date`** (Unix timestamp seconds) → `days_active` (true run length: live ads count to now, paused ads to `end_date` — see `lib/scraper/days-active.ts`) AND, since 2026-06-20, stored verbatim as ISO timestamps in the `start_date` / `end_date` columns (for display / timelines; `days_active` stays the run-length signal the longevity tiers read)
- **`snapshot.body.text`** → `caption`; **`snapshot.title`** → `title` (the headline, stored separately and fed to the analyzer)
- **`snapshot.link_description`** → `link_description` (the ad's description line, real copy); **`snapshot.caption`** (the display domain shown on the ad, e.g. `brand.com`) → `display_link` — NOTE this is NOT our `caption` column, which holds `body.text`
- **`snapshot.cta_type`** (canonical English enum like `SIGN_UP`, `LEARN_MORE`) → `cta_label` (prettified)
- **`snapshot.link_url`** → landing URL
- **`snapshot.images[].original_image_url`** / **`snapshot.videos[].video_preview_image_url`** → `media_urls` (still-image / video-thumbnail URLs, stored as a reference only — **not downloaded**; image download was removed 2026-06-22)
- **`snapshot.videos[].video_hd_url` ?? `video_sd_url`** (+ video cards) → `video_urls` (the ACTUAL video file URL; **added 2026-06-20**). Meta signs these and they EXPIRE within days — stored as a reference only, NOT downloaded. Previously only the thumbnail was kept, so video ads were effectively analyzed as a still frame.
- **`snapshot.extra_texts` / `extra_images` / `extra_videos`** → `extra_texts` / `extra_image_urls` / `extra_video_urls` (DCO variant copy + creatives)
- **`snapshot.display_format`** (`IMAGE` | `VIDEO` | `CAROUSEL` | `DCO`) → stored verbatim in `display_format`, AND drives `media_type` (see "display_format vs media_type" below)
- **`collation_count`** ("N ads use this creative and text") → `collation_count`; **`collation_id`** → `collation_id` (see "Collation" below)
- **`contains_digital_created_media`** → `contains_ai_media` (Meta's AI-generated-creative flag); **`contains_sensitive_content`**, **`is_reshared`**, **`branded_content`**, **`page_is_deleted`** → stored flags
- **`is_active`** → `is_active` flag
- **`categories`** (top-level: `["UNKNOWN"]` for commercial) → `ad_categories`
- **`page_id` / `snapshot.page_name`** → used for brand-matching when scraping keyword-search URLs
- **Advertiser context (added 2026-06-20):** `snapshot.page_like_count` → `page_like_count`, `snapshot.page_categories` → `page_categories`, `snapshot.page_profile_uri` → `page_profile_uri`, `snapshot.page_profile_picture_url` → `page_profile_picture_url`

We do NOT scrape: spend, impressions, demographics, reach. **Meta does not expose these for commercial ads.** Don't try. (Verified in raw responses: `reach_estimate`, `spend`, `targeted_or_reached_countries`, `country_iso_code` are all `null`/`[]` for commercial ads — Meta only populates them for political/EU-regulated ads.)

**Geographic data — essentially nothing reliable:** because the Ad Library is country-scoped, the *only* per-ad geo signal Meta exposes is **which country's library the ad appears in** — and even that is noisy (a global/Advantage+ ad surfaces under multiple libraries and reads paused in any single one). There is no reliable per-ad targeting, reach, or spend-by-region data. A single-country scrape records the one market it queried into `ads.countries` (the column still exists), but we no longer build any cross-market footprint feature on top of it — the signal was too thin to be worth the multi-pass scraping cost. The `ALL` (global) scrape records no country at all (see "Country selection" below).

## Why Playwright (not fetch + cheerio)

The Ad Library is a client-rendered React app with GraphQL-driven data fetching. Without JS execution there's nothing meaningful to parse. Playwright with Chromium is the only reliable option, and it also lets us intercept the GraphQL responses (see below).

## Why JSON-intercept (not DOM scraping)

We tried DOM scraping first. Three reasons it failed:

1. **Class names are hashed and change frequently** (e.g. `x1iyjqo2 x6ikm8r`). Cannot select by class.
2. **The "Library ID:" visible label is gone** — Meta no longer renders that text on the card surface. It's only exposed in the page's JSON state.
3. **Visible card text is sparse** — modern cards mostly show the creative thumbnail and brand name; everything else is data-only.

But Meta sends every ad's structured data as JSON. The page's initial HTML inlines a JSON blob (~first 12 ads), and subsequent scroll-loads come back as GraphQL responses. We intercept both.

## Extraction pattern that works (as of 2026-05-22)

This **will** break too. When it does, update this section.

```ts
// 1. Listen for GraphQL responses; parse each body for ad_archive_id objects.
page.on("response", async (response) => {
  const ct = response.headers()["content-type"] ?? "";
  if (!/application\/(x-)?(ndjson|json)|text\/javascript/i.test(ct)) return;
  if (!/facebook\.com\/(api\/graphql|ads\/library)/.test(response.url())) return;
  const body = await response.text();
  if (!body.includes("ad_archive_id")) return;
  for (const root of parsePossiblyNdjson(body)) {
    for (const rec of findAdRecords(root)) {
      collected.set(rec.ad_archive_id, rec);
    }
  }
});

// 2. After navigation + networkidle, also walk the initial server-rendered HTML
//    for embedded JSON. Use a regex to find each ad_archive_id occurrence, then
//    a balanced-brace walk to slice out the enclosing JSON object.

// 3. Scroll-and-wait loop to trigger more lazy-loaded batches.
//    Stop when growth stalls for NO_GROWTH_STREAK_LIMIT polls or the count hits --max-ads.
// 4. Post-scrape capture check: compare captured count to Meta's reported "~N results".
```

The full implementation is in `scripts/scrape.ts`. Key helpers:

- `findAdRecords(value)` — recursive walker that yields every object with both `ad_archive_id` and a `snapshot` field, regardless of where Meta nests it. Resilient to Meta moving fields around the response tree.
- `parsePossiblyNdjson(body)` — Meta's GraphQL sometimes returns a single JSON object, sometimes NDJSON. Handles both.
- `normalizeAd(rec)` — maps the raw Meta record into our `NormalizedAd` shape (see field list above).
- `scrollUntilStable(page, …)` — the lazy-load driver. Real mouse-wheel events (not `window.scrollBy`); stops on `NO_GROWTH_STREAK_LIMIT` (12) consecutive no-growth polls or `MAX_SCROLLS` (320). Returns `{ reason: "maxAds" | "stall", finalCount }`. **Tuned up 2026-06-22** after the no-growth limit (then 6) truncated Monday.com to 39 of ~770 ads — a big library loads in bursts with lulls longer than 6 polls.
- `readReportedTotal(page)` — best-effort read of Meta's own "~N results" count (localized text for major markets). Feeds the **post-scrape capture check**: if we captured < `CAPTURE_MIN_RATIO` (0.8) of the reported total *after a stall*, the run emits a `warning` event and is recorded as **`partial`** (with the reason in `scrape_runs.error_message`) instead of `success` — so a truncated library never again ships as a clean success. A null read just skips the check.

## Gotchas that bit us building this

Document any new ones as they bite. Future-you will thank present-you.

- **`search_type=page` is ignored** by the public Ad Library — Meta still runs keyword search. The proper per-brand URL uses `view_all_page_id=<ID>`. Resolve the page ID with `lib/scraper/resolve-meta-page.ts`.
- **Keyword search matches body text, not page name**. `?q=Monday.com&search_type=keyword_unordered` returns ads from any brand whose copy mentions "Monday" (Burn Boot Camp, Coldplay, Alibaba…). When scraping a keyword URL, filter by `page_name` match against the competitor name. The filter is `pageNameMatches` in `lib/scraper/page-name-matches.ts` (pure + unit-tested): it compares **brand-significant token sets** (lowercased, punctuation→spaces, with corporate-suffix noise tokens like `com`/`inc`/`official` dropped), NOT raw substrings. This is why "Monday" matches "Monday.com" but "Asana" does NOT match the unrelated page "Asana Rebel". It deliberately errs toward false negatives — a missed brand is recoverable via the manual "Set Meta page" button, but a wrong-brand ad silently poisons the analysis.
- **`snapshot.body.text` can be a Dynamic Creative template** like `{{product.brand}}`. Treat strings matching `/^\{\{.+\}\}$/` as no-caption and fall through to title → carousel card body → carousel card title.
- **`snapshot.cta_text` is localized to the viewer's language** even when scraping with `country=US` (we've seen Kannada CTAs on US-targeted Asana scrapes). Use `snapshot.cta_type` (canonical English enum) and prettify it ourselves.
- **A login modal appears randomly**. Dismiss via `div[role="dialog"] [aria-label="Close"]`. Non-fatal if it doesn't appear.

### display_format vs media_type — they answer different questions

Meta's `display_format` (`IMAGE`/`VIDEO`/`CAROUSEL`/**`DCO`**) is the ad's **structure**; our `media_type` (`image`/`video`/`carousel`) is the **media kind** for rendering/analysis. They are NOT the same axis, and conflating them caused a real bug.

- **`DCO` = "This ad has multiple versions"** — one ad whose `cards[]` are A/B-tested *creative variations* (not carousel slides). DCO is increasingly Meta's default (Advantage+ creative); Asana was 30/30 DCO in practice.
- **`CAROUSEL`** = a genuine swipeable carousel; `cards[]` are slides.

The trap: a DCO ad and a carousel ad both fill `cards[]`, so counting cards can't tell them apart — but **`display_format` can**. We now store `display_format` verbatim AND reserve `media_type: "carousel"` only for ads Meta marks `CAROUSEL`; a DCO ad takes its underlying image/video kind (`normalizeAd` in `scrape-competitor.ts`). Before this fix the classifier labeled every multi-card DCO ad a "carousel" (Asana showed 100% carousel — the tell). Re-scraping propagates the corrected `media_type` (the deterministic analysis recomputes on read, so the fix shows up immediately).

### Collation — "N ads use this creative and text"

`collation_count` is the number of *separate* ad instances (distinct `ad_archive_id`s) Meta groups under one identical creative — a cross-ad **scaling** signal, distinct from DCO (which is within-ad variation). Two caveats baked into how we use it:
- **Market-scoped.** A single-country scrape sees only that market's count; `country=ALL` returns the global total (ClickUp: US maxed at 8, `ALL` reached 28). Often `null` when Meta doesn't populate it.
- **Cross-competitor-confounded.** It reflects campaign-build style (manual ad-set duplication vs. Advantage+ consolidation), not ad quality — ClickUp ran high counts, Asana/Monday near 1. Use it as within-competitor context + display only. (The `collation_id`, not the count, is the sole basis for the distinct-creatives de-confound in `lib/analysis`; see `docs/analysis.md`.)

When extraction fails entirely:

1. Save a screenshot to `data/scrape-errors/{competitor-id}-{timestamp}-fail/page.png`
2. Save the captured HTML to the same dir
3. Write a `scrape_runs` row with `status='failed'` and `error_message`
4. Exit non-zero so callers see the failure

## Polite scraping rules

- One concurrent page per scrape run. Never run multiple in parallel.
- Real user agent (recent Chrome on macOS).
- 2-5 second random delay between scrolls.
- Cap at `SCRAPE_MAX_ADS_PER_RUN` per competitor per run (default 50).
- Respect Meta's rate limits — if you hit a 429 or CAPTCHA, stop the run and surface the error. Don't retry aggressively.

## Image and video handling

**We no longer download creative files (removed 2026-06-22).** Every page that displayed ad creatives (the Swipe File, the competitor-detail ad cards) was removed, and the deterministic `lib/analysis` reads only the `media_type` LABEL (`image` / `video` / `carousel`), never an actual image or vision call. So the scraper stores only lightweight metadata:

- **`media_urls`** — the still-image / thumbnail URL strings, kept as a cheap reference (Meta signs and rotates them; treat as ephemeral).
- **`media_type`** — the classified media kind, which IS read by analysis (creative mix). Classified in `normalizeAd` — see "Media type" below.
- `download_media`, the `data/ad-creatives/` directory, and the `/api/creatives/{filename}` serving route **no longer exist**. `ads.media_paths` is a legacy column, always `[]`.

If a future feature renders or vision-analyzes creatives, reintroduce a download step then — but it's pure waste until something consumes the files.

## Upsert logic

`scripts/scrape.ts` is idempotent. For each scraped ad:

- If `ads.id` exists: refresh all Meta-derived fields (`is_active`, `days_active`, caption, media, `countries`, …). A single-country scrape unions its one market into `ads.countries`; an `ALL` scrape records no country.
- If new: insert full row.

**Snapshot model — we do NOT infer "paused" from absence.** Because we scrape `active_status=all`, Meta reports each ad's real `is_active` directly, so an ad that wasn't in a later scrape's results is **left as-is** (last-known status + dates frozen) — it is never flipped to inactive on absence. "Live" is derived at read time as "present in the most recent `scrape_run`". (`ads_went_inactive` is retained but always `0`.) This is non-destructive and self-healing: a reappearing ad just refreshes, and a shallow `--max-ads` scrape can't wrongly inactivate anything. See `docs/meta-ads-mechanics.md` §5.

**Always write a `scrape_runs` row** — one per invocation, including failures. Columns: `competitor_id`, `started_at`, `completed_at`, `status` (success | partial | failed), `country`, `ads_found`, `ads_new`, `ads_unchanged`, `ads_went_inactive`, `error_message` (nullable). This row is the source of truth for the dashboard's "Last scrape: 2h ago — 3 new, 25 unchanged, 2 went inactive" line and for failed-scrape recovery. Don't skip the write on errors — a failed scrape with no row is invisible to the UI.

> **Removed 2026-06-22 — no `clean:ads` pruning.** There used to be a `pnpm clean:ads` that
> deleted paused, never-analyzed ads. It was removed along with the `ad_analyses` table:
> the analysis layer now *uses* inactive ads (the Inactive segment, longevity, run-length),
> so deleting paused ads would harm the analysis, not tidy it. The snapshot model keeps
> inactive ads on purpose; there is nothing to prune.

## Country selection (one job: the primary scrape)

The Ad Library is country-scoped — an ad targeting India only won't appear in the US library. Scraping is **one job** with two market modes:

| Mode | UI | Engine call | Records into `ads.countries`? |
|---|---|---|---|
| **All countries** (PRIMARY/default) | "Scrape ads" → All countries | `country: "ALL"` | **no** |
| **Specific country** | "Scrape ads" → Specific country | `country: "US"` | yes — that 1 market |

Both modes own volume + `is_active`. The picker's country list (`COUNTRY_OPTIONS`, ~18 codes) lives in `lib/markets.ts` (a pure, browser-safe module so the dialog can import it without dragging Playwright into the bundle); `ALL_COUNTRIES` is the sentinel for the global view.

> **Why `ALL` is the authoritative live/paused view.** Meta reports the SAME ad's `is_active` differently depending on which library you query. A **global / Advantage+** ad (one Meta auto-distributes rather than a country-targeted buy — e.g. Monday.com) reads **paused in a single country's library** even while it's **active in the global `ALL` view**. So "is this ad live?" is most trustworthy from the `ALL` scrape; a single-country scrape is only authoritative for genuinely country-targeted brands. This is why `ALL` is the default.

**All countries (the default).** `buildAdLibraryUrl` special-cases `ALL` into Meta's global view. Widest volume in one fast pass AND the most authoritative live/paused status. Records NO geographic breakdown — Meta hides which country each ad runs in under `ALL`.

> **Why `ALL` writes no country:** the scraper records "which market did I see this ad in?" into `countries[]`. Naively, `ALL` mode would write `countries: ["ALL"]` onto every ad — poison, because `ALL` isn't a real country and would make a brand read as *"advertises in 1 market: ALL."* So in `ALL` mode the scraper **records no country** (`if (market === ALL_COUNTRIES) continue;`). Because re-scrapes **union**, an `ALL` run never erases a real market a prior single-country scrape found.

**Specific country.** One country library — for investigating a single market. Records that one country into each ad's `countries[]`. Resolution priority: per-scrape override (`--country=US` / API `country` / dialog dropdown) → `competitor.country` / `self` country → `SCRAPE_COUNTRY` env → `US`. Meta uses **`GB`**, not `UK`, for the United Kingdom.

> **There is no per-country "footprint" view.** Meta exposes essentially no reliable per-ad geography (see "Geographic data" above), and a multi-country sweep introduces a per-country/`ALL` live-paused conflict (a global advertiser reading 100% paused), so geography is limited to the two modes above — `ALL` (no country recorded) and one specific country.

For the bundled demo, all 5 PM brands are scraped from `US` since SaaS ad volume is highest there.

## Scrape mode (which ads to pull)

Separate from the country axis, the "Scrape ads" dialog offers three **modes** — *which slice* of the library to pull. They map to Meta's `active_status` filter, orchestrated by `scrapeCompetitorByMode` in `scrape-competitor.ts`:

| Mode | Dialog label | Passes | Meaning |
|---|---|---|---|
| `active` | All active ads | 1 (`active`, uncapped) | Every LIVE ad. Fastest. Ignores paused. |
| `active_plus_sample` | All active + sample of paused (default) | 2 (`inactive` ≤200, then `active` uncapped) | All live ads + a bounded paused SAMPLE. Balanced. |
| `active_plus_all` | All active + all paused | 1 (`all`, uncapped) | Every ad, live + paused. Most complete, slowest. |

**Why active/all are uncapped:** a single capped scrape (`--max-ads=N`) takes whatever N ads Meta returns first, which can **bias a brand's live/paused split** — e.g. a 300-cap on Monday.com's global library returned 300 paused ads and 0 live, because its live ads sat past the cutoff (it genuinely has ~39 live). Pulling the whole live (and, in `active_plus_all`, paused) set removes that bias. Only the paused *sample* in `active_plus_sample` is deliberately bounded (default 200, `--paused-sample=N`).

The upsert is keyed by `library_id`, so the passes merge into one library. `country` stays whatever you picked (`ALL` is the authoritative live/paused view); `active_status` is just a server-side filter on which ads Meta returns — live ads still come back with `is_active=true`, paused with `false`.

> **The active pass runs LAST — automatically.** `lib/analysis/metrics.ts` `isLive` treats an ad as live only if `is_active` AND `lastSeenAt >= latestScrapeAt` (the snapshot-model freshness check — "present in the most recent `scrape_run`"). Each pass writes its own `scrape_run`. If the **inactive** pass ran last it would become `latestScrapeAt`, and the live ads (only seen in the earlier active pass) would read `lastSeenAt < latestScrapeAt` → **every live ad silently counts as not-live (the Active segment goes empty)**. `scrapeCompetitorByMode` always orders the active pass last (paused sample first), so you never hit this on the UI/`--mode` path. You can still trip it on the manual power-user path (`--active-status=inactive` then `--active-status=active` by hand) — do the active one last. Re-running just the active pass repairs an already-broken DB. (2026-06-21 bug.)

**The capture check still validates the uncapped passes.** After each pass, `readReportedTotal` compares what we captured to Meta's own "~N results" count; under 80% (`CAPTURE_MIN_RATIO`) after a *stall* flags the run `partial`. The deliberately-capped paused sample is exempt because it stops on `maxAds`, not a stall — so a 200-cap on a 5,000-paused-ad brand is never mistaken for an incomplete scrape, while the uncapped active pass is always checked in full.

### Power-user single-pass path

Without `--mode`, the CLI runs ONE `scrapeCompetitor` pass driven by `--active-status=all|active|inactive` + `--max-ads=N` (default 50). This is the low-level primitive the modes are built on; use it for ad-hoc investigation. The mode flags above are the supported, ordering-safe way to do a two-pass scrape.

## Failure modes the UI must communicate

- "Playwright not installed" → friendly modal with `npx playwright install chromium` command
- "Selectors broke" → "Meta seems to have changed their DOM. The scrape failed on `<selector>`. Submit an issue with the screenshot."
- "Rate limited / CAPTCHA" → "Meta is throttling. Try again in 10 minutes or use a VPN."
- "Empty results" → "No active ads found. Either the brand isn't running ads in `{COUNTRY}` right now, or the page ID is wrong."

## Things NOT to do

- Don't use third-party Meta Ad Library scraper packages (most are abandoned and break with each Meta update).
- Don't try to access Meta's internal GraphQL endpoint. It works but is even more fragile and explicitly against ToS in a way that browsing the public UI isn't.
- Don't run the scraper from the deployed Vercel demo. Playwright doesn't run there, and even if it did, the demo's IP would get banned quickly. Demo mode = read cached data only.

---

## Website scraper (`scripts/scrape-website.ts`)

Runs only during onboarding (and when the user clicks `Re-scrape website` later). Produces raw text input for the company profile generator. Much simpler than the Meta scraper.

**What it fetches**:

- Homepage (always)
- `/pricing`, `/about`, `/product` — try each, include if reachable. Don't crawl arbitrarily; this is a targeted fetch of a tiny known set.
- If the homepage links to an obvious "about" page under a different path, follow that one too. Cap total pages at 5.

**Why these pages**: positioning lives in the hero copy, ICP shows up in pricing tiers, differentiators land on product/about pages. Homepage alone produces thin profiles.

**Mechanics**:

- `fetch` + `cheerio` is enough — most marketing sites are server-rendered or have decent SSR fallbacks. Reach for Playwright only if a target site is a hard SPA with no meaningful HTML.
- Extract main text content; strip nav, footer, cookie banners, script/style tags.
- Cap extracted text at ~10k characters per page (more than enough for the profile generator).
- Timeout per page: 15 seconds. Marketing sites with hero animations or slow CDN edges often need this — `/pricing` and `/about` sometimes render after the homepage main thread settles. Fail soft — if `/pricing` 404s or times out, skip it; if the homepage fails, surface a clear error to the onboarding UI.

**Failure modes**:

- *Homepage unreachable*: bubble up to onboarding UI. Offer the fallback textarea ("Tell us about your company in a few sentences.").
- *All pages return JS-only shells*: same fallback.
- *Site blocks scraping (Cloudflare challenge etc.)*: same fallback. Don't try to evade — this is a one-time profile generation, not worth the complexity.

**Where output goes**: raw extracted text is passed in-memory to the company profile generator (the `generate-company-profile` task in `docs/ai-pipeline.md`). Nothing is written to SQLite directly from this scraper.

---

## Meta page lookup by company name

Lives in `lib/scraper/resolve-meta-page.ts`. Used by `scripts/backfill-meta-pages.ts` today; will be used by the suggester and a "Find Meta page" UI button later.

**How it works**:

The Meta Ad Library does NOT expose a clean "find page by name" endpoint on the public site (`search_type=page` is ignored — confirmed empirically 2026-05-22). But every ad returned from a keyword search carries its own `page_id` + `snapshot.page_name`, so a keyword search becomes a poor-man's page directory.

```ts
// What the resolver does:
// 1. Navigate to ?q=<brand>&search_type=keyword_unordered (use URLSearchParams; do not template by hand)
// 2. Intercept GraphQL responses + walk initial HTML for ad_archive_id blocks
// 3. From each ad record, extract { page_id, page_name, page_is_verified, page_profile_picture_url }
// 4. Score candidates by name similarity (Dice coefficient on lowercased alphanumeric tokens)
//    + small boost for verified badge + non-zero ad count
// 5. Return best match if score >= 0.4, else null
```

**Always `URLSearchParams`** (or `encodeURIComponent`) the company name before templating it into the URL. Names with `&`, `+`, `#`, spaces, or non-ASCII characters (Café, Müller, 株式会社) silently break the search otherwise.

**Match selection**:

- Best match returned only if score ≥ 0.4 (empirical threshold).
- Resolver also returns the full `candidates` list (score-descending) so a future picker UI can let the user disambiguate between close matches.

**Known limitation**:

- A brand only surfaces if it's actively running ads whose body text mentions the brand name. **Brands that advertise the product without saying their own name (e.g. Monday.com) will return zero candidates and the resolver returns null.** In that case the user must paste the canonical `view_all_page_id=<ID>` URL manually. Surface this in the UI honestly — don't pretend the resolver found nothing for some other reason.

**Important**: when the resolver returns null, do NOT clobber an existing `meta_page_url`. The backfill explicitly skips rows on null match.

**Failure modes**:

- *Meta returns CAPTCHA*: bubble up; user can paste their page URL manually instead.
- *Resolver picks the wrong page*: top candidate has a similar name but isn't the right brand. Mitigation: the `candidates` list should be exposed in a picker UI before persisting. Today the backfill auto-picks on score ≥ 0.4 — fine for one-shot CLI use, but a UI flow should always confirm.

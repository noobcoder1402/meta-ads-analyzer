# UI & UX conventions

Cross-cutting rules for how the UI **looks** and **reads**. Read this before adding or
editing any user-facing component, copy, or table. Page-by-page specs live in
`docs/dashboard.md`; this file is the presentational + voice layer that applies everywhere.

This is a **living checklist** — when we hit a UI gotcha and fix it, add a one-line rule here
so it never recurs. Newest rules can go at the bottom of the relevant section.

---

## Text must wrap — never force horizontal scroll

**No table or block should run off the side of the screen because text won't wrap.** Long
content (a sentence-long hint, a landing-page path, a repeated phrase, an external figure
like "~245k total · 1,603 at >$100k ARR") must wrap onto multiple lines, not stretch its
column until the whole table needs sideways scrolling.

- **Watch out for the shadcn table primitive.** `components/ui/table.tsx` hardcodes
  `whitespace-nowrap` on every `TableHead`/`TableCell`. That's fine for short numbers but
  silently stretches any cell holding a long string. **Override per-cell** with
  `whitespace-normal break-words` (and `align-top` so wrapped rows line up) — do NOT remove
  `nowrap` from the shared primitive, other tables rely on it. See
  `app/insights/_components/comparison-table.tsx` + `company-scale-table.tsx` for the pattern.
- **Constrain the wide column.** A column of long prose (e.g. the metric/hint column) should
  carry `min-w-[160px] max-w-[300px] whitespace-normal` so it wraps to a sensible width
  instead of consuming the row.
- **Break long unbroken tokens** (URLs, IDs, domains) with `break-words` so they wrap mid-token
  rather than overflowing.
- **Verify, don't eyeball:** the page itself must have **zero horizontal overflow**
  (`document.documentElement.scrollWidth === clientWidth`) at desktop width (~1280px). Wide
  tables may still scroll *within their own container* on a genuinely narrow viewport — that's
  acceptable; a table that overflows at 1280px is not.

## Writing user-facing copy

**Every word a user reads must be written for an external, non-technical marketer — NOT for us,
the builders.** This is a hard rule, applies to all UI copy (page text, table titles, hints,
captions, button labels, empty/error states) AND the AI strategic-insights output (the prompt
carries the same rule).

- **Plain English, short sentences.** If you'd have to explain a sentence out loud, rewrite it.
- **No internal jargon.** Banned from user-facing copy: Meta field names (`collation_id`,
  `ad_archive_id`, `landing_url`, `active_status`), math/eng terms (`deterministic`,
  `de-confound`, `n-gram`, `document-frequency`, `DCO` without a gloss, `segment`, `pivot`),
  and insider phrasing ("the fairest volume read", "build style", "ad-sets" → say "campaigns").
- **Explain any unavoidable term inline, in a few plain words.** e.g. "dynamic creative — one ad
  that rotates several versions", "unique active ads — each ad counted once even when reused".
- **Never verbose.** Cut every word that isn't pulling weight. A caption is one or two
  sentences, not a paragraph.
- **Say what it means, not how it's computed.** "How long each brand's running ads have been
  live" beats "median days_active over the live-segment partition".
- When you add or edit UI copy, re-read it as if you'd never seen the codebase. If a term only
  makes sense because you wrote the code, it fails.

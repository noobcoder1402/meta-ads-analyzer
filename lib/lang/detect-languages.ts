/**
 * Creative-language detection — a DETERMINISTIC, free signal for the synthesizer.
 *
 * WHY this exists: detecting which languages a competitor writes their ad copy in
 * tells us how deeply they LOCALIZE creative (translate hooks per market) vs blast
 * one English ad everywhere. It is a "localization depth" read — NOT a country
 * claim. A Spanish ad could target Spain, Mexico, OR a US-Hispanic audience, so we
 * never infer a country from language. (The Map-markets footprint owns "where".)
 *
 * WHY caption/title only, NEVER the CTA: Meta renders `cta_text` in the *viewer's*
 * language (we've scraped Kannada CTAs on US-targeted ads), so the CTA is worthless
 * as a language signal. Only the caption/title is author-written and trustworthy.
 *
 * Detection uses `tinyld` (purpose-built for SHORT text). It needs a reasonable
 * amount of text, so we skip strings under MIN_CHARS and Dynamic-Creative template
 * placeholders like `{{product.brand}}` — those count as "undetected", never guessed.
 *
 * WHY tinyld, not franc-min (changed 2026-06-03): franc-min cannot separate short
 * Spanish from short Portuguese — sister languages that score within ~0.1 of each
 * other on ad-length copy — so its margin gate rejected nearly EVERY genuine
 * Spanish/Portuguese caption as a "near-tie" → undetected. On a 28-caption real-data
 * bake-off franc scored 3/7 on Spanish+Portuguese (and mislabeled "Empieza tu prueba
 * gratis hoy" as Bosnian); tinyld scored 7/7. This had erased Monday.com's entire
 * LATAM expansion from the synthesis. See changelog 2026-06-03.
 *
 * ENGLISH PRIOR (retained, re-tuned for tinyld): tinyld over-picks exotic languages
 * (Romanian, Estonian) on terse, brand/list-heavy English fragments ("Tasks, docs,
 * whiteboards…"), with English the close runner-up. These advertisers are
 * English-primary, so when English trails the winner by less than ENGLISH_PRIOR_MARGIN
 * (and is in the top 3) we trust English. This recovers the short-English
 * false-positives WITHOUT touching the now-correct Iberian calls (where English is not
 * a near contender). Still errs toward not inventing a language.
 *
 * tinyld emits ISO 639-1 (2-letter); we map to ISO 639-3 (ISO1_TO_3) so the rest of
 * this module's contract — and every consumer — is unchanged.
 *
 * This module is pure (tinyld calls only, no I/O) → unit-tested.
 */
import { detectAll } from "tinyld";

/** ISO 639-3 → human label + flag, for the languages a B2B SaaS advertiser is
 * realistically going to run. Unknown-but-detected codes fall back to the raw code. */
const LANGUAGE_LABELS: Record<string, { label: string; flag: string }> = {
  eng: { label: "English", flag: "🇬🇧" },
  spa: { label: "Spanish", flag: "🇪🇸" },
  deu: { label: "German", flag: "🇩🇪" },
  fra: { label: "French", flag: "🇫🇷" },
  por: { label: "Portuguese", flag: "🇵🇹" },
  ita: { label: "Italian", flag: "🇮🇹" },
  nld: { label: "Dutch", flag: "🇳🇱" },
  jpn: { label: "Japanese", flag: "🇯🇵" },
  kor: { label: "Korean", flag: "🇰🇷" },
  cmn: { label: "Chinese", flag: "🇨🇳" },
  rus: { label: "Russian", flag: "🇷🇺" },
  arb: { label: "Arabic", flag: "🇸🇦" },
  hin: { label: "Hindi", flag: "🇮🇳" },
  tur: { label: "Turkish", flag: "🇹🇷" },
  pol: { label: "Polish", flag: "🇵🇱" },
  swe: { label: "Swedish", flag: "🇸🇪" },
  dan: { label: "Danish", flag: "🇩🇰" },
  nob: { label: "Norwegian", flag: "🇳🇴" },
  fin: { label: "Finnish", flag: "🇫🇮" },
  ind: { label: "Indonesian", flag: "🇮🇩" },
  vie: { label: "Vietnamese", flag: "🇻🇳" },
  tha: { label: "Thai", flag: "🇹🇭" },
  ces: { label: "Czech", flag: "🇨🇿" },
  ell: { label: "Greek", flag: "🇬🇷" },
  heb: { label: "Hebrew", flag: "🇮🇱" },
  ukr: { label: "Ukrainian", flag: "🇺🇦" },
  ron: { label: "Romanian", flag: "🇷🇴" },
  hun: { label: "Hungarian", flag: "🇭🇺" },
};

/** Below this many characters, language detection is unreliable noise — skip it. */
export const MIN_CHARS = 12;

/** tinyld emits low absolute accuracy scores on short copy. When a non-English
 * winner beats English by LESS than this (and English is a top-3 contender), we trust
 * English — the domain prior for these English-primary advertisers. Tuned on the
 * real short-English false-positives (winner−English margins of ~0.011 and ~0.018). */
export const ENGLISH_PRIOR_MARGIN = 0.02;

/** tinyld returns ISO 639-1 (2-letter); this module's public contract is ISO 639-3
 * (matches LANGUAGE_LABELS + every stored synthesis). Map the realistic SaaS-advertiser
 * languages; any unmapped code passes through (labelFor falls back to raw code + 🏳️). */
const ISO1_TO_3: Record<string, string> = {
  en: "eng", es: "spa", de: "deu", fr: "fra", pt: "por", it: "ita", nl: "nld",
  ja: "jpn", ko: "kor", zh: "cmn", ru: "rus", ar: "arb", hi: "hin", tr: "tur",
  pl: "pol", sv: "swe", da: "dan", nb: "nob", no: "nob", fi: "fin", id: "ind",
  vi: "vie", th: "tha", cs: "ces", el: "ell", he: "heb", uk: "ukr", ro: "ron",
  hu: "hun",
};

function to3(code: string): string {
  return ISO1_TO_3[code] ?? code;
}

/** A language counts as "minor/incidental" if it appears in only 1 ad OR under this
 * share of detected ads. Surfaced but visually flagged (the "report all, flag minor"
 * choice). Kept as exported constants so the threshold is documented in one place. */
export const MINOR_MIN_COUNT = 2;
export const MINOR_MIN_SHARE = 0.05;

export type LanguageEntry = {
  /** ISO 639-3 code (e.g. "eng"). */
  code: string;
  label: string;
  flag: string;
  /** Number of ads detected in this language. */
  count: number;
  /** Share of DETECTED ads (0-1), not all ads. */
  share: number;
  /** True if incidental (1 ad, or under MINOR_MIN_SHARE) — UI greys these out. */
  minor: boolean;
};

export type CreativeLanguages = {
  /** Distinct languages detected (includes minor ones). */
  languageCount: number;
  /** How many texts we could confidently detect a language for. */
  detectedFrom: number;
  /** How many texts were too short / placeholders / undetermined. */
  undetected: number;
  /** Languages, most-used first. */
  languages: LanguageEntry[];
};

/**
 * Normalize ad copy before detection: strip Dynamic-Creative template tokens
 * (`{{product.brand}}`), then apply Unicode NFKC.
 *
 * WHY NFKC (2026-06-03): advertisers use lookalike glyphs that wreck detection —
 * Monday writes "monday․com" with U+2024 ONE DOT LEADER (not a period), which made
 * tinyld return Armenian at 100% confidence for 55 plainly-English ads; ClickUp uses
 * 𝗺𝗮𝘁𝗵𝗲𝗺𝗮𝘁𝗶𝗰𝗮𝗹-𝗯𝗼𝗹𝗱 letters. NFKC folds both back to ASCII (U+2024→".", 𝗯𝗼𝗹𝗱→bold),
 * so the detector sees real words. NFKC preserves genuine accents (é, ü, ã).
 */
function stripTemplates(text: string): string {
  return text.replace(/\{\{.*?\}\}/g, " ").normalize("NFKC").trim();
}

/**
 * Detect the language of one piece of ad copy. Returns an ISO 639-3 code, or
 * `null` when the text is too short, a placeholder, or undetermined. Never guesses.
 */
export function detectLanguage(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = stripTemplates(text);
  if (cleaned.length < MIN_CHARS) return null;

  const ranked = detectAll(cleaned);
  if (ranked.length === 0) return null;

  const top = ranked[0];
  if (!top?.lang) return null;

  // Domain prior: short brand/list-heavy English copy makes tinyld over-pick exotic
  // languages (Romanian/Estonian) with English a close runner-up. If English trails
  // the winner by less than ENGLISH_PRIOR_MARGIN and sits in the top 3, trust English.
  // This does NOT touch genuine non-English calls — there English is not near the top.
  if (top.lang !== "en") {
    const englishRank = ranked.slice(0, 3).find((r) => r.lang === "en");
    if (englishRank && top.accuracy - englishRank.accuracy < ENGLISH_PRIOR_MARGIN) {
      return to3("en");
    }
  }
  return to3(top.lang);
}

function labelFor(code: string): { label: string; flag: string } {
  return LANGUAGE_LABELS[code] ?? { label: code, flag: "🏳️" };
}

/**
 * Aggregate language detection over a competitor's ad copy. Pass the best
 * author-written text per ad (caption preferred, title as fallback) — NEVER the CTA.
 */
export function aggregateLanguages(texts: Array<string | null | undefined>): CreativeLanguages {
  const counts: Record<string, number> = {};
  let detectedFrom = 0;
  let undetected = 0;

  for (const text of texts) {
    const code = detectLanguage(text);
    if (!code) {
      undetected++;
      continue;
    }
    detectedFrom++;
    counts[code] = (counts[code] ?? 0) + 1;
  }

  const languages: LanguageEntry[] = Object.entries(counts)
    .map(([code, count]) => {
      const share = detectedFrom > 0 ? count / detectedFrom : 0;
      const { label, flag } = labelFor(code);
      return {
        code,
        label,
        flag,
        count,
        share,
        minor: count < MINOR_MIN_COUNT || share < MINOR_MIN_SHARE,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    languageCount: languages.length,
    detectedFrom,
    undetected,
    languages,
  };
}

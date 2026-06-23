/**
 * Copy mining — extract the phrases a competitor repeats across their ad copy,
 * for the "phrase bubble" (bigger bubble = used in more ads). DETERMINISTIC, no AI.
 *
 * WHY document-frequency, not raw term-frequency: we count the number of ADS a phrase
 * appears in (its "document frequency"), not how many times it occurs overall. One ad
 * that repeats "work management" five times shouldn't outweigh five different ads that
 * each say it once — the second is the real signal that it's a core message. So each
 * phrase counts at most once per ad.
 *
 * WHY 3–5 word phrases (no single or two-word phrases): short fragments ("work", "AI",
 * "project management") are too generic to show positioning; 3–5 word phrases ("all your
 * work in one place", "the everything app for work") are where the repeated hooks and
 * taglines live. Phrases are dropped if they start or end on a stopword (so "of your" /
 * "the best way" don't pollute the results).
 *
 * EXCEPTION — the single term "AI": it's deliberately too short to be a phrase, but it's
 * a meaningful positioning signal on its own, so `countAdsMentioningAi` surfaces it
 * separately (document-frequency: how many ADS mention it, counted once per ad).
 *
 * Pure module (string math only) → unit-tested.
 */

/** Common English function words + ad-boilerplate that carry no positioning signal.
 * Kept deliberately small: we WANT brand names and product nouns to survive. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "so", "as", "of", "to",
  "in", "on", "at", "by", "for", "with", "from", "into", "over", "under", "about",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done",
  "have", "has", "had", "having", "will", "would", "can", "could", "should", "shall",
  "may", "might", "must", "this", "that", "these", "those", "it", "its", "you", "your",
  "yours", "we", "our", "ours", "us", "they", "them", "their", "theirs", "i", "me",
  "my", "mine", "he", "she", "his", "her", "hers", "him", "who", "whom", "which", "what",
  "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "too", "very",
  "just", "now", "get", "got", "make", "made", "let", "via", "per", "up", "out", "off",
  "down", "here", "there", "also", "yet", "etc", "vs", "amp",
  // domain/url noise that survives tokenizing "monday.com" → ["monday","com"]
  "com", "www", "http", "https",
]);

/** Below this many characters a word is noise (e.g. one-char tokens; "ai" is allowed at 2). */
const MIN_WORD_LEN = 2;

export type Phrase = { phrase: string; count: number };

/** Normalize one blob of ad copy: NFKC (fold lookalike glyphs), lowercase, strip
 * Dynamic-Creative `{{tokens}}`, reduce everything non-alphanumeric to a single space. */
function tokenize(text: string): string[] {
  const cleaned = text
    .replace(/\{\{.*?\}\}/g, " ")
    .normalize("NFKC")
    .toLowerCase()
    // keep letters/numbers across unicode (accents survive), everything else → space
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/);
}

function isStop(word: string): boolean {
  return STOPWORDS.has(word);
}

/** Build the set of distinct phrases (3–5 word) present in one ad's combined copy. */
function phrasesInAd(words: string[]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    // 3-, 4-, 5-word phrases: drop if the phrase starts or ends on a stopword, or
    // contains a bare number / one-char token. (No 1–2 word fragments — too generic.)
    for (let n = 3; n <= 5; n++) {
      if (i + n > words.length) break;
      const gram = words.slice(i, i + n);
      if (isStop(gram[0]) || isStop(gram[n - 1])) continue;
      if (gram.some((w) => /^\d+$/.test(w) || w.length < MIN_WORD_LEN)) continue;
      found.add(gram.join(" "));
    }
  }
  return found;
}

/**
 * Top repeated phrases across a set of ad-copy blobs (one blob per ad — caller joins
 * caption/title/link-description/extra-texts). Returns phrases used in >= `minAds`
 * ads, most-used first, capped at `top`. Count = number of ads containing the phrase.
 */
/** Document-frequency map: how many ad-copy blobs each phrase appears in (≤ once per ad). */
function docFrequencies(adTexts: Array<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of adTexts) {
    if (!text) continue;
    const words = tokenize(text);
    if (words.length === 0) continue;
    for (const phrase of phrasesInAd(words)) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return counts;
}

export function topPhrases(
  adTexts: Array<string | null | undefined>,
  opts: { top?: number; minAds?: number } = {},
): Phrase[] {
  const top = opts.top ?? 30;
  const minAds = opts.minAds ?? 2;

  const counts = docFrequencies(adTexts);

  return [...counts.entries()]
    .filter(([, count]) => count >= minAds)
    .map(([phrase, count]) => ({ phrase, count }))
    // most-used first; tie-break longer (more specific) phrase first, then alphabetical
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.phrase.length - a.phrase.length ||
        a.phrase.localeCompare(b.phrase),
    )
    .slice(0, top);
}

/**
 * The "AI" mention exception. Matches the standalone term AI / A.I. / artificial
 * intelligence (case-insensitive) anywhere in an ad's copy — run on the RAW text (not
 * the tokenized words) so punctuated forms like "A.I." survive. Word-boundaried so it
 * never fires inside unrelated words ("email", "Thailand", "fair").
 */
const AI_MENTION = /\bAIs?\b|\bA\.I\.?|\bartificial intelligence\b/i;

/** How many ad-copy blobs mention AI — counted at most once per ad (document frequency). */
export function countAdsMentioningAi(
  adTexts: Array<string | null | undefined>,
): number {
  let count = 0;
  for (const text of adTexts) {
    if (text && AI_MENTION.test(text)) count++;
  }
  return count;
}


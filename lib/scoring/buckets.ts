// Bucket predicates — the single source of truth for how scored ads are grouped.
// See docs/scoring.md "Bucket predicates (canonical definitions)". The synthesizer
// prompt builder, the competitor detail page, and the swipe file all import from
// here; none of them redefine the predicates. Any change must update the doc table.
//
// Pure module: no I/O, no async.

/** Every ad lands in exactly one bucket (priority Winner > New > Maturing > Flopped > Retired > Other). */
export type Bucket = "winner" | "new" | "maturing" | "flopped" | "retired" | "other";

/** Tags can stack on top of a bucket; an ad may have zero or more. */
export type BucketTag = "always-on" | "paused";

/** The minimal ad shape bucketing needs. A full `Ad` row satisfies this. */
export type BucketableAd = {
  daysActive: number;
  isActive: boolean;
  lastSeenAt: string;
};

/** UI display labels for each bucket. */
export const BUCKET_LABEL: Record<Bucket, string> = {
  winner: "Winner",
  new: "Active experiment",
  maturing: "Maturing",
  flopped: "Flopped",
  retired: "Retired",
  other: "Other",
};

export const TAG_LABEL: Record<BucketTag, string> = {
  "always-on": "Always-on",
  paused: "Paused",
};

/** Winner: a high score the advertiser has clearly committed budget to over time. */
export function isWinner(ad: BucketableAd, score: number): boolean {
  return score >= 70 && ad.daysActive >= 30;
}

/** Active experiment: live but too young to know if it works yet. */
export function isActiveExperiment(ad: BucketableAd): boolean {
  return ad.isActive && ad.daysActive < 14;
}

/** Maturing: live, past the experiment window but not yet old enough to be a Winner. */
export function isMaturing(ad: BucketableAd): boolean {
  return ad.isActive && ad.daysActive >= 14 && ad.daysActive < 30;
}

/**
 * Flopped: paused after a short run (< 14 days). A short life before the advertiser
 * pulled it is the clearest "this didn't earn its budget" signal we can infer.
 *
 * This is run length only — a long-running ad that was later switched off is NOT a
 * flop (it ran); those are Retired (see below). Every paused ad is therefore either
 * Flopped (< 14 days) or Retired (>= 14 days), unless it scored high enough to be a
 * Winner (Winners keep priority and carry a `paused` tag instead).
 */
export function isFlopped(ad: BucketableAd): boolean {
  return !ad.isActive && ad.daysActive < 14;
}

/**
 * Retired: paused after a real run (>= 14 days). The advertiser ran it for weeks
 * then cycled it out — typically a proven creative refreshed, not a failure. The
 * complement of Flopped among paused ads, and distinct from a paused Winner (which
 * scored >= 70 over >= 30 days and stays a Winner). High-value swipe material: it
 * clearly earned its keep before being rotated.
 */
export function isRetired(ad: BucketableAd): boolean {
  return !ad.isActive && ad.daysActive >= 14;
}

/**
 * Assign exactly one bucket. Priority is Winner > New > Maturing > Flopped > Retired
 * > Other, so a long-running high-scorer that just went paused stays a Winner (with a
 * `paused` tag) rather than dropping into Retired. Other is now a true residue
 * (effectively: active, >= 30 days, but score < 70 — a long-running mid-performer).
 */
export function bucketOf(ad: BucketableAd, score: number): Bucket {
  if (isWinner(ad, score)) return "winner";
  if (isActiveExperiment(ad)) return "new";
  if (isMaturing(ad)) return "maturing";
  if (isFlopped(ad)) return "flopped";
  if (isRetired(ad)) return "retired";
  return "other";
}

/** Tags layered on top of the bucket. See docs/scoring.md predicate table. */
export function tagsFor(
  ad: BucketableAd,
  score: number,
  bucket: Bucket,
): BucketTag[] {
  const tags: BucketTag[] = [];
  // Always-on is a sub-category of Winner: a high-scorer running 60+ days that is
  // STILL LIVE. The `isActive` requirement is deliberate — "always-on" reads as
  // present-tense "still running constantly", so it must be mutually exclusive with
  // the `paused` tag below. A proven 60+ day winner that's been switched off is a
  // Winner + Paused (cycled out), NOT an always-on ad.
  if (bucket === "winner" && ad.isActive && score >= 70 && ad.daysActive >= 60)
    tags.push("always-on");
  // A Winner that's no longer live was a proven ad cycled out for refresh.
  if (bucket === "winner" && !ad.isActive) tags.push("paused");
  return tags;
}

/** Convenience: bucket + tags in one call. */
export function classify(
  ad: BucketableAd,
  score: number,
): { bucket: Bucket; tags: BucketTag[] } {
  const bucket = bucketOf(ad, score);
  return { bucket, tags: tagsFor(ad, score, bucket) };
}

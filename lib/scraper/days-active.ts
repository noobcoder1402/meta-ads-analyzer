// How long an ad actually ran, in whole days — the input to the longevity
// signal (60% of the performance score), so correctness here matters most.
//
// Pure + dependency-free so it can be unit-tested without the scraper's
// Playwright/DB imports. All timestamps are Meta's UNIX *seconds*.
//
// A LIVE ad is still running → count to now. A PAUSED ad stopped on Meta's
// `end_date`; counting to now would inflate a long-dead ad's longevity forever
// (a 30-day ad paused a year ago would read ~395 days and max out longevity).

export function computeDaysActive(opts: {
  startDate?: number | null;
  endDate?: number | null;
  isActive: boolean;
  now?: number; // ms epoch; injectable for tests
}): number {
  const { startDate, endDate, isActive } = opts;
  if (typeof startDate !== "number" || startDate <= 0) return 0;

  const nowMs = opts.now ?? Date.now();
  const startMs = startDate * 1000;
  const endMs =
    isActive || typeof endDate !== "number" || endDate <= 0
      ? nowMs
      : endDate * 1000;

  return Math.max(0, Math.floor((endMs - startMs) / 86_400_000));
}

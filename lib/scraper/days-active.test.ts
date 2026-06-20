import { describe, it, expect } from "vitest";
import { computeDaysActive } from "./days-active";

const DAY = 86_400_000;
const sec = (ms: number) => Math.floor(ms / 1000);
const now = Date.UTC(2026, 4, 31); // 2026-05-31

describe("computeDaysActive", () => {
  it("counts a live ad from start to now (ignores end_date)", () => {
    const start = sec(now - 40 * DAY);
    const staleEnd = sec(now - 35 * DAY); // Meta's end_date lags; live ad ignores it
    expect(
      computeDaysActive({ startDate: start, endDate: staleEnd, isActive: true, now })
    ).toBe(40);
  });

  it("counts a paused ad from start to end_date, NOT to now (the bug fix)", () => {
    const start = sec(now - 200 * DAY);
    const end = sec(now - 170 * DAY); // ran 30 days, paused 170 days ago
    expect(
      computeDaysActive({ startDate: start, endDate: end, isActive: false, now })
    ).toBe(30); // not 200
  });

  it("falls back to now for a paused ad missing end_date", () => {
    const start = sec(now - 12 * DAY);
    expect(
      computeDaysActive({ startDate: start, endDate: null, isActive: false, now })
    ).toBe(12);
  });

  it("clamps to 0 when end_date precedes start_date (data glitch)", () => {
    const start = sec(now - 10 * DAY);
    const end = sec(now - 20 * DAY);
    expect(
      computeDaysActive({ startDate: start, endDate: end, isActive: false, now })
    ).toBe(0);
  });

  it("returns 0 when start_date is missing or invalid", () => {
    expect(computeDaysActive({ startDate: null, isActive: true, now })).toBe(0);
    expect(computeDaysActive({ startDate: 0, isActive: true, now })).toBe(0);
  });
});

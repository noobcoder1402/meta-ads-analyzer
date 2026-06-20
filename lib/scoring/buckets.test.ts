import { describe, it, expect } from "vitest";
import {
  isWinner,
  isActiveExperiment,
  isMaturing,
  isFlopped,
  isLikelyCampaign,
  bucketOf,
  tagsFor,
  classify,
  type BucketableAd,
} from "./buckets";

const now = () => new Date().toISOString();
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

const base: BucketableAd = {
  daysActive: 0,
  isActive: true,
  lastSeenAt: now(),
};

describe("isWinner", () => {
  it("requires both score >= 70 and days_active >= 30", () => {
    expect(isWinner({ ...base, daysActive: 30 }, 70)).toBe(true);
    expect(isWinner({ ...base, daysActive: 29 }, 70)).toBe(false); // too young
    expect(isWinner({ ...base, daysActive: 90 }, 69)).toBe(false); // score too low
  });
});

describe("isActiveExperiment", () => {
  it("is live and under 14 days", () => {
    expect(isActiveExperiment({ ...base, isActive: true, daysActive: 13 })).toBe(true);
    expect(isActiveExperiment({ ...base, isActive: true, daysActive: 14 })).toBe(false);
    expect(isActiveExperiment({ ...base, isActive: false, daysActive: 5 })).toBe(false);
  });
});

describe("isMaturing", () => {
  it("is live and 14–29 days (past experiment, not yet winner-eligible)", () => {
    expect(isMaturing({ ...base, isActive: true, daysActive: 14 })).toBe(true);
    expect(isMaturing({ ...base, isActive: true, daysActive: 29 })).toBe(true);
    expect(isMaturing({ ...base, isActive: true, daysActive: 13 })).toBe(false); // still an experiment
    expect(isMaturing({ ...base, isActive: true, daysActive: 30 })).toBe(false); // winner-eligible window
    expect(isMaturing({ ...base, isActive: false, daysActive: 20 })).toBe(false); // paused is never maturing
  });
});

describe("isFlopped", () => {
  it("is paused AND ran a short time (< 14 days)", () => {
    // paused + short run → flopped
    expect(isFlopped({ ...base, isActive: false, daysActive: 5 })).toBe(true);
    // paused but ran long → NOT flopped (it ran; not a flop), regardless of how long ago it was seen
    expect(isFlopped({ ...base, isActive: false, daysActive: 50, lastSeenAt: daysAgo(40) })).toBe(false);
    expect(isFlopped({ ...base, isActive: false, daysActive: 50, lastSeenAt: now() })).toBe(false);
    // active is never flopped
    expect(isFlopped({ ...base, isActive: true, daysActive: 5 })).toBe(false);
  });
});

describe("isLikelyCampaign", () => {
  it("is true when the creative signals a deal/urgency push", () => {
    expect(isLikelyCampaign({ angle: "offer-led", themes: [] })).toBe(true);
    expect(isLikelyCampaign({ angle: "product-demo", angleSecondary: "fomo-scarcity" })).toBe(true);
    expect(isLikelyCampaign({ angle: "social-proof", themes: ["black friday", "savings"] })).toBe(true);
    expect(isLikelyCampaign({ angle: "product-demo", themes: ["50% off everything"] })).toBe(true);
  });

  it("is false for evergreen creative or missing analysis", () => {
    expect(isLikelyCampaign({ angle: "product-demo", themes: ["consolidation", "ROI"] })).toBe(false);
    expect(isLikelyCampaign(null)).toBe(false);
    expect(isLikelyCampaign({})).toBe(false);
  });
});

describe("bucketOf — exclusive membership, priority Winner > New > Maturing > Flopped > Other", () => {
  it("a 90-day live high-scorer is a winner", () => {
    expect(bucketOf({ ...base, daysActive: 90, isActive: true }, 85)).toBe("winner");
  });

  it("a paused long-running high-scorer stays a winner (not flopped/other)", () => {
    const ad = { ...base, daysActive: 90, isActive: false, lastSeenAt: daysAgo(40) };
    expect(isFlopped(ad)).toBe(false); // it ran long — not a flop
    expect(bucketOf(ad, 80)).toBe("winner"); // and the high score keeps it a Winner
  });

  it("a fresh live ad is new", () => {
    expect(bucketOf({ ...base, daysActive: 3, isActive: true }, 20)).toBe("new");
  });

  it("a live ad in the 14–29 day window is maturing", () => {
    expect(bucketOf({ ...base, daysActive: 20, isActive: true }, 50)).toBe("maturing");
  });

  it("a paused young ad is flopped", () => {
    expect(bucketOf({ ...base, daysActive: 4, isActive: false }, 10)).toBe("flopped");
  });

  it("a paused ad that ran a while (>=14d) then went quiet is retired, not flopped", () => {
    expect(bucketOf({ ...base, daysActive: 50, isActive: false, lastSeenAt: daysAgo(40) }, 50)).toBe("retired");
    expect(bucketOf({ ...base, daysActive: 40, isActive: false, lastSeenAt: now() }, 50)).toBe("retired");
  });
});

describe("tagsFor", () => {
  it("tags always-on for 60+ day winners", () => {
    const ad = { ...base, daysActive: 70, isActive: true };
    expect(tagsFor(ad, 80, "winner")).toContain("always-on");
    // 30-59 day winner is not always-on
    expect(tagsFor({ ...base, daysActive: 45, isActive: true }, 75, "winner")).not.toContain("always-on");
  });

  it("tags paused for a winner that went inactive", () => {
    const ad = { ...base, daysActive: 90, isActive: false, lastSeenAt: now() };
    expect(tagsFor(ad, 80, "winner")).toContain("paused");
  });

  it("never tags a paused winner as always-on (mutually exclusive)", () => {
    // A proven 60+ day winner that's been switched off is Winner + Paused, NOT
    // always-on — "always-on" implies still running. Regression guard for the
    // confusing "Always-on + Paused" combo.
    const ad = { ...base, daysActive: 325, isActive: false, lastSeenAt: now() };
    const tags = tagsFor(ad, 90, "winner");
    expect(tags).toContain("paused");
    expect(tags).not.toContain("always-on");
  });

  it("tags a flopped ad as a likely campaign only when its creative reads promotional", () => {
    const ad = { ...base, daysActive: 5, isActive: false };
    expect(tagsFor(ad, 20, "flopped", { angle: "offer-led" })).toContain("campaign");
    // no analysis → no campaign tag (un-analyzed flop reads as a plain flop)
    expect(tagsFor(ad, 20, "flopped")).not.toContain("campaign");
    // analyzed but evergreen → not a campaign
    expect(tagsFor(ad, 20, "flopped", { angle: "product-demo", themes: ["onboarding"] })).not.toContain("campaign");
    // the campaign tag never applies outside the flopped bucket
    expect(tagsFor({ ...base, daysActive: 70, isActive: true }, 80, "winner", { angle: "offer-led" })).not.toContain("campaign");
  });
});

describe("classify", () => {
  it("returns bucket + tags together", () => {
    const ad = { ...base, daysActive: 70, isActive: true };
    const { bucket, tags } = classify(ad, 75);
    expect(bucket).toBe("winner");
    expect(tags).toEqual(expect.arrayContaining(["always-on"]));
  });

  it("threads analysis through to the campaign tag on a flopped ad", () => {
    const ad = { ...base, daysActive: 6, isActive: false };
    const { bucket, tags } = classify(ad, 15, { angle: "fomo-scarcity" });
    expect(bucket).toBe("flopped");
    expect(tags).toContain("campaign");
  });
});

import { describe, expect, it } from "vitest";
import {
  correctionPhrase,
  formatConfidence,
  formatCount,
  formatMegabytePair,
  formatMs,
  formatPercent,
  formatPerSecond,
  formatSize,
} from "./format";

describe("formatCount", () => {
  it("groups thousands with commas", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(3005)).toBe("3,005");
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("rounds fractional values to whole numbers", () => {
    expect(formatCount(1283.6)).toBe("1,284");
    expect(formatCount(12.4)).toBe("12");
  });

  it("shows a dash for values that are not finite", () => {
    expect(formatCount(Number.NaN)).toBe("—");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("shows a ratio as a percentage with one decimal", () => {
    expect(formatPercent(0.924)).toBe("92.4%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(0.81818)).toBe("81.8%");
    expect(formatPercent(0.99961)).toBe("100.0%");
  });

  it("shows a dash when the ratio is unknown", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("formatPerSecond", () => {
  it("shows one decimal", () => {
    expect(formatPerSecond(16.24)).toBe("16.2");
    expect(formatPerSecond(4)).toBe("4.0");
    expect(formatPerSecond(0.05)).toBe("0.1");
    expect(formatPerSecond(1234.56)).toBe("1,234.6");
  });

  it("shows a dash when the rate is unknown", () => {
    expect(formatPerSecond(null)).toBe("—");
    expect(formatPerSecond(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatMs", () => {
  it("shows whole milliseconds", () => {
    expect(formatMs(238.4)).toBe("238");
    expect(formatMs(0)).toBe("0");
    expect(formatMs(1520.6)).toBe("1,521");
  });

  it("shows a dash when the duration is unknown", () => {
    expect(formatMs(null)).toBe("—");
  });
});

describe("formatConfidence", () => {
  it("shows whole percent without overstating certainty", () => {
    expect(formatConfidence(0.98)).toBe("98%");
    expect(formatConfidence(0.9996)).toBe("99%");
    expect(formatConfidence(1)).toBe("100%");
    expect(formatConfidence(0.254)).toBe("25%");
    expect(formatConfidence(0.29)).toBe("29%");
    expect(formatConfidence(0.57)).toBe("57%");
    expect(formatConfidence(0)).toBe("0%");
  });

  it("clamps values outside 0..1", () => {
    expect(formatConfidence(1.2)).toBe("100%");
    expect(formatConfidence(-0.1)).toBe("0%");
  });
});

describe("formatSize", () => {
  it("keeps one decimal below 100 MB", () => {
    expect(formatSize(11_908_441)).toBe("11.9MB");
    expect(formatSize(4_200_000)).toBe("4.2MB");
  });

  it("drops the decimal from 100 MB up", () => {
    expect(formatSize(551_055_739)).toBe("551MB");
    expect(formatSize(199_309_562)).toBe("199MB");
    expect(formatSize(100_000_000)).toBe("100MB");
  });

  it("groups gigabyte-sized models in megabytes", () => {
    expect(formatSize(1_234_567_890)).toBe("1,235MB");
  });
});

describe("formatMegabytePair", () => {
  it("uses one decimal for small downloads", () => {
    expect(formatMegabytePair(4_200_000, 11_908_441)).toBe("4.2 / 11.9 MB");
  });

  it("uses whole megabytes when the total is large", () => {
    expect(formatMegabytePair(231_400_000, 551_055_739)).toBe("231 / 551 MB");
    expect(formatMegabytePair(0, 551_055_739)).toBe("0 / 551 MB");
  });

  it("never shows more loaded than the total", () => {
    expect(formatMegabytePair(560_000_000, 551_055_739)).toBe("551 / 551 MB");
  });
});

describe("correctionPhrase", () => {
  it("describes each clockwise quarter correction in Japanese", () => {
    expect(correctionPhrase(0)).toBe("回転なし");
    expect(correctionPhrase(1)).toBe("時計回りに 90°");
    expect(correctionPhrase(2)).toBe("180°");
    expect(correctionPhrase(3)).toBe("反時計回りに 90°");
  });
});

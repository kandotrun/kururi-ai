import { describe, expect, it } from "vitest";
import { createProgressMeter } from "./progress";

function recorder() {
  const reports: Array<[number, number]> = [];
  return {
    reports,
    report: (loaded: number, total: number) => {
      reports.push([loaded, total]);
    },
  };
}

describe("createProgressMeter", () => {
  it("announces the combined total before any byte arrives", () => {
    const { reports, report } = recorder();
    const meter = createProgressMeter([100, 300], report, 0);
    expect(meter.total).toBe(400);
    expect(reports).toEqual([[0, 400]]);
  });

  it("sums the bytes of every file", () => {
    const { reports, report } = recorder();
    const meter = createProgressMeter([100, 300], report, 0);
    meter.add(1, 50);
    meter.add(0, 20);
    meter.add(1, 25);
    expect(meter.loaded).toBe(95);
    expect(reports.slice(1)).toEqual([
      [50, 400],
      [70, 400],
      [95, 400],
    ]);
  });

  it("never counts more than a file's declared size", () => {
    const { report } = recorder();
    const meter = createProgressMeter([100, 300], report, 0);
    meter.add(0, 150);
    expect(meter.loaded).toBe(100);
  });

  it("throttles reports to the step but always reports completion", () => {
    const { reports, report } = recorder();
    const meter = createProgressMeter([100, 100], report, 50);
    meter.add(0, 10);
    meter.add(0, 30);
    meter.add(0, 20);
    meter.add(1, 10);
    meter.add(1, 5);
    meter.finish(0);
    meter.finish(1);
    expect(reports).toEqual([
      [0, 200],
      [60, 200],
      [115, 200],
      [200, 200],
    ]);
  });

  it("rewinds a file that has to be fetched again", () => {
    const { reports, report } = recorder();
    const meter = createProgressMeter([100, 300], report, 0);
    meter.finish(0);
    meter.reset(0);
    expect(meter.loaded).toBe(0);
    expect(reports.at(-1)).toEqual([0, 400]);
  });

  it("ignores indexes it does not know", () => {
    const { report } = recorder();
    const meter = createProgressMeter([100], report, 0);
    meter.add(3, 10);
    meter.finish(-1);
    expect(meter.loaded).toBe(0);
  });
});

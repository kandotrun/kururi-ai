import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { ViewInsets } from "../contracts";
import {
  type DeskBounds,
  frontCells,
  mosaicBounds,
  spiralCell,
} from "../core/layout";
import { CameraDirector, type DirectorFrame } from "./camera-director";

const STEP = 1 / 60;
const NO_INSETS: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function finishedFrame(
  now: number,
  placed: number,
  lastPlacedAt: number,
  settled: boolean,
): DirectorFrame {
  return {
    now,
    dt: STEP,
    front: frontCells(placed, 3),
    band: { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    visitors: { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    action: { count: 0, x: 0, z: 0, slot: 0 },
    visitorAction: { count: 0, x: 0, z: 0, slot: 0 },
    placeRate: 0,
    falling: 0,
    prints: placed,
    placed,
    lastPlacedAt,
    bounds: mosaicBounds(placed),
    focusX: 0,
    focusZ: 0,
    hasFocus: false,
    holdWide: false,
    viewWidth: 1440,
    viewHeight: 900,
    insets: NO_INSETS,
    settled,
  };
}

function streamingFrame(now: number, placed: number): DirectorFrame {
  const frame = finishedFrame(now, placed, now, false);
  const front = frontCells(placed, 3);
  frame.band = { count: 4, ...front };
  frame.action = { count: 4, x: front.minX, z: front.minZ, slot: placed };
  frame.placeRate = 6;
  return frame;
}

function run(
  director: CameraDirector,
  from: number,
  to: number,
  frame: (now: number) => DirectorFrame,
): void {
  for (let now = from; now < to; now += STEP) {
    director.update(frame(now));
  }
}

function inView(camera: PerspectiveCamera, bounds: DeskBounds): boolean {
  camera.updateMatrixWorld();
  const corners = [
    new Vector3(bounds.minX, 0, bounds.minZ),
    new Vector3(bounds.maxX, 0, bounds.minZ),
    new Vector3(bounds.minX, 0, bounds.maxZ),
    new Vector3(bounds.maxX, 0, bounds.maxZ),
  ];
  return corners.every((corner) => {
    const point = corner.project(camera);
    return Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
  });
}

function streamedDirector(placed: number, until: number): CameraDirector {
  const director = new CameraDirector(new PerspectiveCamera(), false);
  run(director, 0, until, (now) =>
    streamingFrame(now, Math.min(placed, Math.floor(now * 6))),
  );
  return director;
}

describe("CameraDirector when the stream has finished", () => {
  it("cuts to the whole mosaic right after the last print settles", () => {
    const lastPlacedAt = 10;
    const director = streamedDirector(60, lastPlacedAt);
    run(director, lastPlacedAt, lastPlacedAt + 0.6, (now) =>
      finishedFrame(now, 60, lastPlacedAt, true),
    );
    expect(director.mode).toBe("reveal");
  });

  it("shows every placed print within about a second and a half", () => {
    const lastPlacedAt = 10;
    const director = streamedDirector(60, lastPlacedAt);
    run(director, lastPlacedAt, lastPlacedAt + 1.9, (now) =>
      finishedFrame(now, 60, lastPlacedAt, true),
    );
    expect(inView(director.camera, mosaicBounds(60))).toBe(true);
  });

  it("holds the wide shot once it has revealed the finished desk", () => {
    const lastPlacedAt = 10;
    const director = streamedDirector(60, lastPlacedAt);
    run(director, lastPlacedAt, lastPlacedAt + 12, (now) =>
      finishedFrame(now, 60, lastPlacedAt, true),
    );
    expect(director.mode).toBe("reveal");
    expect(inView(director.camera, mosaicBounds(60))).toBe(true);
  });

  it("keeps following through a short stall while the stream is still running", () => {
    const lastPlacedAt = 10;
    const director = streamedDirector(60, lastPlacedAt);
    run(director, lastPlacedAt, lastPlacedAt + 3, (now) =>
      finishedFrame(now, 60, lastPlacedAt, false),
    );
    expect(director.mode).toBe("follow");
  });

  it("wakes a sleeping renderer for the finished cut", () => {
    const lastPlacedAt = 10;
    const director = streamedDirector(60, lastPlacedAt);
    director.update(finishedFrame(lastPlacedAt, 60, lastPlacedAt, true));
    const settled = director.secondsUntilNextCue(lastPlacedAt, 60, lastPlacedAt, true);
    const running = director.secondsUntilNextCue(lastPlacedAt, 60, lastPlacedAt, false);
    expect(settled).not.toBeNull();
    expect(settled ?? 99).toBeLessThan(0.6);
    expect(running ?? 0).toBeGreaterThan(5);
  });

  it("goes back to following when new prints arrive after the finish", () => {
    const lastPlacedAt = 10;
    const director = streamedDirector(60, lastPlacedAt);
    run(director, lastPlacedAt, lastPlacedAt + 2, (now) =>
      finishedFrame(now, 60, lastPlacedAt, true),
    );
    run(director, lastPlacedAt + 2, lastPlacedAt + 2.2, (now) =>
      streamingFrame(now, 61),
    );
    expect(director.mode).toBe("follow");
  });
});

interface Viewport {
  width: number;
  height: number;
  insets: ViewInsets;
}

function bandFrame(
  now: number,
  first: number,
  count: number,
  view: Viewport,
): DirectorFrame {
  const band = frontCells(first, count);
  const lead = spiralCell(first);
  const pad = 0.5;
  return {
    now,
    dt: STEP,
    front: frontCells(first + count - 1, 1),
    band: {
      count,
      minX: band.minX - pad,
      maxX: band.maxX + pad,
      minZ: band.minZ - pad,
      maxZ: band.maxZ + pad,
    },
    visitors: { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    action: { count, x: lead.x, z: lead.z, slot: first },
    visitorAction: { count: 0, x: 0, z: 0, slot: 0 },
    placeRate: first > 0 ? 3 : 0,
    falling: 0,
    prints: first + count,
    placed: first,
    lastPlacedAt: first > 0 ? now : Number.NEGATIVE_INFINITY,
    bounds: mosaicBounds(first + count),
    focusX: 0,
    focusZ: 0,
    hasFocus: false,
    holdWide: false,
    viewWidth: view.width,
    viewHeight: view.height,
    insets: view.insets,
    settled: false,
  };
}

function bandInFree(
  camera: PerspectiveCamera,
  frame: DirectorFrame,
  slack: number,
): boolean {
  camera.updateMatrixWorld();
  const band = frame.band;
  const { top, right, bottom, left } = frame.insets;
  return [
    [band.minX, band.minZ],
    [band.maxX, band.minZ],
    [band.minX, band.maxZ],
    [band.maxX, band.maxZ],
  ].every(([x, z]) => {
    const point = new Vector3(x, 0.02, z).project(camera);
    const px = ((point.x + 1) / 2) * frame.viewWidth;
    const py = ((1 - point.y) / 2) * frame.viewHeight;
    return (
      px >= left - slack &&
      px <= frame.viewWidth - right + slack &&
      py >= top - slack &&
      py <= frame.viewHeight - bottom + slack
    );
  });
}

const DESKTOP_UI: Viewport = {
  width: 1440,
  height: 900,
  insets: { top: 64, right: 0, bottom: 68, left: 477 },
};
const DESKTOP_INTRO: Viewport = { ...DESKTOP_UI, insets: NO_INSETS };
const PHONE_UI: Viewport = {
  width: 390,
  height: 844,
  insets: { top: 236, right: 0, bottom: 272, left: 0 },
};

describe("CameraDirector and the free rectangle", () => {
  it("clears the interface within about 0.9 s after the intro hands over", () => {
    const director = new CameraDirector(new PerspectiveCamera(), false);
    run(director, 0, 3, (now) => bandFrame(now, 0, 36, DESKTOP_INTRO));
    run(director, 3, 3.9, (now) => bandFrame(now, 0, 36, DESKTOP_UI));
    expect(bandInFree(director.camera, bandFrame(3.9, 0, 36, DESKTOP_UI), 4)).toBe(
      true,
    );
  });

  it("keeps the waiting crooked prints inside the free band on a phone", () => {
    const director = new CameraDirector(new PerspectiveCamera(), false);
    run(director, 0, 4, (now) => bandFrame(now, 60, 16, PHONE_UI));
    expect(bandInFree(director.camera, bandFrame(4, 60, 16, PHONE_UI), 2)).toBe(
      true,
    );
  });

  it("keeps the opening batch inside the free band on a phone", () => {
    const director = new CameraDirector(new PerspectiveCamera(), false);
    run(director, 0, 4, (now) => bandFrame(now, 0, 16, PHONE_UI));
    expect(bandInFree(director.camera, bandFrame(4, 0, 16, PHONE_UI), 2)).toBe(
      true,
    );
  });
});

import { describe, expect, it } from "vitest";
import type { Quarter } from "../contracts";
import {
  ARRIVAL_PITCH,
  CROOKED_LAYERS,
  CROOKED_OFFSET_JITTER,
  CROOKED_YAW_JITTER,
  PRINT_LONG_SIDE,
  DESK_YAW,
  type DeskBounds,
  MIN_FREE_FRACTION,
  ARRIVAL_DEPTH,
  ARRIVAL_WIDTH,
  arrivalFrame,
  arrivalView,
  borderWidth,
  cellSlot,
  crookedLayer,
  crookedPose,
  fitDistance,
  focusArea,
  followArea,
  frontCells,
  leadAnchor,
  spiralPoint,
  frameArea,
  matHalfSize,
  mosaicBounds,
  printSize,
  projectDeskPoint,
  screenExtent,
  slotPose,
  spiralCell,
  viewFov,
  viewFrame,
} from "./layout";
import { mulberry32 } from "./random";
import { quarterToYaw } from "./rotation";

const DEG = Math.PI / 180;

function bruteBounds(count: number) {
  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  for (let slot = 0; slot < Math.max(1, count); slot += 1) {
    const cell = spiralCell(slot);
    minX = Math.min(minX, cell.x);
    maxX = Math.max(maxX, cell.x);
    minZ = Math.min(minZ, cell.z);
    maxZ = Math.max(maxZ, cell.z);
  }
  return {
    minX: minX - 0.5,
    maxX: maxX + 0.5,
    minZ: minZ - 0.5,
    maxZ: maxZ + 0.5,
  };
}

describe("spiralCell", () => {
  it("starts at the origin and winds the first ring", () => {
    const cells = Array.from({ length: 10 }, (_, slot) => spiralCell(slot));
    expect(cells).toEqual([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: -1 },
      { x: 0, z: -1 },
      { x: -1, z: -1 },
      { x: -1, z: 0 },
      { x: -1, z: 1 },
      { x: 0, z: 1 },
      { x: 1, z: 1 },
      { x: 2, z: 1 },
    ]);
  });

  it("uses every cell of a square exactly once", () => {
    const side = 41;
    const seen = new Set<string>();
    for (let slot = 0; slot < side * side; slot += 1) {
      const cell = spiralCell(slot);
      expect(Math.abs(cell.x)).toBeLessThanOrEqual(20);
      expect(Math.abs(cell.z)).toBeLessThanOrEqual(20);
      seen.add(`${cell.x},${cell.z}`);
    }
    expect(seen.size).toBe(side * side);
  });

  it("moves to a neighbouring cell at every step", () => {
    for (let slot = 1; slot < 5000; slot += 1) {
      const previous = spiralCell(slot - 1);
      const current = spiralCell(slot);
      const step =
        Math.abs(current.x - previous.x) + Math.abs(current.z - previous.z);
      expect(step).toBe(1);
    }
  });

  it("stays exact for large slots", () => {
    const slot = 1_000_000;
    expect(cellSlot(spiralCell(slot).x, spiralCell(slot).z)).toBe(slot);
  });
});

describe("cellSlot", () => {
  it("inverts spiralCell", () => {
    for (let slot = 0; slot < 4000; slot += 1) {
      const cell = spiralCell(slot);
      expect(cellSlot(cell.x, cell.z)).toBe(slot);
    }
  });

  it("rounds world positions to the nearest cell", () => {
    expect(cellSlot(0.94, -0.2)).toBe(1);
    expect(cellSlot(-0.3, 0.45)).toBe(0);
  });
});

describe("slotPose", () => {
  it("sits flat and upright in the centre of the cell", () => {
    const pose = slotPose(2);
    expect(pose.x).toBe(1);
    expect(pose.z).toBe(-1);
    expect(pose.y).toBe(0);
    expect(pose.yaw).toBe(0);
    expect(pose.tiltX).toBe(0);
    expect(pose.tiltZ).toBe(0);
    expect(pose.scale).toBe(1);
  });
});

describe("mosaicBounds", () => {
  it("covers the centre cell when nothing is placed yet", () => {
    expect(mosaicBounds(0)).toEqual({
      minX: -0.5,
      maxX: 0.5,
      minZ: -0.5,
      maxZ: 0.5,
    });
  });

  it("matches the cells actually used", () => {
    for (let count = 0; count < 700; count += 1) {
      expect(mosaicBounds(count)).toEqual(bruteBounds(count));
    }
  });

  it("stays square-ish while growing", () => {
    for (let count = 1; count < 3500; count += 7) {
      const bounds = mosaicBounds(count);
      const width = bounds.maxX - bounds.minX;
      const depth = bounds.maxZ - bounds.minZ;
      expect(Math.abs(width - depth)).toBeLessThanOrEqual(1);
    }
  });
});

describe("printSize", () => {
  it("keeps the long side at 0.9 units", () => {
    expect(printSize(1.5)).toEqual({ width: 0.9, depth: 0.6 });
    expect(printSize(0.75).depth).toBeCloseTo(PRINT_LONG_SIDE);
    expect(printSize(0.75).width).toBeCloseTo(0.675);
    expect(printSize(1)).toEqual({ width: 0.9, depth: 0.9 });
  });

  it("clamps extreme or invalid aspects", () => {
    expect(printSize(10).depth).toBeCloseTo(0.225);
    expect(printSize(0).width).toBeCloseTo(0.225);
    expect(printSize(Number.NaN)).toEqual({ width: 0.9, depth: 0.9 });
  });
});

describe("borderWidth", () => {
  it("is five percent of the short side", () => {
    expect(borderWidth({ width: 0.9, depth: 0.6 })).toBeCloseTo(0.03);
    expect(borderWidth({ width: 0.6, depth: 0.9 })).toBeCloseTo(0.03);
  });
});

describe("crookedPose", () => {
  it("is deterministic for a seed", () => {
    expect(crookedPose(40, 1, mulberry32(5))).toEqual(
      crookedPose(40, 1, mulberry32(5)),
    );
  });

  it("lands inside its own cell with a small offset", () => {
    expect(CROOKED_OFFSET_JITTER).toBeCloseTo(0.1);
    const random = mulberry32(17);
    for (let slot = 0; slot < 800; slot += 1) {
      const simulated = (slot % 4) as Quarter;
      const pose = crookedPose(slot, simulated, random);
      const cell = spiralCell(slot);
      expect(Math.abs(pose.x - cell.x)).toBeLessThanOrEqual(
        CROOKED_OFFSET_JITTER,
      );
      expect(Math.abs(pose.z - cell.z)).toBeLessThanOrEqual(
        CROOKED_OFFSET_JITTER,
      );
      expect(cellSlot(pose.x, pose.z)).toBe(slot);
    }
  });

  it("keeps the simulated quarter with a small yaw jitter", () => {
    expect(CROOKED_YAW_JITTER).toBeCloseTo(0.12);
    const random = mulberry32(2);
    for (let index = 0; index < 400; index += 1) {
      const simulated = (index % 4) as Quarter;
      const pose = crookedPose(index, simulated, random);
      expect(Math.abs(pose.yaw - quarterToYaw(simulated))).toBeLessThanOrEqual(
        CROOKED_YAW_JITTER,
      );
      expect(pose.y).toBe(0);
      expect(pose.tiltX).toBe(0);
      expect(pose.tiltZ).toBe(0);
      expect(pose.scale).toBe(1);
    }
  });

  it("really scatters the prints a little", () => {
    const random = mulberry32(8);
    let offset = 0;
    let yaw = 0;
    for (let slot = 0; slot < 200; slot += 1) {
      const pose = crookedPose(slot, 2, random);
      const cell = spiralCell(slot);
      offset = Math.max(offset, Math.hypot(pose.x - cell.x, pose.z - cell.z));
      yaw = Math.max(yaw, Math.abs(pose.yaw - quarterToYaw(2)));
    }
    expect(offset).toBeGreaterThan(0.08);
    expect(yaw).toBeGreaterThan(0.1);
  });

  it("falls back to the centre cell for an invalid slot", () => {
    const pose = crookedPose(Number.NaN, 0, mulberry32(1));
    expect(Math.abs(pose.x)).toBeLessThanOrEqual(CROOKED_OFFSET_JITTER);
    expect(Math.abs(pose.z)).toBeLessThanOrEqual(CROOKED_OFFSET_JITTER);
  });
});

describe("crookedLayer", () => {
  it("gives every touching cell a different layer", () => {
    for (let slot = 0; slot < 2500; slot += 1) {
      const cell = spiralCell(slot);
      const layer = crookedLayer(slot);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          if (dx === 0 && dz === 0) {
            continue;
          }
          const neighbour = cellSlot(cell.x + dx, cell.z + dz);
          expect(crookedLayer(neighbour)).not.toBe(layer);
        }
      }
    }
  });

  it("stays inside the layer budget", () => {
    for (let slot = 0; slot < 3000; slot += 1) {
      const layer = crookedLayer(slot);
      expect(Number.isInteger(layer)).toBe(true);
      expect(layer).toBeGreaterThanOrEqual(0);
      expect(layer).toBeLessThan(CROOKED_LAYERS);
    }
    expect(crookedLayer(Number.NaN)).toBe(crookedLayer(0));
  });
});

describe("viewFov", () => {
  it("is 32 degrees on landscape screens and widens on portrait", () => {
    expect(viewFov(1.6)).toBeCloseTo(32 * DEG);
    expect(viewFov(1.2)).toBeCloseTo(32 * DEG);
    expect(viewFov(0.45)).toBeCloseTo(41 * DEG);
    expect(viewFov(0.8)).toBeGreaterThan(viewFov(1));
    expect(viewFov(0.8)).toBeLessThan(viewFov(0.5));
  });
});

describe("arrivalView", () => {
  function visibleAtTarget(aspect: number): { width: number; depth: number } {
    const view = arrivalView(aspect);
    const half = viewFov(aspect) / 2;
    const height = view.distance * Math.sin(view.pitch);
    const across = view.distance * Math.cos(view.pitch);
    const near = across - height / Math.tan(view.pitch + half);
    const far = height / Math.tan(view.pitch - half) - across;
    return {
      width: 2 * view.distance * Math.tan(half) * aspect,
      depth: near + far,
    };
  }

  it("looks down at the middle of the mat from about 54 degrees", () => {
    const view = arrivalView(1.6);
    expect(view.pitch).toBe(ARRIVAL_PITCH);
    expect(view.pitch).toBeGreaterThan(52 * DEG);
    expect(view.pitch).toBeLessThan(57 * DEG);
    expect(Math.abs(view.targetX)).toBeLessThan(0.5);
    expect(Math.abs(view.targetZ)).toBeLessThan(0.5);
    expect(Math.abs(view.yaw)).toBeLessThan(10 * DEG);
  });

  it("shows only about three by three units of the mat", () => {
    const desktop = visibleAtTarget(1440 / 900);
    expect(desktop.depth).toBeGreaterThan(2.8);
    expect(desktop.depth).toBeLessThan(4.4);
    expect(desktop.width).toBeGreaterThan(3);
    expect(desktop.width).toBeLessThan(5.6);
    const phone = visibleAtTarget(390 / 844);
    expect(phone.width).toBeGreaterThan(2.8);
    expect(phone.width).toBeLessThan(4);
  });
});

describe("fitDistance", () => {
  const pitch = (54 * Math.PI) / 180;
  const fov = (32 * Math.PI) / 180;

  it("grows with the area to frame", () => {
    const small = fitDistance(5, 5, pitch, fov, 1.6);
    const large = fitDistance(20, 20, pitch, fov, 1.6);
    expect(large).toBeGreaterThan(small * 3.5);
  });

  it("needs more distance on a narrow screen", () => {
    expect(fitDistance(10, 10, pitch, fov, 0.46)).toBeGreaterThan(
      fitDistance(10, 10, pitch, fov, 1.6),
    );
  });

  it("keeps the near edge inside the vertical field of view", () => {
    const depth = 12;
    const distance = fitDistance(1, depth, pitch, fov, 1.6, 1);
    const nearAngle = Math.atan(
      ((depth / 2) * Math.sin(pitch)) /
        (distance - (depth / 2) * Math.cos(pitch)),
    );
    expect(nearAngle).toBeLessThanOrEqual(fov / 2 + 1e-9);
  });
});

describe("matHalfSize", () => {
  it("leaves room around the whole mosaic", () => {
    const half = matHalfSize(3200);
    const bounds = mosaicBounds(3200);
    expect(half).toBeGreaterThan(bounds.maxX + 2.6);
    expect(half).toBeGreaterThan(-bounds.minZ + 2.6);
    expect(Number.isInteger(half)).toBe(true);
  });
});

describe("viewFrame", () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  it("is the whole canvas when nothing covers it", () => {
    const frame = viewFrame(1440, 900, none);
    expect(frame.shiftX).toBe(0);
    expect(frame.shiftY).toBe(0);
    expect(frame.width).toBe(1440);
    expect(frame.height).toBe(900);
    expect(frame.aspect).toBeCloseTo(1.6);
    expect(frame.fovY).toBeCloseTo(viewFov(1.6));
    expect(frame.cameraFovY).toBeCloseTo(viewFov(1.6));
  });

  it("moves the projection centre to the middle of the free rectangle", () => {
    const frame = viewFrame(1440, 900, {
      top: 64,
      right: 0,
      bottom: 66,
      left: 480,
    });
    expect(frame.width).toBe(960);
    expect(frame.height).toBe(770);
    expect(frame.shiftX).toBeCloseTo(240 / 1440);
    expect(frame.shiftY).toBeCloseTo(-1 / 900);
    expect(frame.aspect).toBeCloseTo(960 / 770);
    expect(Math.tan(frame.fovY / 2)).toBeCloseTo(
      Math.tan(viewFov(1.6) / 2) * (770 / 900),
    );
  });

  it("keeps the canvas lens so the arrival matches the intro", () => {
    const covered = viewFrame(390, 844, {
      top: 230,
      right: 0,
      bottom: 270,
      left: 0,
    });
    expect(covered.cameraFovY).toBeCloseTo(viewFov(390 / 844));
    expect(covered.fovY).toBeLessThan(covered.cameraFovY);
    expect(covered.shiftY).toBeCloseTo((230 - 270) / 2 / 844);
  });

  it("ignores invalid insets and never lets the interface cover almost everything", () => {
    const frame = viewFrame(390, 844, {
      top: 600,
      right: -5,
      bottom: 400,
      left: Number.NaN,
    });
    expect(frame.width).toBe(390);
    expect(frame.shiftX).toBe(0);
    expect(frame.height).toBeGreaterThanOrEqual(844 * MIN_FREE_FRACTION - 1e-9);
    expect(Math.abs(frame.shiftY)).toBeLessThan(0.5);
    expect(Number.isFinite(frame.fovY)).toBe(true);
  });

  it("stays finite for a canvas that has not been laid out yet", () => {
    const frame = viewFrame(0, 0, none);
    for (const value of Object.values(frame)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(frame.width).toBeGreaterThan(0);
  });
});

describe("projectDeskPoint", () => {
  const view = {
    targetX: 1,
    targetZ: -2,
    distance: 10,
    pitch: 54 * DEG,
    yaw: 0,
  };
  const fov = 32 * DEG;

  it("puts the target in the middle of the view", () => {
    const point = projectDeskPoint(view, 1, -2, fov, 1.6);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
    expect(point.depth).toBeCloseTo(10);
  });

  it("shows desk north at the top and +X on the right", () => {
    expect(projectDeskPoint(view, 1, -4, fov, 1.6).y).toBeGreaterThan(0);
    expect(projectDeskPoint(view, 3, -2, fov, 1.6).x).toBeGreaterThan(0);
  });

  it("turns with the camera yaw", () => {
    const turned = { ...view, yaw: 30 * DEG };
    const ahead = projectDeskPoint(
      turned,
      1 - Math.sin(turned.yaw) * 2,
      -2 - Math.cos(turned.yaw) * 2,
      fov,
      1.6,
    );
    expect(ahead.x).toBeCloseTo(0);
    expect(ahead.y).toBeGreaterThan(0);
  });
});

function corners(area: DeskBounds): [number, number][] {
  return [
    [area.minX, area.minZ],
    [area.maxX, area.minZ],
    [area.minX, area.maxZ],
    [area.maxX, area.maxZ],
  ];
}

function screenBox(
  view: ReturnType<typeof frameArea>,
  area: DeskBounds,
  fov: number,
  aspect: number,
) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, z] of corners(area)) {
    const point = projectDeskPoint(view, x, z, fov, aspect);
    expect(point.depth).toBeGreaterThan(0);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

describe("frameArea", () => {
  const pitch = 54 * DEG;
  const fov = 32 * DEG;
  const areas: DeskBounds[] = [
    { minX: -3, maxX: 3, minZ: -3, maxZ: 3 },
    { minX: 2, maxX: 12, minZ: -1, maxZ: 1 },
    { minX: -1, maxX: 1, minZ: -6, maxZ: 4 },
    { minX: -20.5, maxX: 19.5, minZ: -20.5, maxZ: 20.5 },
  ];
  const aspects = [1.6, 960 / 770, 390 / 351, 0.46];

  it("fits the area tightly and centred inside the view", () => {
    for (const aspect of aspects) {
      for (const area of areas) {
        const view = frameArea(area, pitch, DESK_YAW, fov, aspect, 1);
        const box = screenBox(view, area, fov, aspect);
        expect(box.minX).toBeGreaterThanOrEqual(-1.002);
        expect(box.maxX).toBeLessThanOrEqual(1.002);
        expect(box.minY).toBeGreaterThanOrEqual(-1.002);
        expect(box.maxY).toBeLessThanOrEqual(1.002);
        expect(
          Math.max(box.maxX - box.minX, box.maxY - box.minY),
        ).toBeGreaterThan(1.99);
        expect(Math.abs(box.minX + box.maxX)).toBeLessThan(0.004);
        expect(Math.abs(box.minY + box.maxY)).toBeLessThan(0.004);
      }
    }
  });

  it("leaves the requested padding around the area", () => {
    const area = areas[0] as DeskBounds;
    const view = frameArea(area, pitch, DESK_YAW, fov, 1.6, 1.25);
    const box = screenBox(view, area, fov, 1.6);
    expect(Math.max(box.maxY - box.minY, box.maxX - box.minX)).toBeCloseTo(
      2 / 1.25,
      2,
    );
  });

  it("keeps the requested angles", () => {
    const view = frameArea(areas[1] as DeskBounds, 58 * DEG, 0.1, fov, 1.6);
    expect(view.pitch).toBe(58 * DEG);
    expect(view.yaw).toBe(0.1);
  });

  it("moves further away for bigger areas and narrower views", () => {
    const small = frameArea(areas[0] as DeskBounds, pitch, 0, fov, 1.6);
    const large = frameArea(areas[3] as DeskBounds, pitch, 0, fov, 1.6);
    const narrow = frameArea(areas[1] as DeskBounds, pitch, 0, fov, 0.46);
    const wide = frameArea(areas[1] as DeskBounds, pitch, 0, fov, 1.6);
    expect(large.distance).toBeGreaterThan(small.distance * 4);
    expect(narrow.distance).toBeGreaterThan(wide.distance * 2);
  });

  it("copes with a single point or an inverted area", () => {
    const point = frameArea(
      { minX: 2, maxX: 2, minZ: 1, maxZ: 1 },
      pitch,
      0,
      fov,
      1.6,
    );
    expect(point.distance).toBeGreaterThan(0);
    expect(point.targetX).toBeCloseTo(2);
    const inverted = frameArea(
      { minX: 4, maxX: -4, minZ: Number.NaN, maxZ: 1 },
      pitch,
      0,
      fov,
      1.6,
    );
    expect(Number.isFinite(inverted.distance)).toBe(true);
    expect(Number.isFinite(inverted.targetX)).toBe(true);
    expect(Number.isFinite(inverted.targetZ)).toBe(true);
  });
});

describe("followArea", () => {
  const size = {
    margin: 0.6,
    minWidth: 0,
    minDepth: 0,
    maxWidth: Infinity,
    maxDepth: Infinity,
  };
  const bounds = mosaicBounds(90);
  const band = { count: 6, minX: 3.9, maxX: 5.1, minZ: -1.1, maxZ: 3.1 };
  const anchor = { x: 4.5, z: 2 };

  it("frames every crooked print of the band and the growth front", () => {
    const include = { minX: 5, maxX: 5, minZ: -2, maxZ: -2 };
    const area = followArea({ band, include, anchor }, bounds, size);
    expect(area.minX).toBeLessThanOrEqual(band.minX - 0.6);
    expect(area.maxX).toBeGreaterThanOrEqual(band.maxX + 0.6);
    expect(area.minZ).toBeLessThanOrEqual(-2.5);
    expect(area.maxZ).toBeGreaterThanOrEqual(band.maxZ + 0.6);
  });

  it("grows toward the straightened mosaic rather than the empty mat", () => {
    const include = { minX: 5, maxX: 5, minZ: -1, maxZ: -1 };
    const area = followArea({ band, include, anchor }, bounds, {
      ...size,
      minWidth: 9,
      minDepth: 4,
    });
    expect(area.maxX - area.minX).toBeCloseTo(9);
    const outward = area.maxX - (band.maxX + 0.6);
    const inward = band.minX - 0.6 - area.minX;
    expect(inward).toBeGreaterThan(outward * 2);
    expect(area.maxZ - area.minZ).toBeGreaterThanOrEqual(4);
  });

  it("grows evenly when the band sits in the middle", () => {
    const middle = { count: 9, minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const include = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    const area = followArea(
      { band: middle, include, anchor: { x: 0, z: 0 } },
      mosaicBounds(9),
      { ...size, minWidth: 6, minDepth: 6 },
    );
    expect(area.minX).toBeCloseTo(-3);
    expect(area.maxX).toBeCloseTo(3);
    expect(area.minZ).toBeCloseTo(-3);
    expect(area.maxZ).toBeCloseTo(3);
  });

  it("falls back to the growth front when nothing is crooked", () => {
    const empty = { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    const include = { minX: -5, maxX: -5, minZ: 2, maxZ: 2 };
    const area = followArea(
      { band: empty, include, anchor: { x: -5, z: 2 } },
      bounds,
      { ...size, minWidth: 7, minDepth: 4 },
    );
    expect(area.minX).toBeLessThanOrEqual(-5.5);
    expect(area.maxX).toBeGreaterThanOrEqual(-4.5);
    expect(area.maxX - area.minX).toBeCloseTo(7);
    expect(area.maxX).toBeGreaterThan(-1);
  });

  it("looks ahead over the next slots of the spiral", () => {
    const include = frontCells(9, 4);
    expect(include).toEqual({ minX: 2, maxX: 2, minZ: -2, maxZ: 1 });
    const area = followArea({ band, include, anchor }, bounds, size);
    expect(area.minZ).toBeLessThanOrEqual(-2.5);
    expect(area.maxZ).toBeGreaterThanOrEqual(band.maxZ + 0.6);
  });
});

describe("followArea on a small screen", () => {
  const corner = { count: 24, minX: -5.1, maxX: 4.1, minZ: -5.1, maxZ: 5.1 };
  const include = { minX: 4, maxX: 5, minZ: 5, maxZ: 5 };
  const size = {
    margin: 0.6,
    minWidth: 4,
    minDepth: 3,
    maxWidth: 6.5,
    maxDepth: 5,
  };

  it("stays on the prints being straightened when the band is too big to show legibly", () => {
    const area = followArea(
      { band: corner, include, anchor: { x: -5, z: -1 } },
      mosaicBounds(110),
      size,
    );
    expect(area.maxX - area.minX).toBeCloseTo(6.5);
    expect(area.maxZ - area.minZ).toBeCloseTo(5);
    expect(area.minX).toBeLessThanOrEqual(-5.6);
    expect(area.minZ).toBeLessThanOrEqual(-3);
    expect(area.maxZ).toBeGreaterThanOrEqual(1);
  });

  it("never clips a band that already fits", () => {
    const small = { count: 4, minX: 3, maxX: 5, minZ: 4, maxZ: 5 };
    const area = followArea(
      { band: small, include, anchor: { x: 3, z: 4 } },
      mosaicBounds(110),
      size,
    );
    expect(area.minX).toBeLessThanOrEqual(2.4);
    expect(area.maxX).toBeGreaterThanOrEqual(5.5);
    expect(area.maxZ).toBeGreaterThanOrEqual(5.6);
  });
});

describe("frontCells", () => {
  it("covers the cells the next prints will land on", () => {
    expect(frontCells(0, 1)).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    const box = frontCells(23, 3);
    for (let slot = 23; slot < 26; slot += 1) {
      const cell = spiralCell(slot);
      expect(cell.x).toBeGreaterThanOrEqual(box.minX);
      expect(cell.x).toBeLessThanOrEqual(box.maxX);
      expect(cell.z).toBeGreaterThanOrEqual(box.minZ);
      expect(cell.z).toBeLessThanOrEqual(box.maxZ);
    }
  });

  it("always includes at least the next slot", () => {
    expect(frontCells(5, 0)).toEqual(frontCells(5, 1));
    expect(frontCells(Number.NaN, 2)).toEqual(frontCells(0, 2));
  });
});

describe("focusArea", () => {
  const size = {
    margin: 0.7,
    minWidth: 3.2,
    minDepth: 2.4,
    maxWidth: Infinity,
    maxDepth: Infinity,
  };
  const none = { count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  const print = (x: number, z: number) => ({
    minX: x,
    maxX: x,
    minZ: z,
    maxZ: z,
  });

  it("closes in on a single print of the visitor", () => {
    const area = focusArea(
      { band: none, include: print(4, -2), anchor: { x: 4, z: -2 } },
      size,
    );
    expect((area.minX + area.maxX) / 2).toBeCloseTo(4);
    expect((area.minZ + area.maxZ) / 2).toBeCloseTo(-2);
    expect(area.maxX - area.minX).toBeCloseTo(3.2);
    expect(area.maxZ - area.minZ).toBeCloseTo(2.4);
  });

  it("follows the whole band of a visitor's folder", () => {
    const folder = { count: 40, minX: -6, maxX: 7, minZ: -7, maxZ: -5 };
    const area = focusArea(
      { band: folder, include: print(7, -5), anchor: { x: 0, z: -7 } },
      size,
    );
    expect(area.minX).toBeLessThanOrEqual(-6.7);
    expect(area.maxX).toBeGreaterThanOrEqual(7.7);
    expect(area.minZ).toBeLessThanOrEqual(-7.7);
    expect(area.maxZ).toBeGreaterThanOrEqual(-4.3);
  });

  it("stays on the visitor's prints being straightened when a folder is too big to show legibly", () => {
    const folder = { count: 40, minX: -6, maxX: 7, minZ: -7, maxZ: 7 };
    const area = focusArea(
      { band: folder, include: print(7, 6), anchor: { x: 7, z: -2 } },
      { ...size, maxWidth: 6, maxDepth: 5 },
    );
    expect(area.maxX - area.minX).toBeCloseTo(6);
    expect(area.maxZ - area.minZ).toBeCloseTo(5);
    expect(area.maxX).toBeGreaterThanOrEqual(7.7);
    expect(area.minZ).toBeLessThanOrEqual(-4);
    expect(area.maxZ).toBeGreaterThanOrEqual(0);
  });
});

describe("leadAnchor", () => {
  const size = {
    margin: 0.6,
    minWidth: 4,
    minDepth: 3,
    maxWidth: 8,
    maxDepth: 6,
  };

  it("sits between the straightening prints and the growth front", () => {
    const action = { x: 2, z: 0 };
    const anchor = leadAnchor(
      action,
      action,
      { minX: 4, maxX: 4, minZ: 1, maxZ: 1 },
      size,
    );
    expect(anchor.x).toBeCloseTo(3);
    expect(anchor.z).toBeCloseTo(0.5);
  });

  it("leads along the spiral where the action is heading", () => {
    const action = { x: 2, z: 0 };
    const anchor = leadAnchor(
      action,
      { x: 2, z: -1 },
      { minX: 2, maxX: 2, minZ: -1, maxZ: -1 },
      size,
    );
    expect(anchor.x).toBeCloseTo(2);
    expect(anchor.z).toBeCloseTo(-1);
  });

  it("never leads so far that the straightening prints leave the window", () => {
    const action = { x: -5, z: 5 };
    const anchor = leadAnchor(
      action,
      { x: -6, z: -1 },
      { minX: 5, maxX: 6, minZ: -5, maxZ: -5 },
      size,
    );
    expect(Math.abs(anchor.x - action.x)).toBeLessThanOrEqual(8 * 0.3 + 1e-9);
    expect(Math.abs(anchor.z - action.z)).toBeLessThanOrEqual(6 * 0.3 + 1e-9);
    expect(anchor.z).toBeLessThan(action.z - 1);
  });

  it("stays near the action when nothing limits the window", () => {
    const action = { x: 1, z: 1 };
    const anchor = leadAnchor(
      action,
      action,
      { minX: 9, maxX: 9, minZ: 1, maxZ: 1 },
      { ...size, maxWidth: Infinity, maxDepth: Infinity },
    );
    expect(anchor.x).toBeCloseTo(5);
    expect(anchor.z).toBeCloseTo(1);
  });
});

describe("spiralPoint", () => {
  it("is the cell centre for whole slots", () => {
    for (const slot of [0, 1, 7, 24, 113]) {
      expect(spiralPoint(slot)).toEqual(spiralCell(slot));
    }
  });

  it("glides along the spiral between slots, also around corners", () => {
    expect(spiralPoint(0.5)).toEqual({ x: 0.5, z: 0 });
    const corner = spiralPoint(2.25);
    expect(corner.x).toBeCloseTo(0.75);
    expect(corner.z).toBeCloseTo(-1);
  });

  it("falls back to the centre for invalid slots", () => {
    expect(spiralPoint(Number.NaN)).toEqual({ x: 0, z: 0 });
    expect(spiralPoint(-3)).toEqual({ x: 0, z: 0 });
  });
});

describe("screenExtent", () => {
  const fov = 32 * DEG;
  const area = { minX: -2, maxX: 3, minZ: -1, maxZ: 2 };

  it("is the full view for an area framed by frameArea", () => {
    const view = frameArea(area, 54 * DEG, DESK_YAW, fov, 1.3);
    const extent = screenExtent(area, view, fov, 1.3);
    expect(Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY)).toBeCloseTo(2, 2);
    expect(extent.minX).toBeGreaterThanOrEqual(-1.002);
    expect(extent.maxY).toBeLessThanOrEqual(1.002);
  });

  it("shows when the area spills out of a view that has not moved", () => {
    const view = frameArea(area, 54 * DEG, DESK_YAW, fov, 1.3);
    const moved = { ...area, maxX: area.maxX + 3 };
    expect(screenExtent(moved, view, fov, 1.3).maxX).toBeGreaterThan(1.1);
  });

  it("reports an area behind the camera as unbounded", () => {
    const view = { targetX: 0, targetZ: 0, distance: 2, pitch: 30 * DEG, yaw: 0 };
    const behind = { minX: -1, maxX: 1, minZ: 5, maxZ: 9 };
    const extent = screenExtent(behind, view, fov, 1.3);
    expect(extent.maxY).toBe(Infinity);
  });
});

describe("arrivalFrame", () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  it("is the arrival view with no shift when nothing covers the canvas", () => {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [900, 900],
    ] as const) {
      const frame = arrivalFrame(width, height, none);
      const view = arrivalView(width / height);
      expect(frame.view.distance).toBeCloseTo(view.distance, 9);
      expect(frame.view.targetX).toBeCloseTo(view.targetX, 9);
      expect(frame.view.targetZ).toBeCloseTo(view.targetZ, 9);
      expect(frame.view.pitch).toBeCloseTo(view.pitch, 12);
      expect(frame.view.yaw).toBeCloseTo(view.yaw, 12);
      expect(frame.shiftX).toBe(0);
      expect(frame.shiftY).toBe(0);
      expect(frame.fovY).toBeCloseTo(viewFov(width / height), 12);
    }
  });

  it("frames the arrival area inside the free rectangle", () => {
    const insets = { top: 64, right: 0, bottom: 68, left: 518 };
    const frame = arrivalFrame(1440, 900, insets);
    const free = viewFrame(1440, 900, insets);
    const expected = frameArea(
      {
        minX: -ARRIVAL_WIDTH / 2,
        maxX: ARRIVAL_WIDTH / 2,
        minZ: -ARRIVAL_DEPTH / 2,
        maxZ: ARRIVAL_DEPTH / 2,
      },
      ARRIVAL_PITCH,
      DESK_YAW,
      free.fovY,
      free.aspect,
    );
    expect(frame.view).toEqual(expected);
    expect(frame.shiftX).toBeCloseTo(free.shiftX, 12);
    expect(frame.shiftY).toBeCloseTo(free.shiftY, 12);
    expect(frame.fovY).toBeCloseTo(free.cameraFovY, 12);
    expect(frame.view.distance).toBeGreaterThan(arrivalView(1.6).distance);
  });
});

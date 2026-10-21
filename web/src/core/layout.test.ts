import { describe, expect, it } from "vitest";
import type { Quarter } from "../contracts";
import {
  ARRIVAL_PITCH,
  CROOKED_LAYERS,
  CROOKED_OFFSET_JITTER,
  CROOKED_YAW_JITTER,
  PRINT_LONG_SIDE,
  arrivalView,
  borderWidth,
  cellSlot,
  compositionShift,
  crookedLayer,
  crookedPose,
  fitDistance,
  followMargin,
  matHalfSize,
  mosaicBounds,
  printSize,
  shiftedFit,
  slotPose,
  spiralCell,
  viewFov,
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
    expect(Math.abs(view.targetX)).toBeLessThan(0.3);
    expect(Math.abs(view.targetZ)).toBeLessThan(0.3);
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

describe("compositionShift", () => {
  it("moves the subject right of the headline column on wide screens", () => {
    const shift = compositionShift(1440 / 900);
    expect(shift.x).toBeGreaterThan(0.08);
    expect(shift.x).toBeLessThan(0.16);
    expect(shift.y).toBe(0);
  });

  it("moves the subject a little down on phones", () => {
    const shift = compositionShift(390 / 844);
    expect(shift.x).toBe(0);
    expect(shift.y).toBeGreaterThan(0.02);
    expect(shift.y).toBeLessThan(0.08);
  });

  it("stays centred near square screens and never grows past its caps", () => {
    const square = compositionShift(0.9);
    expect(square.x).toBe(0);
    expect(square.y).toBe(0);
    expect(compositionShift(4).x).toBe(compositionShift(1.6).x);
    expect(compositionShift(0.2).y).toBe(compositionShift(0.46).y);
    expect(compositionShift(Number.NaN)).toEqual({ x: 0, y: 0 });
  });
});

describe("shiftedFit", () => {
  it("is the plain view when nothing is shifted", () => {
    const fit = shiftedFit(1.6, 32 * DEG, { x: 0, y: 0 });
    expect(fit.aspect).toBeCloseTo(1.6);
    expect(fit.fovY).toBeCloseTo(32 * DEG);
  });

  it("only fits the subject into the part of the screen left over", () => {
    const fit = shiftedFit(1.6, 32 * DEG, { x: 0.1, y: 0.05 });
    expect(fit.aspect).toBeCloseTo(1.6 * 0.8);
    expect(Math.tan(fit.fovY / 2)).toBeCloseTo(Math.tan(16 * DEG) * 0.9);
  });
});

describe("followMargin", () => {
  it("keeps roomy margins on desktop and tight ones on phones", () => {
    expect(followMargin(1.6)).toBeCloseTo(0.95);
    expect(followMargin(0.46)).toBeGreaterThan(0.55);
    expect(followMargin(0.46)).toBeLessThan(0.7);
    expect(followMargin(0.8)).toBeGreaterThan(followMargin(0.6));
    expect(followMargin(Number.NaN)).toBeCloseTo(0.95);
  });
});

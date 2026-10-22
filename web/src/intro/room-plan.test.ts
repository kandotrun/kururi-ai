import { describe, expect, it } from "vitest";
import { arrivalView } from "../core/layout";
import { createCameraPose, deskViewPose } from "./camera-path";
import {
  ARRIVAL_FRAME_RADIUS,
  LAMP,
  PROPS,
  ROOM,
  deskArrivalLighting,
  groundFootprint,
  matGridRect,
  projectPoint,
} from "./room-plan";

const ASPECTS = [0.42, 390 / 844, 0.75, 1, 1.33, 1440 / 900, 2, 2.4];

describe("room layout", () => {
  it("puts the mat on the desk and the desk inside the room", () => {
    expect(ROOM.mat.minX).toBeGreaterThan(ROOM.desk.minX);
    expect(ROOM.mat.maxX).toBeLessThan(ROOM.desk.maxX);
    expect(ROOM.mat.minZ).toBeGreaterThan(ROOM.desk.minZ);
    expect(ROOM.mat.maxZ).toBeLessThan(ROOM.desk.maxZ);
    expect(ROOM.desk.minZ).toBeGreaterThan(ROOM.backZ);
    expect(ROOM.desk.maxZ).toBeLessThan(ROOM.entryZ);
    expect(ROOM.desk.minX).toBeGreaterThan(-ROOM.halfWidth);
    expect(ROOM.desk.maxX).toBeLessThan(ROOM.halfWidth);
    expect(ROOM.entryWindow.bottom).toBeGreaterThan(ROOM.floorY);
    expect(ROOM.entryWindow.top).toBeLessThan(ROOM.ceilingY);
    expect(ROOM.backWindow.top).toBeLessThan(ROOM.ceilingY);
  });

  it("covers every desk arrival frame with the mat grid", () => {
    const grid = matGridRect();
    for (const aspect of ASPECTS) {
      const pose = deskViewPose(arrivalView(aspect), aspect, createCameraPose());
      for (const [x, z] of groundFootprint(pose, aspect)) {
        expect(x).toBeGreaterThan(grid.minX + 0.15);
        expect(x).toBeLessThan(grid.maxX - 0.15);
        expect(z).toBeGreaterThan(grid.minZ + 0.15);
        expect(z).toBeLessThan(grid.maxZ - 0.15);
      }
    }
  });

  it("keeps the lamp and the props out of the arrival frame", () => {
    const points = [
      LAMP.base,
      LAMP.elbow,
      LAMP.head,
      ...PROPS.map((prop) => prop.position),
    ];
    for (const aspect of ASPECTS) {
      const pose = deskViewPose(arrivalView(aspect), aspect, createCameraPose());
      for (const point of points) {
        const [x, y] = projectPoint(pose, aspect, point);
        expect(Math.max(Math.abs(x), Math.abs(y))).toBeGreaterThan(1.05);
      }
    }
  });

  it("aims the lamp at the middle of the mat", () => {
    const dx = 0 - LAMP.head[0];
    const dy = 0 - LAMP.head[1];
    const dz = 0 - LAMP.head[2];
    const length = Math.hypot(dx, dy, dz);
    const aim = LAMP.direction;
    const cosine = (aim[0] * dx + aim[1] * dy + aim[2] * dz) / length;
    expect(cosine).toBeGreaterThan(0.98);
  });
});

describe("groundFootprint", () => {
  it("returns the four ground corners of a straight-down view", () => {
    const pose = createCameraPose();
    pose.position = [0, 10, 0];
    pose.target = [0, 0, 0];
    pose.up = [0, 0, -1];
    pose.fov = 90;
    const corners = groundFootprint(pose, 1);
    expect(corners).toHaveLength(4);
    for (const [x, z] of corners) {
      expect(Math.abs(x)).toBeCloseTo(10, 6);
      expect(Math.abs(z)).toBeCloseTo(10, 6);
    }
  });
});

describe("deskArrivalLighting", () => {
  it("mirrors the desk scene lamp pool and fog around the arrival target", () => {
    const view = arrivalView(1.6);
    const lighting = deskArrivalLighting(view);
    expect(lighting.lampRadius).toBeCloseTo(ARRIVAL_FRAME_RADIUS * 0.95, 9);
    expect(lighting.fogRange[0]).toBeLessThan(lighting.fogRange[1]);
    expect(lighting.lampCenter[0]).toBeLessThan(view.targetX);
    expect(lighting.satin[1]).toBeCloseTo(view.distance * 0.72, 9);
  });
});

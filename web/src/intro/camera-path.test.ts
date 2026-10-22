import { describe, expect, it } from "vitest";
import {
  type CameraPose,
  cityToRoom,
  createCameraPath,
  createCameraPose,
  defaultDeskView,
  deskViewPose,
  fovForAspect,
} from "./camera-path";
import { arrivalView, viewFov } from "../core/layout";
import { HERO_GLASS, HERO_WINDOW, PORTAL_SCALE } from "./city-plan";
import { ROOM, projectPoint } from "./room-plan";
import { type Vec3, latLonToVec3, localFrame } from "./geo-math";
import { PORTAL, ROOM_IN } from "./timeline";

const TOKYO = { lat: 35.6812, lon: 139.7671 };
const DEG = Math.PI / 180;
const ASPECTS = [1440 / 900, 390 / 844, 1];

function sub(a: readonly number[], b: readonly number[]): number[] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function norm(a: readonly number[]): number {
  return Math.hypot(a[0]!, a[1]!, a[2]!);
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function viewDirection(pose: CameraPose): number[] {
  const d = sub(pose.target, pose.position);
  const length = norm(d);
  return [d[0]! / length, d[1]! / length, d[2]! / length];
}

function pitchBelowHorizon(pose: CameraPose, up: readonly number[]): number {
  return Math.asin(-dot(viewDirection(pose), up)) / DEG;
}

type Stage = "globe" | "city" | "room";

function checkContinuity(stage: Stage, from: number, to: number): void {
  for (const aspect of ASPECTS) {
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const a = createCameraPose();
    const b = createCameraPose();
    const step = 0.002;
    for (let time = from; time < to; time += step) {
      path[stage](time, a);
      path[stage](time + step, b);
      const scale = Math.max(
        stage === "globe" ? 1e-4 : 0.05,
        norm(sub(a.target, a.position)),
      );
      expect(norm(sub(a.position, b.position)) / scale).toBeLessThan(0.06);
      const turn = Math.acos(
        Math.min(1, dot(viewDirection(a), viewDirection(b))),
      );
      expect(turn).toBeLessThan(1.2 * DEG);
    }
  }
}

describe("fovForAspect", () => {
  it("matches the desk camera field of view", () => {
    expect(fovForAspect(1.6)).toBeCloseTo(32, 9);
    expect(fovForAspect(0.3)).toBeCloseTo(41, 9);
    for (const aspect of ASPECTS) {
      expect(fovForAspect(aspect) * DEG).toBeCloseTo(viewFov(aspect), 12);
    }
  });
});

describe("defaultDeskView", () => {
  it("is the desk scene arrival view", () => {
    for (const aspect of ASPECTS) {
      expect(defaultDeskView(aspect)).toEqual({ ...arrivalView(aspect) });
    }
  });
});

describe("globe camera", () => {
  it("starts with the Earth at about 45% of a landscape frame", () => {
    const aspect = 1440 / 900;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const pose = path.globe(0, createCameraPose());
    const distance = norm(pose.position);
    const angular = Math.asin(1 / distance);
    const fraction = Math.tan(angular) / Math.tan((pose.fov * DEG) / 2);
    expect(fraction).toBeGreaterThan(0.42);
    expect(fraction).toBeLessThan(0.48);
    expect(norm(pose.target)).toBeLessThan(0.12);
  });

  it("keeps the Earth inside a portrait frame", () => {
    const aspect = 390 / 844;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const pose = path.globe(0, createCameraPose());
    const angular = Math.asin(1 / norm(pose.position));
    const halfWidth = Math.tan((pose.fov * DEG) / 2) * aspect;
    expect(Math.tan(angular) / halfWidth).toBeLessThan(0.86);
  });

  it("moves continuously", () => {
    checkContinuity("globe", 0, 6.2);
  });

  it("ends low over Tokyo looking at it obliquely from the south", () => {
    const aspect = 1.6;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const pose = path.globe(6.0, createCameraPose());
    const tokyo = latLonToVec3(TOKYO);
    const altitude = norm(pose.position) - 1;
    expect(altitude * 6371).toBeLessThan(45);
    expect(altitude * 6371).toBeGreaterThan(10);
    expect(norm(sub(pose.target, tokyo))).toBeLessThan(1e-6);
    const up = latLonToVec3(TOKYO);
    const pitch = pitchBelowHorizon(pose, up);
    expect(pitch).toBeGreaterThan(30);
    expect(pitch).toBeLessThan(60);
    const north = localFrame(TOKYO).north;
    expect(dot(viewDirection(pose), north)).toBeGreaterThan(0.3);
  });
});

describe("city camera", () => {
  it("starts with the same downward angle as the globe ends", () => {
    const aspect = 1.6;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const globe = path.globe(6.0, createCameraPose());
    const city = path.city(6.0, createCameraPose());
    const globePitch = pitchBelowHorizon(globe, latLonToVec3(TOKYO));
    const cityPitch = pitchBelowHorizon(city, [0, 1, 0]);
    expect(Math.abs(globePitch - cityPitch)).toBeLessThan(10);
    expect(viewDirection(city)[2]).toBeLessThan(-0.3);
  });

  it("moves continuously", () => {
    checkContinuity("city", 5.9, 7.9);
  });

  it("ends right in front of the lit window, looking into it", () => {
    const aspect = 1.6;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const pose = path.city(7.82, createCameraPose());
    const window = [HERO_WINDOW.x, HERO_WINDOW.y, HERO_WINDOW.z];
    const offset = sub(pose.position, window);
    expect(norm(offset)).toBeLessThan(4);
    expect(offset[2]).toBeGreaterThan(0);
    const toWindow = sub(window, pose.position);
    const aim = dot(viewDirection(pose), toWindow) / norm(toWindow);
    expect(aim).toBeGreaterThan(0.97);
  });
});

describe("room camera", () => {
  it("enters through the window towards the desk", () => {
    const aspect = 1.6;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const start = path.room(7.79, createCameraPose());
    expect(start.position[2]).toBeGreaterThan(ROOM.entryZ);
    expect(viewDirection(start)[2]).toBeLessThan(-0.8);
    const inside = path.room(8.2, createCameraPose());
    expect(inside.position[2]).toBeLessThan(ROOM.entryZ);
  });

  it("moves continuously", () => {
    checkContinuity("room", PORTAL[0], 10);
  });

  it("opens wide on the room and narrows to the desk field of view", () => {
    for (const aspect of ASPECTS) {
      const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
      const desk = fovForAspect(aspect);
      expect(path.room(8.35, createCameraPose()).fov).toBeGreaterThan(desk + 14);
      expect(path.room(9.4, createCameraPose()).fov).toBeCloseTo(desk, 9);
      let previous = path.room(8.4, createCameraPose()).fov;
      for (let time = 8.4; time <= 9.4; time += 0.01) {
        const current = path.room(time, createCameraPose()).fov;
        expect(current).toBeLessThanOrEqual(previous + 1e-9);
        expect(previous - current).toBeLessThan(0.6);
        previous = current;
      }
    }
  });

  it("comes to rest on the desk camera pose for the hand-off", () => {
    for (const aspect of ASPECTS) {
      const view = defaultDeskView(aspect);
      const path = createCameraPath(aspect, TOKYO, view);
      const expected = deskViewPose(view, aspect, createCameraPose());
      for (const time of [9.4, 9.7, 10]) {
        const pose = path.room(time, createCameraPose());
        expect(norm(sub(pose.position, expected.position))).toBeLessThan(1e-6);
        expect(norm(sub(pose.target, expected.target))).toBeLessThan(1e-6);
      }
      const before = path.room(9.38, createCameraPose());
      expect(norm(sub(before.position, expected.position))).toBeLessThan(0.02);
      expect(pitchBelowHorizon(expected, [0, 1, 0])).toBeCloseTo(
        view.pitch / DEG,
        6,
      );
    }
  });
});

describe("window portal", () => {
  it("maps the hero window glass exactly onto the room's entry opening", () => {
    const opening = ROOM.entryWindow;
    expect(HERO_GLASS.width * PORTAL_SCALE).toBeCloseTo(opening.halfWidth * 2, 6);
    expect(HERO_GLASS.height * PORTAL_SCALE).toBeCloseTo(
      opening.top - opening.bottom,
      6,
    );
    expect(HERO_GLASS.width).toBeLessThan(HERO_WINDOW.width);
    expect(HERO_GLASS.height).toBeLessThan(HERO_WINDOW.height);
    const centre = cityToRoom([HERO_WINDOW.x, HERO_WINDOW.y, HERO_WINDOW.z], [0, 0, 0]);
    expect(centre[0]).toBeCloseTo(opening.centerX, 9);
    expect(centre[1]).toBeCloseTo((opening.top + opening.bottom) / 2, 9);
    expect(centre[2]).toBeCloseTo(ROOM.entryZ + ROOM.wallThickness, 9);
  });

  it("films the room through the window from the city camera's point of view", () => {
    for (const aspect of ASPECTS) {
      const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
      for (let time = PORTAL[0]; time <= ROOM_IN[1]; time += 0.01) {
        const city = path.city(time, createCameraPose());
        const room = path.room(time, createCameraPose());
        const position = cityToRoom(city.position, [0, 0, 0]);
        const target = cityToRoom(city.target, [0, 0, 0]);
        const reach = norm(sub(position, target));
        expect(norm(sub(room.position, position)) / reach).toBeLessThan(1e-9);
        expect(norm(sub(room.target, target)) / reach).toBeLessThan(1e-9);
        expect(room.fov).toBeCloseTo(city.fov, 9);
        expect(room.near).toBeLessThan(
          (room.position[2] - (ROOM.entryZ + ROOM.wallThickness)) * 0.9,
        );
        expect(room.far).toBeGreaterThan(reach + 2 * (ROOM.entryZ - ROOM.backZ));
      }
    }
  });

  it("fills the frame with the window glass before the room takes over", () => {
    for (const aspect of [390 / 844, 1, 1.6, 1920 / 820]) {
      const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
      for (const time of [ROOM_IN[0], (ROOM_IN[0] + ROOM_IN[1]) / 2, ROOM_IN[1]]) {
        const pose = path.city(time, createCameraPose());
        const halfWidth = HERO_GLASS.width / 2;
        const halfHeight = HERO_GLASS.height / 2;
        const corner = (sx: number, sy: number): Vec3 =>
          projectPoint(pose, aspect, [
            HERO_WINDOW.x + sx * halfWidth,
            HERO_WINDOW.y + sy * halfHeight,
            HERO_WINDOW.z,
          ]);
        const topLeft = corner(-1, 1);
        const topRight = corner(1, 1);
        const bottomLeft = corner(-1, -1);
        const bottomRight = corner(1, -1);
        expect(topLeft[0]).toBeLessThan(-1);
        expect(bottomLeft[0]).toBeLessThan(-1);
        expect(topRight[0]).toBeGreaterThan(1);
        expect(bottomRight[0]).toBeGreaterThan(1);
        expect(topLeft[1]).toBeGreaterThan(1);
        expect(topRight[1]).toBeGreaterThan(1);
        expect(bottomLeft[1]).toBeLessThan(-1);
        expect(bottomRight[1]).toBeLessThan(-1);
      }
    }
  });
});

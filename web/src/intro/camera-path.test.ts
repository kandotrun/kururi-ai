import { describe, expect, it } from "vitest";
import {
  type CameraPose,
  createCameraPath,
  createCameraPose,
  defaultDeskView,
  deskViewPose,
  fovForAspect,
} from "./camera-path";
import { HERO_WINDOW, ROOM } from "./city-plan";
import { latLonToVec3, localFrame } from "./geo-math";

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
    expect(norm(pose.target)).toBeLessThan(1e-9);
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
    checkContinuity("globe", 0, 5.7);
  });

  it("ends low over Tokyo looking at it obliquely from the south", () => {
    const aspect = 1.6;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const pose = path.globe(5.55, createCameraPose());
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
    const globe = path.globe(5.55, createCameraPose());
    const city = path.city(5.55, createCameraPose());
    const globePitch = pitchBelowHorizon(globe, latLonToVec3(TOKYO));
    const cityPitch = pitchBelowHorizon(city, [0, 1, 0]);
    expect(Math.abs(globePitch - cityPitch)).toBeLessThan(10);
    expect(viewDirection(city)[2]).toBeLessThan(-0.3);
  });

  it("moves continuously", () => {
    checkContinuity("city", 5.4, 7.45);
  });

  it("ends right in front of the lit window, looking into it", () => {
    const aspect = 1.6;
    const path = createCameraPath(aspect, TOKYO, defaultDeskView(aspect));
    const pose = path.city(7.36, createCameraPose());
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
    const start = path.room(7.33, createCameraPose());
    expect(start.position[2]).toBeGreaterThan(ROOM.windowZ);
    expect(viewDirection(start)[2]).toBeLessThan(-0.8);
    const inside = path.room(7.7, createCameraPose());
    expect(inside.position[2]).toBeLessThan(ROOM.windowZ);
  });

  it("moves continuously", () => {
    checkContinuity("room", 7.3, 9.6);
  });

  it("comes to rest on the desk camera pose for the hand-off", () => {
    for (const aspect of ASPECTS) {
      const view = defaultDeskView(aspect);
      const path = createCameraPath(aspect, TOKYO, view);
      const expected = deskViewPose(view, aspect, createCameraPose());
      for (const time of [9.0, 9.3, 9.6]) {
        const pose = path.room(time, createCameraPose());
        expect(norm(sub(pose.position, expected.position))).toBeLessThan(1e-6);
        expect(norm(sub(pose.target, expected.target))).toBeLessThan(1e-6);
      }
      const before = path.room(8.98, createCameraPose());
      expect(norm(sub(before.position, expected.position))).toBeLessThan(0.02);
      expect(pitchBelowHorizon(expected, [0, 1, 0])).toBeCloseTo(
        view.pitch / DEG,
        6,
      );
    }
  });
});

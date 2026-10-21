import { Color, LinearSRGBColorSpace, Vector2, Vector3 } from "three";
import { linearColor } from "./palette";

export interface Uniform<T> {
  value: T;
}

export interface SharedUniforms {
  [name: string]: Uniform<unknown>;
  uTime: Uniform<number>;
  uCameraPos: Uniform<Vector3>;
  uLampPos: Uniform<Vector3>;
  uLampCenter: Uniform<Vector2>;
  uLampRadius: Uniform<number>;
  uFogCenter: Uniform<Vector2>;
  uFogRange: Uniform<Vector2>;
  uMatDeep: Uniform<Color>;
  uLampTint: Uniform<Color>;
  uViewport: Uniform<Vector2>;
  uViewShift: Uniform<Vector2>;
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uCameraPos: { value: new Vector3(0, 12, 9) },
    uLampPos: { value: new Vector3(-2.4, 8, -2) },
    uLampCenter: { value: new Vector2(0, 0) },
    uLampRadius: { value: 9 },
    uFogCenter: { value: new Vector2(0, 0) },
    uFogRange: { value: new Vector2(12, 30) },
    uMatDeep: { value: linearColor("matDeep") },
    uLampTint: {
      value: new Color().setRGB(1, 0.962, 0.895, LinearSRGBColorSpace),
    },
    uViewport: { value: new Vector2(1, 1) },
    uViewShift: { value: new Vector2(0, 0) },
  };
}

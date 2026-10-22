import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferGeometry,
  type PerspectiveCamera,
} from "three";
import type { CameraPose } from "./camera-path";

export function fullscreenTriangle(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  return geometry;
}

export function quadGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(12), 3),
  );
  geometry.setAttribute(
    "aCorner",
    new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function ribbonGeometry(segments: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  const vertices = (segments + 1) * 2;
  const along = new Float32Array(vertices);
  const side = new Float32Array(vertices);
  for (let index = 0; index <= segments; index += 1) {
    along[index * 2] = index / segments;
    along[index * 2 + 1] = index / segments;
    side[index * 2] = -1;
    side[index * 2 + 1] = 1;
  }
  const indices: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(vertices * 3), 3),
  );
  geometry.setAttribute("aS", new BufferAttribute(along, 1));
  geometry.setAttribute("aSide", new BufferAttribute(side, 1));
  geometry.setIndex(indices);
  return geometry;
}

export function applyPose(
  camera: PerspectiveCamera,
  pose: CameraPose,
  aspect: number,
): void {
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
  camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  if (
    camera.fov !== pose.fov ||
    camera.near !== pose.near ||
    camera.far !== pose.far ||
    camera.aspect !== aspect
  ) {
    camera.fov = pose.fov;
    camera.near = pose.near;
    camera.far = pose.far;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}

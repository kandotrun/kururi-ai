import { type PerspectiveCamera, Vector3 } from "three";
import type { DeskPose } from "../contracts";

export interface Pickable {
  pose: DeskPose;
  width: number;
  depth: number;
}

export class DeskPicker {
  private readonly camera: PerspectiveCamera;
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly projected = new Vector3();
  hitX = 0;
  hitZ = 0;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  aim(x: number, y: number, width: number, height: number): void {
    const ndcX = (x / Math.max(1, width)) * 2 - 1;
    const ndcY = -(y / Math.max(1, height)) * 2 + 1;
    this.origin.setFromMatrixPosition(this.camera.matrixWorld);
    this.direction
      .set(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(this.origin)
      .normalize();
  }

  plane(height: number): boolean {
    const dy = this.direction.y;
    if (Math.abs(dy) < 1e-6) {
      return false;
    }
    const t = (height - this.origin.y) / dy;
    if (t <= 0) {
      return false;
    }
    this.hitX = this.origin.x + this.direction.x * t;
    this.hitZ = this.origin.z + this.direction.z * t;
    return true;
  }

  distanceTo(item: Pickable, lift: number): number {
    const pose = item.pose;
    const height = pose.y + lift;
    const dy = this.direction.y;
    if (Math.abs(dy) < 1e-6 || pose.scale <= 0) {
      return -1;
    }
    const t = (height - this.origin.y) / dy;
    if (t <= 0) {
      return -1;
    }
    const x = this.origin.x + this.direction.x * t - pose.x;
    const z = this.origin.z + this.direction.z * t - pose.z;
    const cos = Math.cos(pose.yaw);
    const sin = Math.sin(pose.yaw);
    const localX = cos * x - sin * z;
    const localZ = sin * x + cos * z;
    const halfWidth = (item.width * pose.scale) / 2;
    const halfDepth = (item.depth * pose.scale) / 2;
    if (Math.abs(localX) > halfWidth || Math.abs(localZ) > halfDepth) {
      return -1;
    }
    return t;
  }

  project(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
  ): { x: number; y: number } | null {
    this.projected.set(x, y, z).project(this.camera);
    if (this.projected.z > 1 || this.projected.z < -1) {
      return null;
    }
    return {
      x: ((this.projected.x + 1) / 2) * width,
      y: ((1 - this.projected.y) / 2) * height,
    };
  }
}

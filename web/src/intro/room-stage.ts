import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  InstancedBufferAttribute,
  LinearSRGBColorSpace,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  type Side,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import type { Random } from "../core/random";
import type { CameraPose } from "./camera-path";
import { ROOM } from "./city-plan";
import {
  GLOW_FRAGMENT,
  GLOW_VERTEX,
  STREAM_FRAGMENT,
  STREAM_VERTEX,
} from "./city-shaders";
import { envelope, smoothstep } from "./easing";
import {
  GLASS_FRAGMENT,
  MAT_FRAGMENT,
  ROOM_FRAGMENT,
  ROOM_VERTEX,
} from "./room-shaders";
import { applyPose, quadGeometry, ribbonGeometry } from "./stage-util";

export interface RoomStageOptions {
  lowPower: boolean;
  random: Random;
}

const KIND_PLAIN = 0;
const KIND_FLOOR = 1;
const KIND_DESK = 2;

function linear(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, LinearSRGBColorSpace);
}

function srgb(hex: string): Color {
  return new Color(hex);
}

export const LAMP_HEAD = new Vector3(-2.4, 8, -2);
const POOL_CENTER = new Vector3(0, 0, 0);
const GLOW_POINT = new Vector3(0, 2.4, 0.3);

export class RoomStage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.08, 300);
  private readonly viewport = new Vector2(1, 1);
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly light = {
    uLampPos: { value: LAMP_HEAD.clone() },
    uLampDir: { value: POOL_CENTER.clone().sub(LAMP_HEAD).normalize() },
    uLampColor: { value: linear(1.0, 0.86, 0.68) },
    uLampPower: { value: 10 },
    uGlowPos: { value: GLOW_POINT.clone() },
    uGlowColor: { value: linear(1.0, 0.78, 0.52) },
    uGlowPower: { value: 0 },
    uCityColor: { value: linear(0.05, 0.07, 0.075) },
    uWindowCenter: {
      value: new Vector3(
        0,
        (ROOM.windowBottom + ROOM.windowTop) / 2,
        ROOM.windowZ + 2,
      ),
    },
    uPoolCenter: { value: new Vector2(0, 0) },
    uPoolRadius: { value: 9 },
    uPoolTint: { value: linear(1, 0.962, 0.895) },
  };
  private readonly stream: ShaderMaterial;
  private readonly glow: ShaderMaterial;

  constructor(options: RoomStageOptions) {
    const wall = srgb("#2C3A36").multiplyScalar(0.55);
    const wallMaterial = this.surface(wall, KIND_PLAIN);
    const height = ROOM.ceilingY - ROOM.floorY;
    const depth = ROOM.windowZ - ROOM.backZ;
    const midZ = (ROOM.windowZ + ROOM.backZ) / 2;
    const midY = (ROOM.ceilingY + ROOM.floorY) / 2;

    const floor = this.plane(ROOM.halfWidth * 2, depth + 4, this.surface(linear(0.03, 0.022, 0.016), KIND_FLOOR));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, ROOM.floorY, midZ + 2);
    const ceiling = this.plane(ROOM.halfWidth * 2, depth + 4, this.surface(linear(0.05, 0.056, 0.053), KIND_PLAIN));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, ROOM.ceilingY, midZ + 2);
    const back = this.plane(ROOM.halfWidth * 2, height, wallMaterial);
    back.position.set(0, midY, ROOM.backZ);
    const left = this.plane(depth + 4, height, wallMaterial);
    left.rotation.y = Math.PI / 2;
    left.position.set(-ROOM.halfWidth, midY, midZ + 2);
    const right = this.plane(depth + 4, height, wallMaterial);
    right.rotation.y = -Math.PI / 2;
    right.position.set(ROOM.halfWidth, midY, midZ + 2);

    const thickness = ROOM.wallThickness;
    const wallZ = ROOM.windowZ + thickness / 2;
    const sideWidth = ROOM.halfWidth - ROOM.windowHalfWidth;
    this.box(sideWidth, height, thickness, -(ROOM.windowHalfWidth + sideWidth / 2), midY, wallZ, wallMaterial);
    this.box(sideWidth, height, thickness, ROOM.windowHalfWidth + sideWidth / 2, midY, wallZ, wallMaterial);
    this.box(ROOM.windowHalfWidth * 2, ROOM.ceilingY - ROOM.windowTop, thickness, 0, (ROOM.ceilingY + ROOM.windowTop) / 2, wallZ, wallMaterial);
    this.box(ROOM.windowHalfWidth * 2, ROOM.windowBottom - ROOM.floorY, thickness, 0, (ROOM.windowBottom + ROOM.floorY) / 2, wallZ, wallMaterial);

    const frame = this.surface(linear(0.1, 0.105, 0.1), KIND_PLAIN);
    const span = ROOM.windowHalfWidth * 2;
    const openHeight = ROOM.windowTop - ROOM.windowBottom;
    const openMid = (ROOM.windowTop + ROOM.windowBottom) / 2;
    this.box(span + 0.6, 0.28, thickness + 0.5, 0, ROOM.windowBottom - 0.1, wallZ - 0.2, frame);
    this.box(span, 0.22, 0.4, 0, ROOM.windowTop - 0.11, wallZ + 0.2, frame);
    this.box(0.22, openHeight, 0.4, -ROOM.windowHalfWidth + 0.11, openMid, wallZ + 0.2, frame);
    this.box(0.22, openHeight, 0.4, ROOM.windowHalfWidth - 0.11, openMid, wallZ + 0.2, frame);
    this.box(0.16, openHeight, 0.3, -0.9, openMid, wallZ + 0.35, frame);
    this.box(ROOM.windowHalfWidth - 0.9, 0.14, 0.24, -(ROOM.windowHalfWidth + 0.9) / 2, 7.7, wallZ + 0.35, frame);
    const glass = this.material({
      uniforms: { ...this.light },
      vertexShader: ROOM_VERTEX,
      fragmentShader: GLASS_FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      blending: NormalBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const pane = this.plane(ROOM.windowHalfWidth - 0.9, openHeight - 0.2, glass);
    pane.position.set(-(ROOM.windowHalfWidth + 0.9) / 2, openMid, wallZ + 0.42);
    pane.renderOrder = 4;

    const deskColor = srgb("#0F241D");
    this.box(ROOM.deskHalfWidth * 2, ROOM.deskThickness, ROOM.deskHalfDepth * 2, 0, -ROOM.deskThickness / 2 - 0.02, 0, this.surface(deskColor, KIND_DESK));
    const legMaterial = this.surface(linear(0.018, 0.02, 0.019), KIND_PLAIN);
    const legHeight = -ROOM.floorY - ROOM.deskThickness;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.box(0.7, legHeight, 0.7, sx * (ROOM.deskHalfWidth - 0.8), ROOM.floorY + legHeight / 2, sz * (ROOM.deskHalfDepth - 0.8), legMaterial);
      }
    }
    const matMaterial = this.material({
      uniforms: {
        ...this.light,
        uMat: { value: srgb("#2B5A4A") },
        uLine: { value: srgb("#8DB8A6") },
        uDesk: { value: deskColor },
        uHalf: { value: new Vector2(ROOM.matHalfWidth, ROOM.matHalfDepth) },
        uMargin: { value: 1.2 },
      },
      vertexShader: ROOM_VERTEX,
      fragmentShader: MAT_FRAGMENT,
    });
    const mat = this.plane(ROOM.matHalfWidth * 2 + 0.9, ROOM.matHalfDepth * 2 + 0.9, matMaterial);
    mat.rotation.x = -Math.PI / 2;

    const metal = this.surface(linear(0.03, 0.034, 0.032), KIND_PLAIN);
    const base = new Vector3(-8.6, 0, -6.4);
    const elbow = new Vector3(-7.3, 7.2, -5.8);
    const shadeBack = LAMP_HEAD.clone().addScaledVector(this.light.uLampDir.value, -1.1);
    this.cylinder(0.95, 1.05, 0.26, base.clone().setY(0.13), new Vector3(0, 1, 0), metal);
    this.rod(base.clone().setY(0.2), elbow, 0.1, metal);
    this.rod(elbow, shadeBack, 0.09, metal);
    this.cylinder(0.55, 1.5, 2.0, LAMP_HEAD, this.light.uLampDir.value.clone().negate(), metal, FrontSide, true);
    this.cylinder(0.55, 1.5, 2.0, LAMP_HEAD, this.light.uLampDir.value.clone().negate(), this.surface(linear(0.3, 0.26, 0.2), KIND_PLAIN, linear(0.9, 0.72, 0.5)), BackSide, true);
    const bulb = new Mesh(this.track(new SphereGeometry(0.42, 24, 16)), this.surface(linear(0, 0, 0), KIND_PLAIN, linear(7, 5.6, 4)));
    bulb.position.copy(LAMP_HEAD).addScaledVector(this.light.uLampDir.value, -0.2);
    this.scene.add(bulb);

    const shelf = this.surface(linear(0.04, 0.036, 0.03), KIND_PLAIN);
    this.box(13, 0.3, 2.2, -7, 8.6, ROOM.backZ + 1.1, shelf);
    const binders = [
      [0.9, 3.0, linear(0.05, 0.07, 0.066)],
      [0.8, 2.6, linear(0.09, 0.075, 0.05)],
      [1.1, 3.2, linear(0.035, 0.042, 0.05)],
      [0.7, 2.8, linear(0.07, 0.07, 0.066)],
      [1.0, 2.4, linear(0.06, 0.05, 0.04)],
      [0.8, 3.1, linear(0.04, 0.06, 0.055)],
    ] as const;
    let cursor = -12.6;
    for (const [width, tall, color] of binders) {
      this.box(width, tall, 1.9, cursor + width / 2, 8.75 + tall / 2, ROOM.backZ + 1.1, this.surface(color, KIND_PLAIN));
      cursor += width + 0.08;
    }
    this.box(6, 7.2, 3.2, 15, ROOM.floorY + 3.6, ROOM.backZ + 1.6, this.surface(linear(0.03, 0.033, 0.031), KIND_PLAIN));
    this.box(5.2, 3.8, 0.15, 7.5, 8.4, ROOM.backZ + 0.08, this.surface(linear(0.02, 0.02, 0.02), KIND_PLAIN));
    this.box(4.4, 3.0, 0.05, 7.5, 8.4, ROOM.backZ + 0.18, this.surface(linear(0.16, 0.15, 0.13), KIND_PLAIN));

    const strands = options.lowPower ? 24 : 44;
    const streamGeometry = this.track(ribbonGeometry(32));
    const p0 = new Float32Array(strands * 4);
    const p1 = new Float32Array(strands * 4);
    const p2 = new Float32Array(strands * 4);
    const random = options.random;
    for (let index = 0; index < strands; index += 1) {
      const sx = (random() - 0.5) * 22;
      p0.set([sx, 3 + 9 * random(), ROOM.windowZ + 22 + 26 * random(), random()], index * 4);
      p1.set([sx * 0.25 + (random() - 0.5) * 5, 4.4 + 2.4 * random(), ROOM.windowZ + 3, 0.45 + 0.35 * random()], index * 4);
      p2.set([(random() - 0.5) * 3, 3.6 + 1.6 * random(), 4 + 3 * random(), random()], index * 4);
    }
    streamGeometry.setAttribute("aP0", new InstancedBufferAttribute(p0, 4));
    streamGeometry.setAttribute("aP1", new InstancedBufferAttribute(p1, 4));
    streamGeometry.setAttribute("aP2", new InstancedBufferAttribute(p2, 4));
    streamGeometry.instanceCount = strands;
    this.stream = this.material({
      uniforms: {
        uEnd: { value: GLOW_POINT.clone() },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uWidth: { value: 2 },
        uTail: { value: 0.42 },
        uGain: { value: 0 },
      },
      vertexShader: STREAM_VERTEX,
      fragmentShader: STREAM_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const streamMesh = new Mesh(streamGeometry, this.stream);
    streamMesh.frustumCulled = false;
    streamMesh.renderOrder = 5;

    this.glow = this.material({
      uniforms: {
        uCenter: { value: GLOW_POINT.clone() },
        uViewport: { value: this.viewport },
        uSize: { value: 0 },
        uWorldSize: { value: 2.8 },
        uIntensity: { value: 0 },
        uColor: { value: linear(1.0, 0.76, 0.5) },
      },
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const glowGeometry = this.track(quadGeometry());
    glowGeometry.instanceCount = 1;
    const glowMesh = new Mesh(glowGeometry, this.glow);
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = 6;
    this.scene.add(streamMesh, glowMesh);
  }

  update(
    time: number,
    pose: CameraPose,
    width: number,
    height: number,
    pixelRatio: number,
  ): void {
    applyPose(this.camera, pose, width / Math.max(1, height));
    this.viewport.set((width * pixelRatio) / 2, (height * pixelRatio) / 2);
    const glow = envelope(time, 7.3, 7.7, 7.9, 8.95);
    this.light.uGlowPower.value = 2.2 * glow;
    this.glow.uniforms.uIntensity!.value = 1.1 * glow;
    this.stream.uniforms.uTime!.value = time;
    this.stream.uniforms.uWidth!.value = 2.2 * pixelRatio;
    this.stream.uniforms.uGain!.value = 1.3 * envelope(time, 7.3, 7.45, 7.95, 8.7);
    this.light.uLampPower.value = 10 * (0.85 + 0.15 * smoothstep(7.3, 8.4, time));
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }

  private surface(albedo: Color, kind: number, emissive?: Color): ShaderMaterial {
    return this.material({
      uniforms: {
        ...this.light,
        uAlbedo: { value: albedo },
        uEmissive: { value: emissive ?? new Color(0, 0, 0) },
        uKind: { value: kind },
      },
      vertexShader: ROOM_VERTEX,
      fragmentShader: ROOM_FRAGMENT,
    });
  }

  private plane(width: number, height: number, material: ShaderMaterial): Mesh {
    const mesh = new Mesh(this.track(new PlaneGeometry(width, height)), material);
    this.scene.add(mesh);
    return mesh;
  }

  private box(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: ShaderMaterial,
  ): Mesh {
    const mesh = new Mesh(this.track(new BoxGeometry(width, height, depth)), material);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    return mesh;
  }

  private cylinder(
    top: number,
    bottom: number,
    length: number,
    center: Vector3,
    axis: Vector3,
    material: ShaderMaterial,
    side: Side = FrontSide,
    open = false,
  ): Mesh {
    const geometry = this.track(new CylinderGeometry(top, bottom, length, 40, 1, open));
    const mesh = new Mesh(geometry, material);
    material.side = side;
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize()));
    mesh.position.copy(center);
    this.scene.add(mesh);
    return mesh;
  }

  private rod(from: Vector3, to: Vector3, radius: number, material: ShaderMaterial): Mesh {
    const axis = to.clone().sub(from);
    const length = axis.length();
    return this.cylinder(radius, radius, length, from.clone().addScaledVector(axis, 0.5), axis, material);
  }

  private track<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private material(
    parameters: ConstructorParameters<typeof ShaderMaterial>[0],
  ): ShaderMaterial {
    const material = new ShaderMaterial(parameters);
    this.materials.push(material);
    return material;
  }
}

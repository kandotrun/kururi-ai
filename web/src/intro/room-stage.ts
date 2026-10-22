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
  TorusGeometry,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import type { Random } from "../core/random";
import type { CameraPose } from "./camera-path";
import {
  GLOW_FRAGMENT,
  GLOW_VERTEX,
  STREAM_CARD_VERTEX,
  STREAM_FRAGMENT,
  STREAM_VERTEX,
} from "./city-shaders";
import { envelope, smoothstep } from "./easing";
import type { Vec3 } from "./geo-math";
import { CARD_FRAGMENT } from "./globe-shaders";
import {
  BEAM_FRAGMENT,
  BEAM_VERTEX,
  CITYVIEW_FRAGMENT,
  GLASS_FRAGMENT,
  MAT_FRAGMENT,
  ROOM_FRAGMENT,
  ROOM_VERTEX,
} from "./room-shaders";
import type { DeskView } from "./camera-path";
import { LAMP, PROPS, ROOM, type Prop, deskArrivalLighting } from "./room-plan";
import { applyPose, quadGeometry, ribbonGeometry } from "./stage-util";

export interface RoomStageOptions {
  lowPower: boolean;
  random: Random;
}

const KIND_PLAIN = 0;
const KIND_FLOOR = 1;
const KIND_WOOD = 2;
const KIND_PLASTER = 3;
const KIND_METAL = 4;
const KIND_PRINT = 5;

export const ROOM_TIMES = {
  streamStart: 7.8,
  streamSpread: 0.5,
  glowRise: 7.95,
  glowPeak: 8.55,
  glowHold: 8.8,
  glowEnd: 9.3,
  settleStart: 8.45,
  settleEnd: 9.25,
} as const;

function linear(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, LinearSRGBColorSpace);
}

function srgb(hex: string): Color {
  return new Color(hex);
}

function vec(point: Vec3): Vector3 {
  return new Vector3(point[0], point[1], point[2]);
}

export const GLOW_POINT = new Vector3(0, 2.6, -0.4);
const SATIN_LAMP = new Vector3(-1.0, 3.7, -0.8);

export class RoomStage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.08, 300);
  private readonly viewport = new Vector2(1, 1);
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly lampDirection = vec(LAMP.direction);
  private readonly light = {
    uLampPos: { value: vec(LAMP.head).addScaledVector(vec(LAMP.direction), 0.3) },
    uLampDir: { value: vec(LAMP.direction) },
    uLampColor: { value: linear(1.0, 0.8, 0.6) },
    uLampPower: { value: 3.3 },
    uLampCone: { value: new Vector2(Math.cos(0.8), Math.cos(0.34)) },
    uGlowPos: { value: GLOW_POINT.clone() },
    uGlowColor: { value: linear(1.0, 0.74, 0.46) },
    uGlowPower: { value: 0 },
    uSkyColor: { value: linear(0.03, 0.04, 0.05) },
    uBackWindow: {
      value: new Vector4(
        ROOM.backWindow.centerX,
        ROOM.backWindow.halfWidth,
        ROOM.backWindow.bottom,
        ROOM.backWindow.top,
      ),
    },
    uBackZ: { value: ROOM.backZ },
    uAmbient: { value: linear(0.0075, 0.009, 0.009) },
  };
  private readonly mat: ShaderMaterial;
  private readonly stream: ShaderMaterial;
  private readonly cards: ShaderMaterial;
  private readonly glow: ShaderMaterial;
  private readonly cityView: ShaderMaterial;
  private readonly beam: ShaderMaterial;

  constructor(options: RoomStageOptions) {
    this.buildShell();
    this.cityView = this.buildWindows();
    this.buildDesk();
    this.mat = this.buildMat();
    this.buildLamp();
    this.beam = this.buildBeam();
    for (const prop of PROPS) {
      this.buildProp(prop, options.random);
    }
    this.buildFurniture();
    const strands = options.lowPower ? 28 : 54;
    const { stream, cards } = this.buildStream(strands, options.random);
    this.stream = stream;
    this.cards = cards;
    this.glow = this.material({
      uniforms: {
        uCenter: { value: GLOW_POINT.clone() },
        uViewport: { value: this.viewport },
        uSize: { value: 0 },
        uWorldSize: { value: 1.1 },
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
    glowMesh.renderOrder = 7;
    this.scene.add(glowMesh);
  }

  setDeskView(view: DeskView): void {
    const lighting = deskArrivalLighting(view);
    const uniforms = this.mat.uniforms;
    uniforms.uPoolCenter!.value.set(lighting.lampCenter[0], lighting.lampCenter[1]);
    uniforms.uPoolRadius!.value = lighting.lampRadius;
    uniforms.uFogCenter!.value.set(lighting.fogCenter[0], lighting.fogCenter[1]);
    uniforms.uFogRange!.value.set(lighting.fogRange[0], lighting.fogRange[1]);
    uniforms.uSatinPos!.value.set(lighting.satin[0], lighting.satin[1], lighting.satin[2]);
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
    const glow = envelope(
      time,
      ROOM_TIMES.glowRise,
      ROOM_TIMES.glowPeak,
      ROOM_TIMES.glowHold,
      ROOM_TIMES.glowEnd,
    );
    this.light.uGlowPower.value = 1.1 * glow;
    this.glow.uniforms.uIntensity!.value = 0.5 * glow;
    const fade = 1 - smoothstep(ROOM_TIMES.glowHold, ROOM_TIMES.glowEnd, time);
    this.stream.uniforms.uTime!.value = time;
    this.stream.uniforms.uWidth!.value = 2.4 * pixelRatio;
    this.stream.uniforms.uGain!.value = 1.3 * fade;
    this.cards.uniforms.uTime!.value = time;
    this.cards.uniforms.uCardPixels!.value = 2.4 * pixelRatio;
    this.cards.uniforms.uCardMax!.value = 13 * pixelRatio * Math.min(1.2, Math.max(0.7, height / 900));
    this.cards.uniforms.uFade!.value = fade;
    const roomMix =
      1 - smoothstep(ROOM_TIMES.settleStart, ROOM_TIMES.settleEnd, time);
    this.mat.uniforms.uRoomMix!.value = roomMix;
    this.beam.uniforms.uIntensity!.value = 0.05 * roomMix;
    this.beam.uniforms.uTime!.value = time;
    this.cityView.uniforms.uTime!.value = time;
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }

  private buildShell(): void {
    const height = ROOM.ceilingY - ROOM.floorY;
    const depth = ROOM.entryZ - ROOM.backZ;
    const midZ = (ROOM.entryZ + ROOM.backZ) / 2;
    const midY = (ROOM.ceilingY + ROOM.floorY) / 2;
    const plaster = this.surface(linear(0.05, 0.064, 0.06), KIND_PLASTER);
    const floor = this.plane(
      ROOM.halfWidth * 2,
      depth,
      this.surface(linear(0.06, 0.04, 0.026), KIND_FLOOR),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, ROOM.floorY, midZ);
    const ceiling = this.plane(
      ROOM.halfWidth * 2,
      depth,
      this.surface(linear(0.07, 0.075, 0.072), KIND_PLASTER),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, ROOM.ceilingY, midZ);
    const left = this.plane(depth, height, plaster);
    left.rotation.y = Math.PI / 2;
    left.position.set(-ROOM.halfWidth, midY, midZ);
    const right = this.plane(depth, height, plaster);
    right.rotation.y = -Math.PI / 2;
    right.position.set(ROOM.halfWidth, midY, midZ);
    this.wallWithWindow(ROOM.backZ - ROOM.wallThickness / 2, ROOM.backWindow, plaster);
    this.wallWithWindow(ROOM.entryZ + ROOM.wallThickness / 2, ROOM.entryWindow, plaster);
    const skirting = this.surface(linear(0.02, 0.022, 0.021), KIND_PLAIN);
    this.box(ROOM.halfWidth * 2, 0.7, 0.2, 0, ROOM.floorY + 0.35, ROOM.backZ + 0.1, skirting);
    this.box(0.2, 0.7, depth, -ROOM.halfWidth + 0.1, ROOM.floorY + 0.35, midZ, skirting);
    this.box(0.2, 0.7, depth, ROOM.halfWidth - 0.1, ROOM.floorY + 0.35, midZ, skirting);
  }

  private wallWithWindow(
    z: number,
    opening: { centerX: number; halfWidth: number; bottom: number; top: number },
    material: ShaderMaterial,
  ): void {
    const thickness = ROOM.wallThickness;
    const left = opening.centerX - opening.halfWidth;
    const right = opening.centerX + opening.halfWidth;
    const leftWidth = left + ROOM.halfWidth;
    const rightWidth = ROOM.halfWidth - right;
    const height = ROOM.ceilingY - ROOM.floorY;
    const midY = (ROOM.ceilingY + ROOM.floorY) / 2;
    this.box(leftWidth, height, thickness, -ROOM.halfWidth + leftWidth / 2, midY, z, material);
    this.box(rightWidth, height, thickness, right + rightWidth / 2, midY, z, material);
    this.box(right - left, ROOM.ceilingY - opening.top, thickness, opening.centerX, (ROOM.ceilingY + opening.top) / 2, z, material);
    this.box(right - left, opening.bottom - ROOM.floorY, thickness, opening.centerX, (opening.bottom + ROOM.floorY) / 2, z, material);
  }

  private buildWindows(): ShaderMaterial {
    const frame = this.surface(linear(0.03, 0.032, 0.03), KIND_METAL);
    const sill = this.surface(linear(0.11, 0.1, 0.09), KIND_PLAIN);
    const back = ROOM.backWindow;
    const inner = ROOM.backZ + 0.08;
    const openHeight = back.top - back.bottom;
    const openMid = (back.top + back.bottom) / 2;
    this.box(back.halfWidth * 2 + 0.8, 0.3, 1.0, back.centerX, back.bottom - 0.1, ROOM.backZ + 0.3, sill);
    this.box(back.halfWidth * 2, 0.25, 0.3, back.centerX, back.top - 0.12, inner, frame);
    this.box(0.25, openHeight, 0.3, back.centerX - back.halfWidth + 0.12, openMid, inner, frame);
    this.box(0.25, openHeight, 0.3, back.centerX + back.halfWidth - 0.12, openMid, inner, frame);
    for (const offset of [-back.halfWidth / 3, back.halfWidth / 3]) {
      this.box(0.18, openHeight, 0.26, back.centerX + offset, openMid, inner, frame);
    }
    this.box(back.halfWidth * 2, 0.14, 0.24, back.centerX, back.bottom + openHeight * 0.68, inner, frame);
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
    const pane = this.plane(back.halfWidth * 2, openHeight, glass);
    pane.position.set(back.centerX, openMid, ROOM.backZ - 0.1);
    pane.renderOrder = 4;
    const cityView = this.material({
      uniforms: { uTime: { value: 0 }, uBrightness: { value: 1 } },
      vertexShader: ROOM_VERTEX,
      fragmentShader: CITYVIEW_FRAGMENT,
    });
    const view = this.plane(260, 140, cityView);
    view.position.set(0, 10, ROOM.backZ - 48);
    const entry = ROOM.entryWindow;
    const entryHeight = entry.top - entry.bottom;
    const entryMid = (entry.top + entry.bottom) / 2;
    const entryZ = ROOM.entryZ - 0.08;
    this.box(entry.halfWidth * 2 + 0.8, 0.3, 1.0, entry.centerX, entry.bottom - 0.1, ROOM.entryZ - 0.3, sill);
    this.box(entry.halfWidth * 2, 0.25, 0.3, entry.centerX, entry.top - 0.12, entryZ, frame);
    this.box(0.25, entryHeight, 0.3, entry.centerX - entry.halfWidth + 0.12, entryMid, entryZ, frame);
    this.box(0.25, entryHeight, 0.3, entry.centerX + entry.halfWidth - 0.12, entryMid, entryZ, frame);
    return cityView;
  }

  private buildDesk(): void {
    const desk = ROOM.desk;
    const width = desk.maxX - desk.minX;
    const depth = desk.maxZ - desk.minZ;
    const centerX = (desk.maxX + desk.minX) / 2;
    const centerZ = (desk.maxZ + desk.minZ) / 2;
    const wood = this.surface(linear(0.2, 0.105, 0.055), KIND_WOOD);
    this.box(width, desk.thickness, depth, centerX, desk.top - desk.thickness / 2, centerZ, wood);
    const apron = this.surface(linear(0.12, 0.065, 0.035), KIND_WOOD);
    const apronY = desk.top - desk.thickness - 0.6;
    this.box(width - 1.6, 1.2, 0.3, centerX, apronY, desk.maxZ - 0.8, apron);
    this.box(width - 1.6, 1.2, 0.3, centerX, apronY, desk.minZ + 0.8, apron);
    this.box(0.3, 1.2, depth - 1.6, desk.minX + 0.8, apronY, centerZ, apron);
    this.box(0.3, 1.2, depth - 1.6, desk.maxX - 0.8, apronY, centerZ, apron);
    const legHeight = desk.top - desk.thickness - ROOM.floorY;
    for (const x of [desk.minX + 0.9, desk.maxX - 0.9]) {
      for (const z of [desk.minZ + 0.9, desk.maxZ - 0.9]) {
        this.box(0.75, legHeight, 0.75, x, ROOM.floorY + legHeight / 2, z, apron);
      }
    }
  }

  private buildMat(): ShaderMaterial {
    const mat = ROOM.mat;
    const width = mat.maxX - mat.minX;
    const depth = mat.maxZ - mat.minZ;
    const centerX = (mat.maxX + mat.minX) / 2;
    const centerZ = (mat.maxZ + mat.minZ) / 2;
    const material = this.material({
      uniforms: {
        ...this.light,
        uMat: { value: srgb("#2B5A4A") },
        uLine: { value: srgb("#8DB8A6") },
        uCenter: { value: new Vector2(centerX, centerZ) },
        uHalf: { value: new Vector2(width / 2, depth / 2) },
        uMargin: { value: mat.margin },
        uRadius: { value: mat.radius },
        uPoolCenter: { value: new Vector2(0, 0) },
        uPoolRadius: { value: 9 },
        uPoolTint: { value: linear(1, 0.962, 0.895) },
        uMatAmbient: { value: 1 },
        uSatinPos: { value: SATIN_LAMP.clone() },
        uRoomMix: { value: 1 },
        uFogCenter: { value: new Vector2(0, 0) },
        uFogRange: { value: new Vector2(12, 30) },
        uMatDeep: { value: srgb("#173A30") },
      },
      vertexShader: ROOM_VERTEX,
      fragmentShader: MAT_FRAGMENT,
      transparent: true,
      blending: NormalBlending,
    });
    const mesh = this.plane(width, depth, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(centerX, 0, centerZ);
    mesh.renderOrder = 1;
    const edge = this.surface(linear(0.012, 0.03, 0.022), KIND_PLAIN);
    this.box(width - 0.2, 0.025, depth - 0.2, centerX, -0.014, centerZ, edge);
    return material;
  }

  private buildLamp(): void {
    const metal = this.surface(linear(0.035, 0.037, 0.036), KIND_METAL);
    const base = vec(LAMP.base);
    const elbow = vec(LAMP.elbow);
    const head = vec(LAMP.head);
    const direction = this.lampDirection;
    const shadeBack = head.clone().addScaledVector(direction, -1.2);
    this.cylinder(1.0, 1.15, 0.32, base.clone().setY(0.16), new Vector3(0, 1, 0), metal);
    this.sphere(0.24, base.clone().setY(0.45), metal);
    this.rod(base.clone().setY(0.45), elbow, 0.1, metal);
    const side = new Vector3().subVectors(elbow, base).cross(new Vector3(0, 1, 0)).normalize().multiplyScalar(0.28);
    this.rod(base.clone().setY(0.7).add(side), elbow.clone().add(side), 0.04, metal);
    this.sphere(0.22, elbow, metal);
    this.rod(elbow, shadeBack, 0.09, metal);
    this.rod(elbow.clone().add(side), shadeBack.clone().add(side), 0.035, metal);
    this.sphere(0.2, shadeBack, metal);
    const up = direction.clone().negate();
    this.cylinder(0.5, 1.45, 2.1, head, up, metal, FrontSide, true);
    this.cylinder(
      0.5,
      1.45,
      2.1,
      head,
      up,
      this.surface(linear(0.25, 0.2, 0.15), KIND_PLAIN, linear(1.5, 1.08, 0.66)),
      BackSide,
      true,
    );
    this.sphere(
      0.42,
      head.clone().addScaledVector(direction, 0.3),
      this.surface(linear(0, 0, 0), KIND_PLAIN, linear(9, 7, 4.6)),
    );
  }

  private buildBeam(): ShaderMaterial {
    const head = vec(LAMP.head).addScaledVector(this.lampDirection, 0.95);
    const length = head.length() * 0.9;
    const material = this.material({
      uniforms: {
        uApex: { value: head.clone() },
        uAxis: { value: this.lampDirection.clone() },
        uLength: { value: length },
        uColor: { value: linear(1.0, 0.78, 0.52) },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      side: DoubleSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = this.cylinder(
      1.35,
      6.2,
      length,
      head.clone().addScaledVector(this.lampDirection, length / 2),
      this.lampDirection.clone().negate(),
      material,
      DoubleSide,
      true,
    );
    mesh.renderOrder = 3;
    return material;
  }

  private buildProp(prop: Prop, random: Random): void {
    const [x, , z] = prop.position;
    if (prop.kind === "prints") {
      const paper = this.surface(linear(0.8, 0.78, 0.72), KIND_PRINT);
      for (let layer = 0; layer < 6; layer += 1) {
        const mesh = this.box(0.9, 0.028, 0.63, x + (random() - 0.5) * 0.12, 0.016 + layer * 0.03, z + (random() - 0.5) * 0.12, paper);
        mesh.rotation.y = prop.turn + (random() - 0.5) * 0.3;
      }
      return;
    }
    if (prop.kind === "loupe") {
      const body = this.surface(linear(0.02, 0.021, 0.021), KIND_METAL);
      this.cylinder(0.3, 0.4, 0.42, new Vector3(x, 0.21, z), new Vector3(0, 1, 0), body);
      const steel = this.surface(linear(0.45, 0.46, 0.45), KIND_METAL);
      const ring = new Mesh(this.track(new TorusGeometry(0.31, 0.045, 10, 36)), steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.43, z);
      this.scene.add(ring);
      const lens = this.cylinder(0.29, 0.29, 0.02, new Vector3(x, 0.43, z), new Vector3(0, 1, 0), this.surface(linear(0.05, 0.07, 0.075), KIND_METAL));
      lens.renderOrder = 1;
      return;
    }
    if (prop.kind === "mug") {
      const glaze = this.surface(linear(0.42, 0.4, 0.36), KIND_METAL);
      this.cylinder(0.42, 0.39, 0.8, new Vector3(x, 0.4, z), new Vector3(0, 1, 0), glaze);
      const handle = new Mesh(this.track(new TorusGeometry(0.22, 0.05, 8, 20)), glaze);
      handle.position.set(x + 0.46, 0.42, z);
      this.scene.add(handle);
      return;
    }
    const box = this.surface(linear(0.04, 0.05, 0.048), KIND_PLAIN);
    const mesh = this.box(3.0, 1.4, 2.1, x, 0.7, z, box);
    mesh.rotation.y = prop.turn;
    const lid = this.box(3.08, 0.3, 2.18, x, 1.3, z, this.surface(linear(0.05, 0.06, 0.058), KIND_PLAIN));
    lid.rotation.y = prop.turn;
  }

  private buildFurniture(): void {
    const wood = this.surface(linear(0.07, 0.045, 0.03), KIND_WOOD);
    const shelfX = ROOM.backWindow.centerX + ROOM.backWindow.halfWidth + 4.2;
    const shelfZ = ROOM.backZ + 1.4;
    const shelfHeight = 15;
    this.box(6.4, shelfHeight, 2.6, shelfX, ROOM.floorY + shelfHeight / 2, shelfZ, wood);
    const spines = [
      linear(0.06, 0.08, 0.075),
      linear(0.09, 0.07, 0.05),
      linear(0.035, 0.045, 0.06),
      linear(0.1, 0.095, 0.085),
      linear(0.05, 0.04, 0.035),
      linear(0.04, 0.065, 0.06),
    ];
    for (let row = 0; row < 4; row += 1) {
      const shelfY = ROOM.floorY + 1.2 + row * 3.4;
      this.box(5.8, 0.18, 2.4, shelfX, shelfY, shelfZ + 0.12, wood);
      let cursor = shelfX - 2.75;
      let index = row * 3;
      while (cursor < shelfX + 2.3) {
        const width = 0.35 + 0.35 * ((index * 37) % 7) / 7;
        const tall = 2.1 + 0.8 * ((index * 53) % 5) / 5;
        this.box(width, tall, 2.0, cursor + width / 2, shelfY + 0.09 + tall / 2, shelfZ + 0.2, this.surface(spines[index % spines.length]!, KIND_PLAIN));
        cursor += width + 0.05;
        index += 1;
      }
    }
    const frameX = ROOM.backWindow.centerX - ROOM.backWindow.halfWidth - 3.6;
    this.box(4.4, 5.6, 0.18, frameX, 6.8, ROOM.backZ + 0.1, this.surface(linear(0.02, 0.02, 0.02), KIND_METAL));
    const print = this.box(3.6, 4.8, 0.05, frameX, 6.8, ROOM.backZ + 0.22, this.surface(linear(0.6, 0.58, 0.54), KIND_PRINT));
    print.rotation.z = Math.PI / 2;
  }

  private buildStream(
    strands: number,
    random: Random,
  ): { stream: ShaderMaterial; cards: ShaderMaterial } {
    const p0 = new Float32Array(strands * 4);
    const p1 = new Float32Array(strands * 4);
    const p2 = new Float32Array(strands * 4);
    for (let index = 0; index < strands; index += 1) {
      const side = random() < 0.5 ? -1 : 1;
      const sx = side * (3 + 11 * random());
      const start = ROOM_TIMES.streamStart + ROOM_TIMES.streamSpread * Math.pow(random(), 1.2);
      p0.set([sx, 10.5 + 3 * random(), ROOM.entryZ + 2 + 8 * random(), start], index * 4);
      p1.set([sx * 0.7, 10 + 2.5 * random(), 6 + 4 * random(), 0.85 + 0.45 * random()], index * 4);
      p2.set([sx * 0.25 + (random() - 0.5) * 2, 4.4 + 2 * random(), 0.5 + 2.5 * random(), random()], index * 4);
    }
    const attach = (geometry: BufferGeometry & { instanceCount: number }) => {
      geometry.setAttribute("aP0", new InstancedBufferAttribute(p0, 4));
      geometry.setAttribute("aP1", new InstancedBufferAttribute(p1, 4));
      geometry.setAttribute("aP2", new InstancedBufferAttribute(p2, 4));
      geometry.instanceCount = strands;
    };
    const ribbon = this.track(ribbonGeometry(32));
    attach(ribbon);
    const stream = this.material({
      uniforms: {
        uEnd: { value: GLOW_POINT.clone() },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uWidth: { value: 2 },
        uTail: { value: 0.36 },
        uGain: { value: 0 },
      },
      vertexShader: STREAM_VERTEX,
      fragmentShader: STREAM_FRAGMENT,
      side: DoubleSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const streamMesh = new Mesh(ribbon, stream);
    streamMesh.frustumCulled = false;
    streamMesh.renderOrder = 5;
    const quad = this.track(quadGeometry());
    attach(quad);
    const cards = this.material({
      uniforms: {
        uEnd: { value: GLOW_POINT.clone() },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uCardPixels: { value: 2.4 },
        uCardWorld: { value: 0.3 },
        uCardMax: { value: 14 },
        uCardShare: { value: 0.65 },
        uFade: { value: 1 },
        uBrightness: { value: 1.25 },
      },
      vertexShader: STREAM_CARD_VERTEX,
      fragmentShader: CARD_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const cardMesh = new Mesh(quad, cards);
    cardMesh.frustumCulled = false;
    cardMesh.renderOrder = 6;
    this.scene.add(streamMesh, cardMesh);
    return { stream, cards };
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

  private sphere(radius: number, center: Vector3, material: ShaderMaterial): Mesh {
    const mesh = new Mesh(this.track(new SphereGeometry(radius, 20, 14)), material);
    mesh.position.copy(center);
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
    mesh.quaternion.copy(
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.clone().normalize()),
    );
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

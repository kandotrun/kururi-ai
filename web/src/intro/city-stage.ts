import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import type { Random } from "../core/random";
import type { CameraPose } from "./camera-path";
import {
  BUILDING_STRIDE,
  CORRIDOR,
  EXPRESSWAYS,
  HERO_WINDOW,
  STREETS,
  aviationBeacons,
  buildCity,
  sampleExpressway,
} from "./city-plan";
import {
  BEACON_FRAGMENT,
  BEACON_VERTEX,
  BUILDING_FRAGMENT,
  BUILDING_VERTEX,
  CITY_SKY_FRAGMENT,
  CITY_VERTEX,
  EXPRESSWAY_FRAGMENT,
  EXPRESSWAY_VERTEX,
  GLOW_FRAGMENT,
  GLOW_VERTEX,
  GROUND_FRAGMENT,
  STREAM_CARD_VERTEX,
  STREAM_FRAGMENT,
  STREAM_VERTEX,
} from "./city-shaders";
import { CARD_FRAGMENT } from "./globe-shaders";
import { envelope, smoothstep } from "./easing";
import { applyPose, quadGeometry, ribbonGeometry } from "./stage-util";

export interface CityStageOptions {
  lowPower: boolean;
  random: Random;
}

function linear(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, LinearSRGBColorSpace);
}

function expresswayGeometry(
  width: number,
  points: readonly { x: number; y: number; z: number }[],
): BufferGeometry {
  const count = points.length;
  const positions = new Float32Array(count * 2 * 3);
  const road = new Float32Array(count * 2 * 2);
  let along = 0;
  for (let index = 0; index < count; index += 1) {
    const point = points[index]!;
    const before = points[Math.max(0, index - 1)]!;
    const after = points[Math.min(count - 1, index + 1)]!;
    let dx = after.x - before.x;
    let dz = after.z - before.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    if (index > 0) {
      const previous = points[index - 1]!;
      along += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    }
    const nx = -dz * (width / 2);
    const nz = dx * (width / 2);
    positions.set([point.x + nx, point.y, point.z + nz, point.x - nx, point.y, point.z - nz], index * 6);
    road.set([along, 1, along, -1], index * 4);
  }
  const indices: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aRoad", new BufferAttribute(road, 2));
  geometry.setIndex(indices);
  return geometry;
}

export class CityStage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 1, 60000);
  readonly buildingCount: number;
  private readonly viewport = new Vector2(1, 1);
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly common = {
    uZenith: { value: linear(0.0021, 0.0052, 0.0064) },
    uHorizon: { value: linear(0.026, 0.035, 0.034) },
    uTwilight: { value: linear(0.05, 0.024, 0.01) },
    uFogDensity: { value: 1 / 6200 },
    uTime: { value: 0 },
  };
  private readonly sky: Mesh;
  private readonly ground: ShaderMaterial;
  private readonly buildings: ShaderMaterial;
  private readonly stream: ShaderMaterial;
  private readonly cards: ShaderMaterial;
  private readonly glow: ShaderMaterial;
  private readonly beacons: ShaderMaterial;

  constructor(options: CityStageOptions) {
    const skyMaterial = this.material({
      uniforms: { ...this.common },
      vertexShader: CITY_VERTEX,
      fragmentShader: CITY_SKY_FRAGMENT,
      side: BackSide,
      depthWrite: false,
    });
    this.sky = new Mesh(this.track(new SphereGeometry(25000, 48, 24)), skyMaterial);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;

    this.ground = this.material({
      uniforms: {
        ...this.common,
        uStreets: {
          value: new Vector4(
            STREETS.pitchX,
            STREETS.pitchZ,
            STREETS.originX,
            STREETS.originZ,
          ),
        },
        uStreetWidth: {
          value: new Vector3(
            STREETS.width,
            STREETS.avenueWidth,
            STREETS.avenueEvery,
          ),
        },
        uCorridor: {
          value: new Vector4(
            CORRIDOR.minX,
            CORRIDOR.maxX,
            CORRIDOR.minZ,
            CORRIDOR.maxZ,
          ),
        },
        uLightGain: { value: 1 },
      },
      vertexShader: CITY_VERTEX,
      fragmentShader: GROUND_FRAGMENT,
    });
    const groundGeometry = this.track(new PlaneGeometry(90000, 90000, 1, 1));
    groundGeometry.rotateX(-Math.PI / 2);
    const groundMesh = new Mesh(groundGeometry, this.ground);
    groundMesh.position.set(0, 0, -20000);
    groundMesh.frustumCulled = false;

    const layout = buildCity(options.random, {
      radius: options.lowPower ? 1500 : 2600,
      maxBuildings: options.lowPower ? 2600 : 9000,
    });
    this.buildingCount = layout.count;
    const box = this.track(new BoxGeometry(1, 1, 1));
    box.translate(0, 0.5, 0);
    this.buildings = this.material({
      uniforms: {
        ...this.common,
        uWindowCenter: {
          value: new Vector3(HERO_WINDOW.x, HERO_WINDOW.y, HERO_WINDOW.z),
        },
        uWindowSize: {
          value: new Vector2(HERO_WINDOW.width, HERO_WINDOW.height),
        },
        uHeroGlow: { value: 1.2 },
        uWindowGain: { value: 1.0 },
      },
      vertexShader: BUILDING_VERTEX,
      fragmentShader: BUILDING_FRAGMENT,
    });
    const buildingMesh = new InstancedMesh(box, this.buildings, layout.count);
    const styles = new Float32Array(layout.count * 4);
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    for (let index = 0; index < layout.count; index += 1) {
      const base = index * BUILDING_STRIDE;
      position.set(layout.data[base]!, 0, layout.data[base + 1]!);
      scale.set(
        layout.data[base + 2]!,
        layout.data[base + 4]!,
        layout.data[base + 3]!,
      );
      matrix.compose(position, rotation, scale);
      buildingMesh.setMatrixAt(index, matrix);
      styles[index * 4] = layout.data[base + 5]!;
      styles[index * 4 + 1] = layout.data[base + 6]!;
      styles[index * 4 + 2] = layout.data[base + 7]!;
      styles[index * 4 + 3] = layout.data[base + 4]!;
    }
    box.setAttribute("aStyle", new InstancedBufferAttribute(styles, 4));
    buildingMesh.instanceMatrix.needsUpdate = true;
    buildingMesh.frustumCulled = false;

    const strands = options.lowPower ? 60 : 110;
    const streamGeometry = this.track(ribbonGeometry(options.lowPower ? 32 : 48));
    const p0 = new Float32Array(strands * 4);
    const p1 = new Float32Array(strands * 4);
    const p2 = new Float32Array(strands * 4);
    const random = options.random;
    for (let index = 0; index < strands; index += 1) {
      const angle = random() * Math.PI * 2;
      const reach = 500 + 2200 * Math.sqrt(random());
      const sx = HERO_WINDOW.x + Math.cos(angle) * reach;
      const sz = HERO_WINDOW.z - 700 + Math.sin(angle) * reach * 0.9;
      const sy = 1500 + 1500 * random();
      p0.set([sx, sy, sz, 6.0 + 0.85 * Math.pow(random(), 1.2)], index * 4);
      p1.set(
        [
          sx + (HERO_WINDOW.x - sx) * 0.2,
          sy * (0.35 + 0.2 * random()),
          sz + (HERO_WINDOW.z + 500 - sz) * 0.3,
          0.8 + 0.5 * random(),
        ],
        index * 4,
      );
      p2.set(
        [
          HERO_WINDOW.x + (random() - 0.5) * 40,
          HERO_WINDOW.y + 25 + 70 * random(),
          HERO_WINDOW.z + 180 + 220 * random(),
          random(),
        ],
        index * 4,
      );
    }
    streamGeometry.setAttribute("aP0", new InstancedBufferAttribute(p0, 4));
    streamGeometry.setAttribute("aP1", new InstancedBufferAttribute(p1, 4));
    streamGeometry.setAttribute("aP2", new InstancedBufferAttribute(p2, 4));
    streamGeometry.instanceCount = strands;
    this.stream = this.material({
      uniforms: {
        uEnd: {
          value: new Vector3(HERO_WINDOW.x, HERO_WINDOW.y, HERO_WINDOW.z - 1.5),
        },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uWidth: { value: 2 },
        uTail: { value: 0.38 },
        uGain: { value: 0 },
      },
      vertexShader: STREAM_VERTEX,
      fragmentShader: STREAM_FRAGMENT,
      side: DoubleSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const streamMesh = new Mesh(streamGeometry, this.stream);
    streamMesh.frustumCulled = false;
    streamMesh.renderOrder = 5;

    const cardGeometry = this.track(quadGeometry());
    cardGeometry.setAttribute("aP0", new InstancedBufferAttribute(p0, 4));
    cardGeometry.setAttribute("aP1", new InstancedBufferAttribute(p1, 4));
    cardGeometry.setAttribute("aP2", new InstancedBufferAttribute(p2, 4));
    cardGeometry.instanceCount = strands;
    this.cards = this.material({
      uniforms: {
        uEnd: { value: this.stream.uniforms.uEnd!.value },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uCardPixels: { value: 2 },
        uCardWorld: { value: 1.4 },
        uCardMax: { value: 12 },
        uCardShare: { value: 0.5 },
        uFade: { value: 1 },
        uBrightness: { value: 1.3 },
      },
      vertexShader: STREAM_CARD_VERTEX,
      fragmentShader: CARD_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const cardMesh = new Mesh(cardGeometry, this.cards);
    cardMesh.frustumCulled = false;
    cardMesh.renderOrder = 6;

    const expressway = this.material({
      uniforms: { ...this.common },
      vertexShader: EXPRESSWAY_VERTEX,
      fragmentShader: EXPRESSWAY_FRAGMENT,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (const road of EXPRESSWAYS) {
      const mesh = new Mesh(this.track(expresswayGeometry(road.width, sampleExpressway(road, 360))), expressway);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }

    const beaconLayout = aviationBeacons(layout);
    const beaconGeometry = this.track(quadGeometry());
    beaconGeometry.setAttribute(
      "aBeacon",
      new InstancedBufferAttribute(
        beaconLayout.count > 0 ? beaconLayout.data : new Float32Array(4),
        4,
      ),
    );
    beaconGeometry.instanceCount = beaconLayout.count;
    this.beacons = this.material({
      uniforms: {
        uViewport: { value: this.viewport },
        uSize: { value: 3 },
        uTime: { value: 0 },
      },
      vertexShader: BEACON_VERTEX,
      fragmentShader: BEACON_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const beaconMesh = new Mesh(beaconGeometry, this.beacons);
    beaconMesh.frustumCulled = false;
    beaconMesh.renderOrder = 4;
    this.scene.add(cardMesh, beaconMesh);

    this.glow = this.material({
      uniforms: {
        uCenter: {
          value: new Vector3(HERO_WINDOW.x, HERO_WINDOW.y, HERO_WINDOW.z + 0.4),
        },
        uViewport: { value: this.viewport },
        uSize: { value: 6 },
        uWorldSize: { value: 3.2 },
        uIntensity: { value: 0 },
        uColor: { value: linear(1.0, 0.74, 0.46) },
      },
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const glowGeometry = this.track(quadGeometry());
    glowGeometry.instanceCount = 1;
    const glowMesh = new Mesh(glowGeometry, this.glow);
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = 6;

    this.scene.add(this.sky, groundMesh, buildingMesh, streamMesh, glowMesh);
  }

  update(
    time: number,
    pose: CameraPose,
    width: number,
    height: number,
    pixelRatio: number,
  ): void {
    applyPose(this.camera, pose, width / Math.max(1, height));
    this.sky.position.copy(this.camera.position);
    this.viewport.set((width * pixelRatio) / 2, (height * pixelRatio) / 2);
    this.common.uTime.value = time;
    this.stream.uniforms.uTime!.value = time;
    this.stream.uniforms.uWidth!.value = 2.1 * pixelRatio;
    const streamGain = envelope(time, 5.95, 6.4, 7.6, 7.88);
    this.stream.uniforms.uGain!.value = 1.4 * streamGain;
    this.cards.uniforms.uTime!.value = time;
    this.cards.uniforms.uFade!.value = streamGain;
    this.cards.uniforms.uCardPixels!.value = 1.6 * pixelRatio;
    this.cards.uniforms.uCardMax!.value = 11 * pixelRatio;
    this.beacons.uniforms.uTime!.value = time;
    this.beacons.uniforms.uSize!.value = 2.6 * pixelRatio;
    this.glow.uniforms.uIntensity!.value =
      (0.4 + 0.9 * smoothstep(6.8, 7.45, time)) *
      smoothstep(6.0, 6.5, time) *
      (1 - smoothstep(7.45, 7.72, time));
    this.glow.uniforms.uSize!.value = 7 * pixelRatio;
    this.buildings.uniforms.uHeroGlow!.value =
      1.5 + 0.7 * smoothstep(7.2, 7.8, time);
  }

  dispose(): void {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
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

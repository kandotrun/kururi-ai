import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  Color,
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
  HERO_WINDOW,
  STREETS,
  buildCity,
} from "./city-plan";
import {
  BUILDING_FRAGMENT,
  BUILDING_VERTEX,
  CITY_SKY_FRAGMENT,
  CITY_VERTEX,
  GLOW_FRAGMENT,
  GLOW_VERTEX,
  GROUND_FRAGMENT,
  STREAM_FRAGMENT,
  STREAM_VERTEX,
} from "./city-shaders";
import { envelope, smoothstep } from "./easing";
import { applyPose, quadGeometry, ribbonGeometry } from "./stage-util";

export interface CityStageOptions {
  lowPower: boolean;
  random: Random;
}

function linear(r: number, g: number, b: number): Color {
  return new Color().setRGB(r, g, b, LinearSRGBColorSpace);
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
    uFogDensity: { value: 1 / 8500 },
    uTime: { value: 0 },
  };
  private readonly sky: Mesh;
  private readonly ground: ShaderMaterial;
  private readonly buildings: ShaderMaterial;
  private readonly stream: ShaderMaterial;
  private readonly glow: ShaderMaterial;

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
        uHeroGlow: { value: 1.5 },
        uWindowGain: { value: 1.6 },
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

    const strands = options.lowPower ? 70 : 160;
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
      p0.set([sx, sy, sz, random()], index * 4);
      p1.set(
        [
          sx + (HERO_WINDOW.x - sx) * 0.2,
          sy * (0.35 + 0.2 * random()),
          sz + (HERO_WINDOW.z + 500 - sz) * 0.3,
          0.32 + 0.3 * random(),
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
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const streamMesh = new Mesh(streamGeometry, this.stream);
    streamMesh.frustumCulled = false;
    streamMesh.renderOrder = 5;

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
    this.stream.uniforms.uGain!.value =
      1.5 * envelope(time, 5.5, 6.05, 7.15, 7.42);
    this.glow.uniforms.uIntensity!.value =
      (0.5 + 1.6 * smoothstep(6.3, 7.3, time)) * smoothstep(5.5, 6.0, time);
    this.glow.uniforms.uSize!.value = 7 * pixelRatio;
    this.buildings.uniforms.uHeroGlow!.value =
      1.8 + 6 * smoothstep(6.9, 7.38, time);
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

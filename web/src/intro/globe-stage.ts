import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import type { GeoPoint } from "../contracts";
import type { Random } from "../core/random";
import type { CameraPose } from "./camera-path";
import { envelope, smoothstep } from "./easing";
import { latLonToVec3, subsolarForElevation } from "./geo-math";
import {
  ARC_FRAGMENT,
  ARC_VERTEX,
  ATMOSPHERE_FRAGMENT,
  ATMOSPHERE_VERTEX,
  BEACON_FRAGMENT,
  BEACON_VERTEX,
  CLOUD_FRAGMENT,
  EARTH_FRAGMENT,
  ORIGIN_FRAGMENT,
  ORIGIN_VERTEX,
  SKY_VERTEX,
  SPACE_FRAGMENT,
  SPHERE_VERTEX,
  STAR_FRAGMENT,
  STAR_VERTEX,
} from "./globe-shaders";
import { ARC_STRIDE, type ArcPlan, arrivedFraction } from "./origins";
import {
  applyPose,
  fullscreenTriangle,
  quadGeometry,
  ribbonGeometry,
} from "./stage-util";

export interface GlobeTextures {
  day: Texture;
  night: Texture;
  clouds: Texture;
  japanNight: Texture;
  japanDay: Texture;
}

export interface GlobeStageOptions {
  plan: ArcPlan;
  target: GeoPoint;
  lowPower: boolean;
  random: Random;
}

const DEG = Math.PI / 180;
const JAPAN_BOUNDS = new Vector4(128, 152, 26, 46);

function starGeometry(count: number, random: Random): BufferGeometry {
  const positions = new Float32Array(count * 3);
  const stars = new Float32Array(count * 4);
  const galactic = new Vector3(0.28, 0.86, -0.42).normalize();
  const direction = new Vector3();
  for (let index = 0; index < count; index += 1) {
    const u = random() * 2 - 1;
    const phi = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - u * u);
    direction.set(ring * Math.cos(phi), u, ring * Math.sin(phi));
    if (random() < 0.35) {
      direction.addScaledVector(galactic, -direction.dot(galactic) * (0.75 + 0.2 * random()));
      direction.normalize();
    }
    positions.set([direction.x, direction.y, direction.z], index * 3);
    stars.set(
      [Math.pow(random(), 7), random(), random(), 0],
      index * 4,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aStar", new BufferAttribute(stars, 4));
  return geometry;
}

export class GlobeStage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.01, 100);
  private readonly plan: ArcPlan;
  private readonly sunDir: Vector3;
  private readonly inverseViewProjection = new Matrix4();
  private readonly viewport = new Vector2(1, 1);
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly earth: ShaderMaterial;
  private readonly clouds: ShaderMaterial;
  private readonly atmosphere: ShaderMaterial;
  private readonly space: ShaderMaterial;
  private readonly stars: ShaderMaterial;
  private readonly arcs: ShaderMaterial;
  private readonly origins: ShaderMaterial;
  private readonly beacon: ShaderMaterial;
  private readonly arcMesh: Mesh;
  private readonly originMesh: Mesh;

  constructor(options: GlobeStageOptions) {
    this.plan = options.plan;
    const sun = subsolarForElevation(
      options.target,
      -7.5 * DEG,
      -23.2 * DEG,
      "evening",
    );
    const sunVector = latLonToVec3(sun);
    this.sunDir = new Vector3(sunVector[0], sunVector[1], sunVector[2]);
    const targetVector = latLonToVec3(options.target);
    const target = new Vector3(targetVector[0], targetVector[1], targetVector[2]);

    const spaceGeometry = this.track(fullscreenTriangle());
    this.space = this.material({
      uniforms: {
        uInverseViewProjection: { value: this.inverseViewProjection },
        uBrightness: { value: 1 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SPACE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const spaceMesh = new Mesh(spaceGeometry, this.space);
    spaceMesh.frustumCulled = false;
    spaceMesh.renderOrder = 0;

    const starCount = options.lowPower ? 1800 : 5200;
    this.stars = this.material({
      uniforms: { uPixelRatio: { value: 1 }, uBrightness: { value: 1 } },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const starPoints = new Points(
      this.track(starGeometry(starCount, options.random)),
      this.stars,
    );
    starPoints.frustumCulled = false;
    starPoints.renderOrder = 1;

    const segments = options.lowPower ? 128 : 256;
    this.earth = this.material({
      uniforms: {
        uDay: { value: null },
        uNight: { value: null },
        uClouds: { value: null },
        uJapanNight: { value: null },
        uJapanDay: { value: null },
        uSunDir: { value: this.sunDir },
        uCloudShift: { value: 0 },
        uJapanMix: { value: 0 },
        uLights: { value: 1.4 },
        uSun: { value: 1.9 },
        uJapanBounds: { value: JAPAN_BOUNDS },
      },
      vertexShader: SPHERE_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
    });
    const earthMesh = new Mesh(
      this.track(new SphereGeometry(1, segments, segments / 2)),
      this.earth,
    );
    earthMesh.renderOrder = 2;

    this.clouds = this.material({
      uniforms: {
        uClouds: { value: null },
        uNight: { value: null },
        uSunDir: { value: this.sunDir },
        uCloudShift: { value: 0 },
        uSun: { value: 1.9 },
        uOpacity: { value: 1 },
        uLights: { value: 1.4 },
      },
      vertexShader: SPHERE_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      blending: NormalBlending,
      depthWrite: false,
    });
    const cloudMesh = new Mesh(
      this.track(new SphereGeometry(1.0035, segments * 0.75, segments * 0.375)),
      this.clouds,
    );
    cloudMesh.renderOrder = 3;

    this.atmosphere = this.material({
      uniforms: {
        uSunDir: { value: this.sunDir },
        uSun: { value: 1.9 },
        uIntensity: { value: 5.5 },
        uAirglow: { value: 0.45 },
        uRadius: { value: 1.028 },
        uScale: { value: 0.0072 },
      },
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      side: BackSide,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const atmosphereMesh = new Mesh(
      this.track(new SphereGeometry(1.028, 128, 64)),
      this.atmosphere,
    );
    atmosphereMesh.renderOrder = 4;

    const interleaved = new InstancedInterleavedBuffer(
      this.plan.data.length > 0 ? this.plan.data : new Float32Array(ARC_STRIDE),
      ARC_STRIDE,
      1,
    );
    const originGeometry = this.track(quadGeometry());
    originGeometry.setAttribute("aA", new InterleavedBufferAttribute(interleaved, 4, 0));
    originGeometry.setAttribute("aB", new InterleavedBufferAttribute(interleaved, 4, 4));
    originGeometry.instanceCount = this.plan.count;
    this.origins = this.material({
      uniforms: {
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uSize: { value: 3 },
        uFade: { value: 1 },
      },
      vertexShader: ORIGIN_VERTEX,
      fragmentShader: ORIGIN_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.originMesh = new Mesh(originGeometry, this.origins);
    this.originMesh.frustumCulled = false;
    this.originMesh.renderOrder = 5;

    const arcGeometry = this.track(ribbonGeometry(options.lowPower ? 36 : 60));
    arcGeometry.setAttribute("aA", new InterleavedBufferAttribute(interleaved, 4, 0));
    arcGeometry.setAttribute("aB", new InterleavedBufferAttribute(interleaved, 4, 4));
    arcGeometry.instanceCount = this.plan.count;
    this.arcs = this.material({
      uniforms: {
        uTarget: { value: target },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uWidth: { value: 2 },
        uTail: { value: 0.42 },
        uGain: { value: Math.min(1, Math.max(0.32, 1100 / Math.max(1, this.plan.count))) * 2.2 },
        uFade: { value: 1 },
      },
      vertexShader: ARC_VERTEX,
      fragmentShader: ARC_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.arcMesh = new Mesh(arcGeometry, this.arcs);
    this.arcMesh.frustumCulled = false;
    this.arcMesh.renderOrder = 6;

    this.beacon = this.material({
      uniforms: {
        uCenter: { value: target.clone().multiplyScalar(1.0015) },
        uViewport: { value: this.viewport },
        uSize: { value: 20 },
        uIntensity: { value: 0 },
      },
      vertexShader: BEACON_VERTEX,
      fragmentShader: BEACON_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const beaconGeometry = this.track(quadGeometry());
    beaconGeometry.instanceCount = 1;
    const beaconMesh = new Mesh(beaconGeometry, this.beacon);
    beaconMesh.frustumCulled = false;
    beaconMesh.renderOrder = 7;

    this.scene.add(
      spaceMesh,
      starPoints,
      earthMesh,
      cloudMesh,
      atmosphereMesh,
      this.originMesh,
      this.arcMesh,
      beaconMesh,
    );
  }

  setTextures(textures: GlobeTextures): void {
    const earth = this.earth.uniforms;
    earth.uDay!.value = textures.day;
    earth.uNight!.value = textures.night;
    earth.uClouds!.value = textures.clouds;
    earth.uJapanNight!.value = textures.japanNight;
    earth.uJapanDay!.value = textures.japanDay;
    this.clouds.uniforms.uClouds!.value = textures.clouds;
    this.clouds.uniforms.uNight!.value = textures.night;
  }

  update(
    time: number,
    pose: CameraPose,
    width: number,
    height: number,
    pixelRatio: number,
  ): void {
    applyPose(this.camera, pose, width / Math.max(1, height));
    this.camera.updateMatrixWorld();
    this.inverseViewProjection.multiplyMatrices(
      this.camera.matrixWorld,
      this.camera.projectionMatrixInverse,
    );
    this.viewport.set((width * pixelRatio) / 2, (height * pixelRatio) / 2);
    const altitude =
      Math.hypot(pose.position[0], pose.position[1], pose.position[2]) - 1;
    const highAltitude = smoothstep(0.02, 0.6, altitude);
    this.space.uniforms.uBrightness!.value = 0.2 + 0.8 * highAltitude;
    this.stars.uniforms.uBrightness!.value = highAltitude;
    this.stars.uniforms.uPixelRatio!.value = pixelRatio;
    const shift = 0.0035 + time * 0.0014;
    this.earth.uniforms.uCloudShift!.value = shift;
    this.clouds.uniforms.uCloudShift!.value = shift;
    this.earth.uniforms.uJapanMix!.value = smoothstep(3.4, 4.7, time);
    const lights = 1.35 + 1.1 * smoothstep(3.8, 5.3, time);
    this.earth.uniforms.uLights!.value = lights;
    this.clouds.uniforms.uLights!.value = lights;
    this.clouds.uniforms.uOpacity!.value = 1 - 0.35 * smoothstep(4.6, 5.3, time);

    this.arcs.uniforms.uTime!.value = time;
    this.arcs.uniforms.uWidth!.value = 2.1 * pixelRatio;
    this.arcs.uniforms.uFade!.value = 1 - smoothstep(4.0, 4.6, time);
    this.arcMesh.visible = time > 1.0 && time < 4.6 && this.plan.count > 0;
    this.origins.uniforms.uTime!.value = time;
    this.origins.uniforms.uSize!.value = 3.1 * pixelRatio;
    this.origins.uniforms.uFade!.value = 1 - smoothstep(3.5, 4.4, time);
    this.originMesh.visible = time > 0.95 && time < 4.4 && this.plan.count > 0;

    const arrived = arrivedFraction(this.plan, time);
    const fallback = this.plan.count === 0 ? smoothstep(2.0, 3.2, time) : 0;
    const gathered = Math.max(arrived, fallback);
    const breathing = 1 + 0.06 * Math.sin(time * 9.0) * gathered;
    const dive = envelope(time, 3.3, 3.9, 4.6, 5.5);
    this.beacon.uniforms.uIntensity!.value =
      (0.12 * smoothstep(1.4, 2.2, time) + 1.5 * gathered) * breathing * (1 - 0.55 * dive) * (1 - smoothstep(4.9, 5.5, time));
    this.beacon.uniforms.uSize!.value = (16 + 26 * gathered) * pixelRatio;
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

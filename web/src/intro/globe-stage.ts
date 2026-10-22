import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  type InstancedBufferGeometry,
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
  CARD_FRAGMENT,
  CARD_VERTEX,
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
import { GATHER } from "./timeline";
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
const SUN_ELEVATION = -5 * DEG;
const SUN_DECLINATION = -11 * DEG;

export interface FlightAttributes {
  origin: Float32Array;
  timing: Float32Array;
}

export function splitFlights(plan: ArcPlan): FlightAttributes {
  const count = Math.max(1, plan.count);
  const origin = new Float32Array(count * 4);
  const timing = new Float32Array(count * 4);
  for (let index = 0; index < plan.count; index += 1) {
    const base = index * ARC_STRIDE;
    for (let lane = 0; lane < 4; lane += 1) {
      origin[index * 4 + lane] = plan.data[base + lane]!;
      timing[index * 4 + lane] = plan.data[base + 4 + lane]!;
    }
  }
  return { origin, timing };
}

export function arcGain(count: number): number {
  return 1.4 * Math.min(1, Math.max(0.3, 500 / Math.max(1, count)));
}

export function screenScale(width: number, height: number): number {
  return Math.min(1.25, Math.max(0.62, Math.sqrt((width * height) / (1440 * 900))));
}

function attachFlights(
  geometry: InstancedBufferGeometry,
  flights: FlightAttributes,
  count: number,
): void {
  geometry.setAttribute("aOrigin", new InstancedBufferAttribute(flights.origin, 4));
  geometry.setAttribute("aTiming", new InstancedBufferAttribute(flights.timing, 4));
  geometry.instanceCount = count;
}

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
  private readonly cards: ShaderMaterial;
  private readonly origins: ShaderMaterial;
  private readonly beacon: ShaderMaterial;
  private readonly arcMesh: Mesh;
  private readonly cardMesh: Mesh;
  private readonly originMesh: Mesh;

  constructor(options: GlobeStageOptions) {
    this.plan = options.plan;
    const sun = subsolarForElevation(
      options.target,
      SUN_ELEVATION,
      SUN_DECLINATION,
      "morning",
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
        uDetail: { value: 0 },
        uTargetLonLat: {
          value: new Vector2(options.target.lon, options.target.lat),
        },
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
        uAirglow: { value: 0.16 },
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

    const flights = splitFlights(this.plan);
    const originGeometry = this.track(quadGeometry());
    attachFlights(originGeometry, flights, this.plan.count);
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

    const arcGeometry = this.track(ribbonGeometry(options.lowPower ? 36 : 56));
    attachFlights(arcGeometry, flights, this.plan.count);
    this.arcs = this.material({
      uniforms: {
        uTarget: { value: target },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uWidth: { value: 2 },
        uTail: { value: 0.38 },
        uGain: { value: arcGain(this.plan.count) },
        uFade: { value: 1 },
      },
      vertexShader: ARC_VERTEX,
      fragmentShader: ARC_FRAGMENT,
      side: DoubleSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.arcMesh = new Mesh(arcGeometry, this.arcs);
    this.arcMesh.frustumCulled = false;
    this.arcMesh.renderOrder = 6;

    const cardGeometry = this.track(quadGeometry());
    attachFlights(cardGeometry, flights, this.plan.count);
    this.cards = this.material({
      uniforms: {
        uTarget: { value: target },
        uTime: { value: 0 },
        uViewport: { value: this.viewport },
        uCardSize: { value: 3 },
        uCardShare: { value: 0.3 },
        uFade: { value: 1 },
        uBrightness: { value: 1.5 },
      },
      vertexShader: CARD_VERTEX,
      fragmentShader: CARD_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.cardMesh = new Mesh(cardGeometry, this.cards);
    this.cardMesh.frustumCulled = false;
    this.cardMesh.renderOrder = 7;

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
    beaconMesh.renderOrder = 8;

    this.scene.add(
      spaceMesh,
      starPoints,
      earthMesh,
      cloudMesh,
      atmosphereMesh,
      this.originMesh,
      this.arcMesh,
      this.cardMesh,
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
    this.earth.uniforms.uJapanMix!.value = smoothstep(4.1, 5.2, time);
    const lights = 1.35 + 0.6 * smoothstep(4.4, 5.6, time);
    this.earth.uniforms.uLights!.value = lights;
    this.earth.uniforms.uDetail!.value = 1 - smoothstep(0.03, 0.3, altitude);
    this.clouds.uniforms.uLights!.value = lights;
    this.clouds.uniforms.uOpacity!.value = 1 - 0.35 * smoothstep(5.1, 5.8, time);

    const scale = screenScale(width, height);
    const flying = this.plan.count > 0 && time > GATHER.launchStart - 0.05 && time < GATHER.arrivalEnd + 0.7;
    const flightFade = 1 - smoothstep(GATHER.arrivalEnd, GATHER.arrivalEnd + 0.6, time);
    this.arcs.uniforms.uTime!.value = time;
    this.arcs.uniforms.uWidth!.value = 1.8 * scale * pixelRatio;
    this.arcs.uniforms.uFade!.value = flightFade;
    this.arcMesh.visible = flying;
    this.cards.uniforms.uTime!.value = time;
    this.cards.uniforms.uCardSize!.value = 3.0 * scale * pixelRatio;
    this.cards.uniforms.uFade!.value = flightFade;
    this.cardMesh.visible = flying;
    this.origins.uniforms.uTime!.value = time;
    this.origins.uniforms.uSize!.value = 2.2 * scale * pixelRatio;
    this.origins.uniforms.uFade!.value = 1 - smoothstep(GATHER.arrivalEnd - 0.3, GATHER.arrivalEnd + 0.5, time);
    this.originMesh.visible =
      this.plan.count > 0 && time > GATHER.lightStart - 0.05 && time < GATHER.arrivalEnd + 0.5;

    const arrived = arrivedFraction(this.plan, time);
    const rate = (arrived - arrivedFraction(this.plan, time - 0.25)) * 4;
    const fallback = this.plan.count === 0 ? smoothstep(2.2, 3.6, time) : 0;
    const gathered = Math.max(arrived, fallback);
    const pulse = 1 + 0.08 * Math.sin(time * 9.0) * gathered + 0.6 * Math.min(1, rate * 0.9);
    const dive = envelope(time, 3.9, 4.5, 5.2, 6.0);
    this.beacon.uniforms.uIntensity!.value =
      (0.1 * smoothstep(1.3, 2.2, time) + 1.6 * gathered) * pulse * (1 - 0.55 * dive) * (1 - smoothstep(5.4, 6.0, time));
    this.beacon.uniforms.uSize!.value = (14 + 26 * gathered) * scale * pixelRatio;
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

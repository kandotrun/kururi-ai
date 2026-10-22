import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  type Texture,
  type TextureDataType,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { FULLSCREEN_VERTEX, NOISE_GLSL, TONE_GLSL } from "./glsl";
import { fullscreenTriangle } from "./stage-util";

const PORTAL_GLSL = `
uniform float uPortal;
uniform vec4 uPortalA;
uniform vec4 uPortalB;
uniform vec2 uPortalSize;

float portalEdge(vec2 p, vec2 a, vec2 b) {
  vec2 d = (b - a) * uPortalSize;
  vec2 inward = normalize(vec2(-d.y, d.x) + 1e-6);
  return dot((p - a) * uPortalSize, inward);
}

float portalMask(vec2 uv) {
  if (uPortal <= 0.0) {
    return 0.0;
  }
  float inside = min(
    min(portalEdge(uv, uPortalA.xy, uPortalA.zw), portalEdge(uv, uPortalA.zw, uPortalB.xy)),
    min(portalEdge(uv, uPortalB.xy, uPortalB.zw), portalEdge(uv, uPortalB.zw, uPortalA.xy))
  );
  return uPortal * smoothstep(-0.75, 0.75, inside);
}

float weightB(vec2 uv, float base) {
  return min(1.0, base + portalMask(uv));
}
`;

const DOWN_FRAGMENT = `
uniform sampler2D uSource;
uniform sampler2D uSourceB;
uniform float uWeightA;
uniform float uWeightB;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

${PORTAL_GLSL}

vec3 fetchColor(vec2 uv) {
  vec3 color = texture(uSource, uv).rgb * uWeightA;
  float b = weightB(uv, uWeightB);
  if (b > 0.0) {
    color += texture(uSourceB, uv).rgb * b;
  }
  return color;
}

vec3 prefilter(vec3 color) {
  float brightness = max(color.r, max(color.g, color.b));
  if (!(brightness >= 0.0) || brightness > 60000.0) {
    return vec3(0.0);
  }
  float soft = clamp(brightness - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float weight = max(soft, brightness - uThreshold) / max(brightness, 1e-4);
  return color * weight / (1.0 + brightness * 0.08);
}

void main() {
  vec2 t = uTexel;
  vec3 a = fetchColor(vUv + t * vec2(-2.0, 2.0));
  vec3 b = fetchColor(vUv + t * vec2(0.0, 2.0));
  vec3 c = fetchColor(vUv + t * vec2(2.0, 2.0));
  vec3 d = fetchColor(vUv + t * vec2(-2.0, 0.0));
  vec3 e = fetchColor(vUv);
  vec3 f = fetchColor(vUv + t * vec2(2.0, 0.0));
  vec3 g = fetchColor(vUv + t * vec2(-2.0, -2.0));
  vec3 h = fetchColor(vUv + t * vec2(0.0, -2.0));
  vec3 i = fetchColor(vUv + t * vec2(2.0, -2.0));
  vec3 j = fetchColor(vUv + t * vec2(-1.0, 1.0));
  vec3 k = fetchColor(vUv + t * vec2(1.0, 1.0));
  vec3 l = fetchColor(vUv + t * vec2(-1.0, -1.0));
  vec3 m = fetchColor(vUv + t * vec2(1.0, -1.0));
  vec3 color = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) {
    color = prefilter(color);
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

const UP_FRAGMENT = `
uniform sampler2D uSource;
uniform sampler2D uBase;
uniform vec2 uTexel;
varying vec2 vUv;

void main() {
  vec2 t = uTexel;
  vec3 sum = texture(uSource, vUv + t * vec2(-1.0, 1.0)).rgb;
  sum += texture(uSource, vUv + t * vec2(0.0, 1.0)).rgb * 2.0;
  sum += texture(uSource, vUv + t * vec2(1.0, 1.0)).rgb;
  sum += texture(uSource, vUv + t * vec2(-1.0, 0.0)).rgb * 2.0;
  sum += texture(uSource, vUv).rgb * 4.0;
  sum += texture(uSource, vUv + t * vec2(1.0, 0.0)).rgb * 2.0;
  sum += texture(uSource, vUv + t * vec2(-1.0, -1.0)).rgb;
  sum += texture(uSource, vUv + t * vec2(0.0, -1.0)).rgb * 2.0;
  sum += texture(uSource, vUv + t * vec2(1.0, -1.0)).rgb;
  gl_FragColor = vec4(sum / 16.0 + texture(uBase, vUv).rgb, 1.0);
}
`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uBloom;
uniform sampler2D uHaze;
uniform float uWeightA;
uniform float uWeightB;
uniform float uBloomStrength;
uniform float uClouds;
uniform float uCloudTime;
uniform float uGlow;
uniform float uFade;
uniform float uIntro;
uniform float uExposure;
uniform float uVignette;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

${NOISE_GLSL}
${TONE_GLSL}
${PORTAL_GLSL}

vec3 cloudFog(vec2 uv, vec2 centred) {
  float below = smoothstep(0.95, 0.05, uv.y);
  float drift = fbm(centred * 1.7 + vec2(uCloudTime * 0.11, -uCloudTime * 0.07));
  vec3 fog = mix(vec3(0.040, 0.054, 0.061), vec3(0.074, 0.064, 0.052), below * 0.75);
  return fog * (0.78 + 0.44 * drift);
}

vec4 flyClouds(vec2 uv, vec3 glow) {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 centred = (uv - vec2(0.5, 0.46)) * vec2(aspect, 1.0);
  float below = smoothstep(0.95, 0.05, uv.y);
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 5; i++) {
    float layer = float(i);
    float z = fract(uCloudTime * 0.95 + layer * 0.2);
    float scale = mix(3.4, 0.22, z * z);
    vec2 q = centred * scale + vec2(layer * 3.7, layer * 1.9);
    float n = fbm(q * 1.5 + vec2(layer * 0.7, uCloudTime * 0.05));
    float shape = smoothstep(0.36, 0.74, n);
    float life = smoothstep(0.0, 0.3, z) * (1.0 - smoothstep(0.8, 1.0, z));
    float a = shape * life * 0.86;
    float thickness = smoothstep(0.46, 0.84, n);
    vec3 thin = vec3(0.052, 0.072, 0.082);
    vec3 thick = vec3(0.092, 0.084, 0.074) * (0.6 + 0.4 * below);
    vec3 tint = mix(thin, thick, thickness) * (0.82 + 0.3 * z) + glow * (0.25 + 0.55 * thickness);
    color += tint * a * (1.0 - alpha);
    alpha += a * (1.0 - alpha);
  }
  vec3 fog = cloudFog(uv, centred) + glow * 0.35;
  float cover = smoothstep(0.55, 0.92, uClouds);
  vec3 resolved = alpha > 1e-3 ? color / alpha : fog;
  vec3 mixed = mix(fog, resolved, alpha);
  return vec4(mixed, max(alpha * uClouds, cover * (0.9 + 0.1 * alpha)));
}

float vignette(vec2 fragCoord) {
  vec2 centred = fragCoord / max(uResolution, vec2(1.0)) - vec2(0.5, 0.46);
  centred.x *= uResolution.x / max(uResolution.y, 1.0);
  float reach = length(centred) / (0.5 * length(vec2(uResolution.x / max(uResolution.y, 1.0), 1.0)));
  return 1.0 - uVignette * smoothstep(0.35, 1.05, reach);
}

void main() {
  vec3 color = texture(uA, vUv).rgb * uWeightA;
  float b = weightB(vUv, uWeightB);
  if (b > 0.0) {
    color += texture(uB, vUv).rgb * b;
  }
  vec3 bloom = texture(uBloom, vUv).rgb;
  color += bloom * uBloomStrength;
  if (uClouds > 0.001) {
    vec3 glow = min(texture(uHaze, vUv).rgb * 0.7, vec3(0.5));
    vec4 clouds = flyClouds(vUv, glow);
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec3 haze = cloudFog(vUv, (vUv - vec2(0.5, 0.46)) * vec2(aspect, 1.0)) + glow * 0.8;
    color = mix(color, haze, 0.4 * smoothstep(0.0, 0.7, uClouds));
    color = mix(color, clouds.rgb, clouds.a);
  }
  if (uGlow > 0.001) {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float r = length((vUv - 0.5) * vec2(aspect, 1.0));
    float centre = 1.0 - smoothstep(0.0, 0.9, r);
    vec3 warm = vec3(1.0, 0.74, 0.48);
    color *= 1.0 + uGlow * (0.5 + 0.9 * centre) * warm;
    color += warm * uGlow * 0.035 * centre;
  }
  color *= uExposure * uIntro;
  color *= vignette(gl_FragCoord.xy);
  color = shoulder(max(color, 0.0));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  float dither = interleavedGradient(gl_FragCoord.xy + vec2(mod(uTime * 60.0, 64.0) * 5.588, 0.0)) - 0.5;
  vec3 rgb = gl_FragColor.rgb + dither / 255.0;
  gl_FragColor = vec4(rgb * uFade, uFade);
}
`;

export interface CompositeParams {
  weightA: number;
  weightB: number;
  clouds: number;
  cloudTime: number;
  glow: number;
  fade: number;
  intro: number;
  exposure: number;
  vignette: number;
  bloomStrength: number;
  bloomThreshold: number;
  time: number;
  portal: number;
  portalQuad: number[];
}

export function createCompositeParams(): CompositeParams {
  return {
    weightA: 1,
    weightB: 0,
    clouds: 0,
    cloudTime: 0,
    glow: 0,
    fade: 1,
    intro: 1,
    exposure: 1,
    vignette: 0.34,
    bloomStrength: 0.6,
    bloomThreshold: 0.9,
    time: 0,
    portal: 0,
    portalQuad: [0, 0, 1, 0, 1, 1, 0, 1],
  };
}

interface Level {
  down: WebGLRenderTarget;
  up: WebGLRenderTarget | null;
}

export interface PostOptions {
  halfFloat: boolean;
  samples: number;
  levels: number;
}

export class PostPipeline {
  readonly targetA: WebGLRenderTarget;
  readonly targetB: WebGLRenderTarget;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly down: ShaderMaterial;
  private readonly up: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly levels: Level[] = [];
  private readonly portalUniforms = {
    uPortal: { value: 0 },
    uPortalA: { value: new Vector4() },
    uPortalB: { value: new Vector4() },
    uPortalSize: { value: new Vector2(1, 1) },
  };
  private width = 1;
  private height = 1;

  constructor(renderer: WebGLRenderer, options: PostOptions) {
    this.renderer = renderer;
    const type: TextureDataType = options.halfFloat ? HalfFloatType : UnsignedByteType;
    const targetOptions = {
      type,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      generateMipmaps: false,
    };
    this.targetA = new WebGLRenderTarget(1, 1, {
      ...targetOptions,
      samples: options.samples,
    });
    this.targetB = new WebGLRenderTarget(1, 1, targetOptions);
    for (let index = 0; index < options.levels; index += 1) {
      const level = {
        type,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      };
      this.levels.push({
        down: new WebGLRenderTarget(1, 1, level),
        up: index < options.levels - 1 ? new WebGLRenderTarget(1, 1, level) : null,
      });
    }
    this.down = new ShaderMaterial({
      uniforms: {
        uSource: { value: null },
        uSourceB: { value: null },
        uWeightA: { value: 1 },
        uWeightB: { value: 0 },
        uTexel: { value: new Vector2() },
        uPrefilter: { value: 0 },
        uThreshold: { value: 0.9 },
        uKnee: { value: 0.5 },
        ...this.portalUniforms,
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: DOWN_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.up = new ShaderMaterial({
      uniforms: {
        uSource: { value: null },
        uBase: { value: null },
        uTexel: { value: new Vector2() },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: UP_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new ShaderMaterial({
      uniforms: {
        uA: { value: this.targetA.texture },
        uB: { value: this.targetB.texture },
        uBloom: { value: null },
        uHaze: { value: null },
        uWeightA: { value: 1 },
        uWeightB: { value: 0 },
        uBloomStrength: { value: 0.6 },
        uClouds: { value: 0 },
        uCloudTime: { value: 0 },
        uGlow: { value: 0 },
        uFade: { value: 1 },
        uIntro: { value: 1 },
        uExposure: { value: 1 },
        uVignette: { value: 0.34 },
        uTime: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
        ...this.portalUniforms,
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(fullscreenTriangle(), this.composite);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) {
      return;
    }
    this.width = w;
    this.height = h;
    this.targetA.setSize(w, h);
    this.targetB.setSize(w, h);
    let lw = w;
    let lh = h;
    for (const level of this.levels) {
      lw = Math.max(1, Math.ceil(lw / 2));
      lh = Math.max(1, Math.ceil(lh / 2));
      level.down.setSize(lw, lh);
      level.up?.setSize(lw, lh);
    }
    this.composite.uniforms.uResolution!.value.set(w, h);
    this.portalUniforms.uPortalSize.value.set(w, h);
  }

  materials(): ShaderMaterial[] {
    return [this.down, this.up, this.composite];
  }

  warmUp(): void {
    for (const material of this.materials()) {
      this.quad.material = material;
      this.renderer.compile(this.scene, this.camera);
    }
    this.quad.material = this.composite;
  }

  render(params: CompositeParams): void {
    const renderer = this.renderer;
    const portal = this.portalUniforms;
    const quad = params.portalQuad;
    portal.uPortal.value = params.portal;
    portal.uPortalA.value.set(quad[0]!, quad[1]!, quad[2]!, quad[3]!);
    portal.uPortalB.value.set(quad[4]!, quad[5]!, quad[6]!, quad[7]!);
    const bloom = this.bloom(params);
    const uniforms = this.composite.uniforms;
    uniforms.uBloom!.value = bloom;
    uniforms.uHaze!.value = bloom ? this.hazeTexture() : null;
    uniforms.uWeightA!.value = params.weightA;
    uniforms.uWeightB!.value = params.weightB;
    uniforms.uBloomStrength!.value = bloom ? params.bloomStrength : 0;
    uniforms.uClouds!.value = params.clouds;
    uniforms.uCloudTime!.value = params.cloudTime;
    uniforms.uGlow!.value = params.glow;
    uniforms.uFade!.value = params.fade;
    uniforms.uIntro!.value = params.intro;
    uniforms.uExposure!.value = params.exposure;
    uniforms.uVignette!.value = params.vignette;
    uniforms.uTime!.value = params.time;
    this.quad.material = this.composite;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.targetA.dispose();
    this.targetB.dispose();
    for (const level of this.levels) {
      level.down.dispose();
      level.up?.dispose();
    }
    this.down.dispose();
    this.up.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }

  private hazeTexture(): Texture {
    const index = Math.max(0, Math.min(2, this.levels.length - 2));
    const level = this.levels[index]!;
    return (level.up ?? level.down).texture;
  }

  private pass(material: ShaderMaterial, target: WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  private bloom(params: CompositeParams): Texture | null {
    if (this.levels.length === 0 || params.bloomStrength <= 0) {
      return null;
    }
    const down = this.down.uniforms;
    let source: Texture = this.targetA.texture;
    let sourceWidth = this.width;
    let sourceHeight = this.height;
    for (let index = 0; index < this.levels.length; index += 1) {
      const level = this.levels[index]!;
      down.uSource!.value = source;
      down.uSourceB!.value = index === 0 ? this.targetB.texture : null;
      down.uWeightA!.value = index === 0 ? params.weightA : 1;
      down.uWeightB!.value = index === 0 ? params.weightB : 0;
      down.uPrefilter!.value = index === 0 ? 1 : 0;
      down.uThreshold!.value = params.bloomThreshold;
      down.uTexel!.value.set(1 / sourceWidth, 1 / sourceHeight);
      this.pass(this.down, level.down);
      source = level.down.texture;
      sourceWidth = level.down.width;
      sourceHeight = level.down.height;
    }
    const up = this.up.uniforms;
    let current: WebGLRenderTarget = this.levels[this.levels.length - 1]!.down;
    for (let index = this.levels.length - 2; index >= 0; index -= 1) {
      const level = this.levels[index]!;
      const target = level.up!;
      up.uSource!.value = current.texture;
      up.uBase!.value = level.down.texture;
      up.uTexel!.value.set(1 / current.width, 1 / current.height);
      this.pass(this.up, target);
      current = target;
    }
    return current.texture;
  }
}

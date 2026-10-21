import {
  type CanvasTexture,
  NormalBlending,
  ShaderMaterial,
  type Texture,
  Vector2,
} from "three";
import { SHARED_FUNCTIONS_GLSL, SHARED_UNIFORMS_GLSL } from "./glsl";
import { linearColor } from "./palette";
import type { SharedUniforms, Uniform } from "./uniforms";

export interface PrintUniforms extends SharedUniforms {
  uHoverA: Uniform<number>;
  uHoverAAmount: Uniform<number>;
  uHoverB: Uniform<number>;
  uHoverBAmount: Uniform<number>;
  uFocusIndex: Uniform<number>;
  uFocusAmount: Uniform<number>;
  uMarkTex: Uniform<Texture>;
  uSoftbox: Uniform<Vector2>;
}

export function createPrintUniforms(
  shared: SharedUniforms,
  mark: CanvasTexture,
): PrintUniforms {
  return {
    ...shared,
    uHoverA: { value: -1 },
    uHoverAAmount: { value: 0 },
    uHoverB: { value: -1 },
    uHoverBAmount: { value: 0 },
    uFocusIndex: { value: -1 },
    uFocusAmount: { value: 0 },
    uMarkTex: { value: mark },
    uSoftbox: { value: new Vector2(3, 2) },
  };
}

const INSTANCE_ATTRIBUTES_GLSL = `
attribute vec4 aPose;
attribute vec4 aMotion;
attribute vec4 aShape;
attribute vec4 aAtlas;
attribute vec4 aMark;
attribute vec4 aTimes;
attribute vec4 aFlags;
`;

const PRINT_VERTEX = `
${SHARED_UNIFORMS_GLSL}
${INSTANCE_ATTRIBUTES_GLSL}
uniform float uPageBase;
uniform float uHoverA;
uniform float uHoverAAmount;
uniform float uHoverB;
uniform float uHoverBAmount;

varying vec2 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
flat varying vec4 vAtlas;
flat varying vec4 vMark;
flat varying vec4 vTimes;
flat varying vec4 vFlags;
flat varying vec4 vInfo;

vec3 orient(vec3 v, float yaw, float tiltX, float tiltZ) {
  float cy = cos(yaw);
  float sy = sin(yaw);
  v = vec3(cy * v.x + sy * v.z, v.y, -sy * v.x + cy * v.z);
  float cx = cos(tiltX);
  float sx = sin(tiltX);
  v = vec3(v.x, cx * v.y - sx * v.z, sx * v.y + cx * v.z);
  float cz = cos(tiltZ);
  float sz = sin(tiltZ);
  return vec3(cz * v.x - sz * v.y, sz * v.x + cz * v.y, v.z);
}

void main() {
  if (aMotion.z <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float index = uPageBase + float(gl_InstanceID);
  float hover = (abs(index - uHoverA) < 0.5 ? uHoverAAmount : 0.0)
    + (abs(index - uHoverB) < 0.5 ? uHoverBAmount : 0.0);
  vec2 size = aShape.xy * aMotion.z;
  vec2 local = position.xz;
  vec2 metric = local * size;
  float lift = max(0.0, aPose.y - aMotion.w - 0.0028);
  float longSide = max(size.x, size.y);
  float curl = aShape.z * (1.0 + min(lift, 0.6) * 3.0 + hover * 0.6);
  vec2 normalized = local * 2.0;
  float bend = curl * longSide * 0.5;
  float height = bend * dot(normalized, normalized);
  vec2 slope = bend * 4.0 * local / max(size, vec2(1e-4));
  vec3 surface = vec3(metric.x, height, metric.y);
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  float hoverTilt = hover * 0.05;
  vec3 offset = orient(surface * (1.0 + hover * 0.035), aPose.w, aMotion.x + hoverTilt, aMotion.y);
  vec3 world = aPose.xyz + offset + vec3(0.0, hover * 0.085, 0.0);
  vNormal = orient(normal, aPose.w, aMotion.x + hoverTilt, aMotion.y);
  vWorld = world;
  vLocal = local;
  vAtlas = aAtlas;
  vMark = aMark;
  vTimes = aTimes;
  vFlags = aFlags;
  vInfo = vec4(size, hover, index);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const PRINT_FRAGMENT = `
${SHARED_UNIFORMS_GLSL}
uniform sampler2D uAtlas;
uniform sampler2D uMarkTex;
uniform vec3 uPaper;
uniform vec3 uMarker;
uniform vec3 uScan;
uniform float uFocusIndex;
uniform float uFocusAmount;
uniform vec2 uSoftbox;

varying vec2 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
flat varying vec4 vAtlas;
flat varying vec4 vMark;
flat varying vec4 vTimes;
flat varying vec4 vFlags;
flat varying vec4 vInfo;

${SHARED_FUNCTIONS_GLSL}

vec2 sideFrame(vec2 m, float side) {
  if (side < 0.5) {
    return m;
  }
  if (side < 1.5) {
    return vec2(m.y, -m.x);
  }
  if (side < 2.5) {
    return -m;
  }
  return vec2(-m.y, m.x);
}

void main() {
  float visibility = 1.0;
  if (abs(vTimes.w) > 0.0) {
    float progress = clamp((uTime - vTimes.z) / abs(vTimes.w), 0.0, 1.0);
    visibility = vTimes.w > 0.0 ? progress : 1.0 - progress;
  }
  if (visibility < 0.999 && visibility <= ditherThreshold(gl_FragCoord.xy)) {
    discard;
  }

  vec2 size = vInfo.xy;
  vec2 halfSize = size * 0.5;
  vec2 m = vLocal * size;
  float border = 0.05 * min(size.x, size.y);
  vec2 inner = halfSize - border;
  vec2 edgeGap = halfSize - abs(m);
  float edgeDistance = min(edgeGap.x, edgeGap.y);
  vec2 photoGap = inner - abs(m);
  float photoDistance = min(photoGap.x, photoGap.y);
  float pixel = max(fwidth(photoDistance), 1e-5);
  float photoMask = smoothstep(-pixel * 0.5, pixel * 0.5, photoDistance);

  vec2 photoUv = clamp((m + inner) / max(2.0 * inner, vec2(1e-4)), 0.0, 1.0);
  float innerAspect = inner.x / max(inner.y, 1e-4);
  float imageAspect = max(vFlags.z, 1e-3);
  if (innerAspect > imageAspect) {
    photoUv.y = 0.5 + (photoUv.y - 0.5) * (imageAspect / innerAspect);
  } else {
    photoUv.x = 0.5 + (photoUv.x - 0.5) * (innerAspect / imageAspect);
  }
  vec2 cellUv = vFlags.x > 0.5 ? vec2(1.0 - photoUv.y, photoUv.x) : photoUv;
  vec2 atlasUv = mix(vAtlas.xy, vAtlas.zw, cellUv);
  vec3 photo = uTime < vFlags.y
    ? textureLod(uAtlas, atlasUv, 0.0).rgb
    : texture(uAtlas, atlasUv).rgb;

  float fibre = valueNoise(m * 220.0 + vInfo.w * 7.31) - 0.5;
  float fibreScale = clamp(1.0 - pixel * 260.0, 0.0, 1.0);
  vec3 paper = uPaper * (1.0 + fibre * 0.028 * fibreScale);
  paper *= 0.985 + 0.015 * smoothstep(0.0, border, edgeDistance);
  float edgeLine = 1.0 - smoothstep(0.0, max(0.0035, pixel * 1.5), edgeDistance);
  paper *= 1.0 - 0.1 * edgeLine;
  float emulsion = 1.0 - smoothstep(0.0, max(0.0012, pixel * 1.2), abs(photoDistance));
  photo *= 1.0 - 0.18 * emulsion * photoMask;
  vec3 albedo = mix(paper, photo, photoMask);

  float markAlpha = 0.0;
  if (vMark.x > -0.5) {
    vec2 q = sideFrame(m, vMark.x);
    vec2 halfSide = vMark.x > 0.5 && vMark.x < 1.5 || vMark.x > 2.5 ? halfSize.yx : halfSize;
    float glyph = border * 3.1;
    vec2 centre = vec2(vMark.w * halfSide.x * 0.5, -halfSide.y + border * 1.3);
    vec2 g = q - centre;
    float ct = cos(vMark.z);
    float st = sin(vMark.z);
    g = vec2(ct * g.x + st * g.y, -st * g.x + ct * g.y);
    vec2 guv = g / glyph + 0.5;
    vec4 ink = textureGrad(uMarkTex, clamp(guv, 0.0, 1.0), dFdx(guv), dFdy(guv));
    float inside = step(0.0, guv.x) * step(guv.x, 1.0) * step(0.0, guv.y) * step(guv.y, 1.0);
    float reveal = clamp((uTime - vMark.y) / 0.35, 0.0, 1.0);
    float sweep = guv.x * 0.78 + guv.y * 0.22;
    float written = smoothstep(sweep - 0.08, sweep + 0.02, reveal * 1.12 - 0.04);
    markAlpha = ink.a * inside * written;
    albedo = mix(albedo, uMarker * (0.86 + 0.24 * ink.r), markAlpha);
  }

  vec3 n = normalize(vNormal);
  vec3 toLamp = uLampPos - vWorld;
  vec3 l = normalize(toLamp);
  vec3 v = normalize(uCameraPos - vWorld);
  vec3 h = normalize(l + v);
  float ndl = max(dot(n, l), 0.0);
  float ndh = max(dot(n, h), 0.0);
  float ndv = max(dot(n, v), 0.0);
  vec3 lamp = lampLight(vWorld.xz);
  vec3 color = albedo * lamp * (0.74 + 0.3 * ndl);

  float gloss = mix(0.3, 1.0, photoMask) * (1.0 - markAlpha * 0.85);
  vec3 mirrored = reflect(-v, n);
  float travel = (uLampPos.y - vWorld.y) / max(mirrored.y, 0.05);
  vec2 hit = vWorld.xz + mirrored.xz * travel - uLampPos.xz;
  vec2 box = abs(hit) / max(uSoftbox, vec2(1e-3));
  float edge = clamp(max(fwidth(box.x), fwidth(box.y)) * 1.5, 0.04, 0.5);
  float softbox = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, box.x))
    * (1.0 - smoothstep(1.0 - edge, 1.0 + edge, box.y))
    * step(0.05, mirrored.y);
  softbox *= 0.7 + 0.3 * (1.0 - smoothstep(0.0, 1.0, box.y));
  float hotspot = pow(ndh, 260.0);
  float fresnel = pow(1.0 - ndv, 5.0);
  vec3 sheen = vec3(1.0, 0.975, 0.93) * (softbox * 0.12 + hotspot * 0.22) * gloss;
  vec3 reflection = mix(vec3(0.03, 0.05, 0.045), vec3(0.42, 0.44, 0.4), smoothstep(0.1, 0.9, mirrored.y));
  color += sheen + reflection * fresnel * 0.3 * gloss;

  float scanOn = 0.0;
  if (vTimes.x > 0.0) {
    scanOn = smoothstep(vTimes.x, vTimes.x + 0.08, uTime) * (1.0 - smoothstep(vTimes.y, vTimes.y + 0.3, uTime));
  }
  float leadWidth = max(0.012, fwidth(vLocal.y) * 1.2);
  if (scanOn > 0.001) {
    float phase = fract((uTime - vTimes.x) / 1.1);
    float front = mix(-0.58, 0.62, phase);
    float d = vLocal.y - front;
    float band = exp(-d * d / 0.02) * (1.0 - smoothstep(-0.02, 0.06, d));
    float lead = exp(-pow((d - 0.035) / leadWidth, 2.0));
    color = mix(color, color * vec3(1.05, 1.035, 0.98), scanOn * 0.6);
    color += uScan * (band * 0.24 + lead * 0.5) * scanOn;
  }

  float hover = vInfo.z;
  color = color * (1.0 + 0.1 * hover) + vec3(0.02, 0.018, 0.012) * hover;
  float focused = abs(vInfo.w - uFocusIndex) < 0.5 ? 1.0 : 0.0;
  float dim = uFocusAmount * (1.0 - focused);
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(grey) * 0.94, dim * 0.25) * (1.0 - 0.28 * dim);
  color += vec3(0.02, 0.018, 0.012) * focused * uFocusAmount;

  color = mix(color, uMatDeep, fogAmount(vWorld.xz));
  color *= vignette(gl_FragCoord.xy);
  gl_FragColor = vec4(shoulder(color), 1.0);
  #include <colorspace_fragment>
}
`;

const SHADOW_VERTEX = `
${SHARED_UNIFORMS_GLSL}
${INSTANCE_ATTRIBUTES_GLSL}

uniform float uPageBase;
uniform float uHoverA;
uniform float uHoverAAmount;
uniform float uHoverB;
uniform float uHoverBAmount;

varying vec2 vMetric;
flat varying vec4 vShadow;
flat varying vec4 vFade;

void main() {
  if (aMotion.z <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float index = uPageBase + float(gl_InstanceID);
  float hover = (abs(index - uHoverA) < 0.5 ? uHoverAAmount : 0.0)
    + (abs(index - uHoverB) < 0.5 ? uHoverBAmount : 0.0);
  vec2 size = aShape.xy * aMotion.z * (1.0 + hover * 0.035);
  float lift = max(0.0, aPose.y - aMotion.w - 0.0028) + hover * 0.085;
  float grow = 1.0 + 0.6 * lift;
  vec2 halfSize = size * 0.5 * grow * vec2(cos(aMotion.y), cos(aMotion.x));
  float blur = 0.014 + 0.17 * lift;
  vec2 quadHalf = halfSize + blur * 2.6 + 0.02;
  vec2 local = position.xz * 2.0 * quadHalf;
  float c = cos(aPose.w);
  float s = sin(aPose.w);
  vec2 rotated = vec2(c * local.x + s * local.y, -s * local.x + c * local.y);
  vec2 toLamp = uLampPos.xz - aPose.xz;
  float reach = length(toLamp);
  vec2 away = reach > 1e-4 ? -toLamp / reach : vec2(0.6, 0.8);
  float slope = reach / max(uLampPos.y - aPose.y, 0.5);
  vec2 offset = away * (0.012 + lift * (0.35 + 0.5 * slope));
  vec3 world = vec3(aPose.x + rotated.x + offset.x, aMotion.w, aPose.z + rotated.y + offset.y);
  vMetric = local;
  vShadow = vec4(halfSize, blur, lift);
  vFade = aTimes;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const SHADOW_FRAGMENT = `
${SHARED_UNIFORMS_GLSL}
uniform vec3 uShadowColor;
uniform float uShadowStrength;

varying vec2 vMetric;
flat varying vec4 vShadow;
flat varying vec4 vFade;

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  float visibility = 1.0;
  if (abs(vFade.w) > 0.0) {
    float progress = clamp((uTime - vFade.z) / abs(vFade.w), 0.0, 1.0);
    visibility = vFade.w > 0.0 ? progress : 1.0 - progress;
  }
  float lift = vShadow.w;
  float d = roundedBox(vMetric, vShadow.xy, 0.012);
  float soft = 1.0 - smoothstep(-vShadow.z, vShadow.z * 1.7, d);
  float contact = (1.0 - smoothstep(-0.004, 0.014, d)) * (1.0 - clamp(lift * 14.0, 0.0, 1.0));
  float alpha = (0.3 * soft + 0.24 * contact) / (1.0 + 2.0 * lift);
  gl_FragColor = vec4(uShadowColor, alpha * visibility * uShadowStrength);
  #include <colorspace_fragment>
}
`;

export function createPrintMaterial(
  uniforms: PrintUniforms,
  atlas: Texture,
  pageBase: number,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uAtlas: { value: atlas },
      uPageBase: { value: pageBase },
      uPaper: { value: linearColor("paper") },
      uMarker: { value: linearColor("marker") },
      uScan: { value: linearColor("scan") },
    },
    vertexShader: PRINT_VERTEX,
    fragmentShader: PRINT_FRAGMENT,
  });
}

export function createShadowMaterial(
  uniforms: PrintUniforms,
  pageBase: number,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uPageBase: { value: pageBase },
      uShadowColor: { value: linearColor("shadow") },
      uShadowStrength: { value: 1 },
    },
    vertexShader: SHADOW_VERTEX,
    fragmentShader: SHADOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: NormalBlending,
  });
}

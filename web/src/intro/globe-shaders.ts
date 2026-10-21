import { NOISE_GLSL } from "./glsl";

const SUN_GLSL = `
vec3 sunTint(float mu) {
  return mix(vec3(1.0, 0.34, 0.11), vec3(1.0, 0.96, 0.9), smoothstep(-0.02, 0.32, mu));
}

float cityLight(vec3 night) {
  return max(night.r * 0.7 + night.g * 0.55 - night.b * 0.5 - 0.004, 0.0);
}
`;

export const SPHERE_VERTEX = `
varying vec2 vUv;
varying vec3 vPos;

void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const EARTH_FRAGMENT = `
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform sampler2D uJapanNight;
uniform sampler2D uJapanDay;
uniform vec3 uSunDir;
uniform float uCloudShift;
uniform float uJapanMix;
uniform float uLights;
uniform float uSun;
uniform vec4 uJapanBounds;

varying vec2 vUv;
varying vec3 vPos;

${SUN_GLSL}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 n = normalize(vPos);
  vec3 v = normalize(cameraPosition - vPos);
  float mu = dot(n, uSunDir);
  vec3 day = texture(uDay, uv).rgb;
  vec3 night = texture(uNight, uv).rgb;
  float lon = uv.x * 360.0 - 180.0;
  float lat = 90.0 - uv.y * 180.0;
  vec2 jp = vec2((lon - uJapanBounds.x) / (uJapanBounds.y - uJapanBounds.x), (uJapanBounds.w - lat) / (uJapanBounds.w - uJapanBounds.z));
  float inside = smoothstep(0.0, 0.1, jp.x) * smoothstep(1.0, 0.9, jp.x) * smoothstep(0.0, 0.1, jp.y) * smoothstep(1.0, 0.9, jp.y);
  float japan = uJapanMix * inside;
  if (japan > 0.0) {
    vec2 juv = clamp(jp, 0.0, 1.0);
    night = mix(night, texture(uJapanNight, juv).rgb, japan);
    day = mix(day, texture(uJapanDay, juv).rgb, japan * 0.6);
  }
  float cloud = texture(uClouds, uv + vec2(uCloudShift, 0.0)).r;
  float cover = smoothstep(0.2, 0.85, cloud);

  float dayAmount = smoothstep(-0.05, 0.2, mu);
  vec3 sun = sunTint(mu) * uSun;
  float lambert = max(mu, 0.0);
  float twilight = 0.035 * smoothstep(-0.12, 0.02, mu) * (1.0 - smoothstep(0.02, 0.25, mu));
  vec3 surface = day * (sun * lambert + vec3(0.35, 0.42, 0.6) * twilight * uSun) * (1.0 - 0.4 * cover * dayAmount);

  float ocean = clamp((day.b - max(day.r, day.g) * 0.9) * 90.0, 0.0, 1.0) * (1.0 - smoothstep(0.015, 0.06, dot(day, vec3(0.3, 0.55, 0.15))));
  vec3 h = normalize(uSunDir + v);
  float nh = max(dot(n, h), 0.0);
  float nv = max(dot(n, v), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  float glint = pow(nh, 140.0) * 0.55 + pow(nh, 22.0) * 0.07;
  surface += ocean * (1.0 - cover) * glint * (0.35 + fresnel) * sun * smoothstep(0.0, 0.15, mu);

  float nightAmount = 1.0 - smoothstep(-0.18, 0.04, mu);
  float lights = cityLight(night);
  vec3 lightColor = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.8, 0.56), clamp(lights * 1.5, 0.0, 1.0));
  vec3 city = lightColor * (lights * 1.6 + lights * lights * 2.0) * uLights;
  float lum = dot(night, vec3(0.2126, 0.7152, 0.0722));
  vec3 moon = mix(vec3(lum), night, 0.4) * vec3(0.5, 0.82, 0.92) * 0.22;
  vec3 color = surface + (city + moon) * nightAmount;
  float limb = pow(1.0 - nv, 3.0);
  color *= 1.0 - 0.45 * limb * dayAmount;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const CLOUD_FRAGMENT = `
uniform sampler2D uClouds;
uniform sampler2D uNight;
uniform vec3 uSunDir;
uniform float uCloudShift;
uniform float uSun;
uniform float uOpacity;
uniform float uLights;

varying vec2 vUv;
varying vec3 vPos;

${SUN_GLSL}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float c = texture(uClouds, uv + vec2(uCloudShift, 0.0)).r;
  float alpha = smoothstep(0.2, 0.92, c) * 0.92 * uOpacity;
  if (alpha < 0.002) {
    discard;
  }
  vec3 n = normalize(vPos);
  vec3 v = normalize(cameraPosition - vPos);
  float mu = dot(n, uSunDir);
  vec3 sun = sunTint(mu) * uSun;
  float twilight = 0.04 * smoothstep(-0.1, 0.02, mu) * (1.0 - smoothstep(0.02, 0.25, mu));
  vec3 lit = vec3(0.82, 0.84, 0.86) * (sun * max(mu, 0.0) + vec3(0.4, 0.45, 0.6) * twilight * uSun);
  float nightAmount = 1.0 - smoothstep(-0.18, 0.04, mu);
  float glow = cityLight(textureLod(uNight, uv, 4.5).rgb);
  vec3 under = vec3(1.0, 0.6, 0.3) * glow * 0.8 * uLights * nightAmount;
  vec3 moon = vec3(0.016, 0.024, 0.028) * nightAmount;
  float nv = max(dot(n, v), 0.0);
  alpha *= mix(0.65, 1.0, smoothstep(0.0, 0.3, nv));
  gl_FragColor = vec4((lit + under + moon) * alpha, alpha);
}
`;

export const ATMOSPHERE_VERTEX = `
varying vec3 vPos;

void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ATMOSPHERE_FRAGMENT = `
uniform vec3 uSunDir;
uniform float uSun;
uniform float uIntensity;
uniform float uAirglow;
uniform float uRadius;
uniform float uScale;

varying vec3 vPos;

vec2 sphereHit(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) {
    return vec2(1e9, -1e9);
  }
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vPos - cameraPosition);
  vec2 shell = sphereHit(ro, rd, uRadius);
  if (shell.y <= 0.0) {
    discard;
  }
  float t0 = max(shell.x, 0.0);
  float t1 = shell.y;
  vec2 ground = sphereHit(ro, rd, 1.0);
  if (ground.x > 0.0 && ground.x < t1) {
    t1 = ground.x;
  }
  const int STEPS = 14;
  float seg = (t1 - t0) / float(STEPS);
  vec3 sum = vec3(0.0);
  vec3 mie = vec3(0.0);
  float optical = 0.0;
  float airglow = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 q = ro + rd * (t0 + seg * (float(i) + 0.5));
    float r = length(q);
    float h = max(r - 1.0, 0.0);
    float density = exp(-h / uScale) * seg;
    optical += density;
    float mu = dot(q / r, uSunDir);
    float lit = smoothstep(-0.2, 0.08, mu + h * 3.0);
    vec3 tint = mix(vec3(1.0, 0.36, 0.12), vec3(1.0), smoothstep(-0.03, 0.3, mu));
    vec3 transmit = exp(-optical * vec3(0.2, 0.45, 1.0) * 5.0);
    sum += density * lit * tint * transmit;
    mie += density * lit * tint * exp(-optical * 1.2);
    float band = (h - 0.0155) / 0.0022;
    airglow += exp(-band * band) * seg * (1.0 - smoothstep(-0.1, 0.1, mu));
  }
  float cosTheta = dot(rd, uSunDir);
  float phaseR = 0.75 * (1.0 + cosTheta * cosTheta);
  float g = 0.76;
  float phaseM = 0.06 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
  vec3 color = (sum * vec3(0.15, 0.36, 1.0) * phaseR + mie * phaseM) * uIntensity * uSun;
  color += vec3(0.22, 0.85, 0.52) * airglow * uAirglow;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const SKY_VERTEX = `
uniform mat4 uInverseViewProjection;
varying vec3 vDirection;

void main() {
  vec4 far = uInverseViewProjection * vec4(position.xy, 1.0, 1.0);
  vec4 near = uInverseViewProjection * vec4(position.xy, -1.0, 1.0);
  vDirection = far.xyz / far.w - near.xyz / near.w;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const SPACE_FRAGMENT = `
uniform float uBrightness;
varying vec3 vDirection;

${NOISE_GLSL}

void main() {
  vec3 dir = normalize(vDirection);
  vec3 galactic = normalize(vec3(0.28, 0.86, -0.42));
  float b = dot(dir, galactic);
  float dust = fbm3(dir * 6.0);
  float band = exp(-b * b / 0.018) * smoothstep(0.35, 0.75, dust) + exp(-b * b / 0.09) * 0.25;
  float lane = 1.0 - 0.65 * exp(-pow((b - 0.02) / 0.025, 2.0)) * smoothstep(0.4, 0.7, fbm3(dir * 11.0 + 4.0));
  vec3 milky = vec3(0.75, 0.86, 0.9) * band * lane * 0.0042;
  vec3 base = vec3(0.0009, 0.0018, 0.0024);
  gl_FragColor = vec4((base + milky) * uBrightness, 1.0);
}
`;

export const STAR_VERTEX = `
attribute vec4 aStar;
uniform float uPixelRatio;
varying vec3 vColor;

void main() {
  vec3 view = mat3(viewMatrix) * position;
  gl_Position = projectionMatrix * vec4(view, 1.0);
  float magnitude = aStar.x;
  gl_PointSize = (1.4 + 2.4 * magnitude) * uPixelRatio;
  float temperature = aStar.y;
  vec3 cool = vec3(0.7, 0.82, 1.0);
  vec3 warm = vec3(1.0, 0.86, 0.68);
  vColor = mix(cool, warm, temperature) * (0.08 + 1.4 * magnitude * magnitude);
}
`;

export const STAR_FRAGMENT = `
uniform float uBrightness;
varying vec3 vColor;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  float core = exp(-d2 * 5.0);
  gl_FragColor = vec4(vColor * core * uBrightness, 1.0);
}
`;

export const ARC_VERTEX = `
attribute float aS;
attribute float aSide;
attribute vec4 aA;
attribute vec4 aB;
uniform vec3 uTarget;
uniform float uTime;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uTail;

varying float vK;
varying float vSide;
varying float vHead;
varying float vSeed;

vec3 arcPoint(vec3 a, vec3 b, float angle, float s, float lift) {
  vec3 dir = angle < 1e-4 ? a : (sin((1.0 - s) * angle) * a + sin(s * angle) * b) / sin(angle);
  float rise = sin(3.14159265 * s);
  return dir * (1.0008 + lift * rise);
}

vec2 toScreen(vec4 clip) {
  return clip.xy / max(clip.w, 1e-6) * uViewport;
}

void main() {
  float progress = (uTime - aB.x) / aB.y;
  float p = clamp(progress, 0.0, 1.0);
  float eased = p * p * (3.0 - 2.0 * p);
  float head = eased * (1.0 + uTail);
  float from = clamp(head - uTail, 0.0, 1.0);
  float to = clamp(head, 0.0, 1.0);
  float visible = step(0.0, progress) * step(from + 1e-4, to);
  float s = mix(from, to, aS);
  vK = clamp((s - (head - uTail)) / uTail, 0.0, 1.0);
  vHead = head;
  vSide = aSide;
  vSeed = aB.w;
  float angle = acos(clamp(dot(aA.xyz, uTarget), -1.0, 1.0));
  float ds = max(0.002, (to - from) * 0.02);
  vec3 p0 = arcPoint(aA.xyz, uTarget, angle, s, aB.z);
  vec3 pa = arcPoint(aA.xyz, uTarget, angle, max(s - ds, 0.0), aB.z);
  vec3 pb = arcPoint(aA.xyz, uTarget, angle, min(s + ds, 1.0), aB.z);
  mat4 viewProjection = projectionMatrix * viewMatrix;
  vec4 c0 = viewProjection * vec4(p0, 1.0);
  vec2 tangent = toScreen(viewProjection * vec4(pb, 1.0)) - toScreen(viewProjection * vec4(pa, 1.0));
  float len = length(tangent);
  vec2 dir = len > 1e-6 ? tangent / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float width = uWidth * (0.7 + 0.8 * vK * vK);
  c0.xy += normal * aSide * 0.5 * width * c0.w / uViewport;
  gl_Position = visible > 0.5 && c0.w > 0.0 ? c0 : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const ARC_FRAGMENT = `
uniform float uGain;
uniform float uFade;

varying float vK;
varying float vSide;
varying float vHead;
varying float vSeed;

void main() {
  float k = clamp(vK, 0.0, 1.0);
  float side = clamp(vSide, -1.0, 1.0);
  float across = exp(-side * side * 4.0);
  float trail = k * k * sqrt(k);
  float headGlow = smoothstep(0.86, 1.0, k) * step(vHead, 1.0) * 1.8;
  vec3 tailColor = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.62, 0.3), clamp(vSeed, 0.0, 1.0));
  vec3 headColor = vec3(1.0, 0.9, 0.74);
  vec3 color = mix(tailColor, headColor, k * k) * (trail + headGlow) * across;
  gl_FragColor = vec4(color * uGain * uFade, 1.0);
}
`;

export const ORIGIN_VERTEX = `
attribute vec2 aCorner;
attribute vec4 aA;
attribute vec4 aB;
uniform float uTime;
uniform vec2 uViewport;
uniform float uSize;
uniform float uFade;

varying vec2 vCorner;
varying float vIntensity;

void main() {
  float since = uTime - aA.w;
  float on = smoothstep(0.0, 0.14, since);
  float flare = on * exp(-max(since, 0.0) * 5.0) * 2.2;
  float launch = smoothstep(aB.x - 0.04, aB.x + 0.06, uTime) * exp(-max(uTime - aB.x, 0.0) * 4.0) * 1.2;
  float ember = on * (0.5 - 0.3 * smoothstep(aB.x, aB.x + aB.y, uTime));
  vIntensity = (ember + flare + launch) * uFade;
  vCorner = aCorner;
  vec3 p = aA.xyz * 1.0012;
  p += normalize(cameraPosition - p) * 0.006;
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float size = uSize * (1.0 + flare * 0.5);
  clip.xy += aCorner * size * clip.w / uViewport;
  gl_Position = vIntensity > 0.002 ? clip : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const ORIGIN_FRAGMENT = `
varying vec2 vCorner;
varying float vIntensity;

void main() {
  float d2 = dot(vCorner, vCorner);
  float core = exp(-d2 * 10.0);
  float halo = exp(-d2 * 3.0) * 0.22;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * (core + halo) * vIntensity, 1.0);
}
`;

export const BEACON_VERTEX = `
attribute vec2 aCorner;
uniform vec3 uCenter;
uniform vec2 uViewport;
uniform float uSize;

varying vec2 vCorner;

void main() {
  vCorner = aCorner;
  vec3 p = uCenter + normalize(cameraPosition - uCenter) * 0.01;
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  clip.xy += aCorner * uSize * clip.w / uViewport;
  gl_Position = clip;
}
`;

export const BEACON_FRAGMENT = `
uniform float uIntensity;
varying vec2 vCorner;

void main() {
  float d2 = dot(vCorner, vCorner);
  float core = exp(-d2 * 60.0) * 3.0;
  float inner = exp(-d2 * 14.0);
  float halo = exp(-d2 * 3.5) * 0.18;
  vec3 color = vec3(1.0, 0.86, 0.66) * core + vec3(1.0, 0.68, 0.36) * (inner + halo);
  gl_FragColor = vec4(color * uIntensity, 1.0);
}
`;

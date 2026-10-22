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
uniform float uDetail;
uniform vec2 uTargetLonLat;

varying vec2 vUv;
varying vec3 vPos;

${SUN_GLSL}
${NOISE_GLSL}

vec3 bicubic(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 p = uv * size - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size;
  vec2 h1 = (i + 1.5 + w3 / g1) / size;
  vec3 a = textureLod(tex, vec2(h0.x, h0.y), 0.0).rgb;
  vec3 b = textureLod(tex, vec2(h1.x, h0.y), 0.0).rgb;
  vec3 c = textureLod(tex, vec2(h0.x, h1.y), 0.0).rgb;
  vec3 d = textureLod(tex, vec2(h1.x, h1.y), 0.0).rgb;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

float glint(float px) {
  return exp(-px * px / 0.7);
}

float roadFamily(vec2 p, float spacing, float pitch, float run, float pixelKm, float occupancy, float seed) {
  float spacingPx = spacing / pixelKm;
  float pitchPx = pitch / pixelKm;
  float rowF = p.y / spacing;
  float row = floor(rowF + 0.5);
  float lineRes = smoothstep(1.5, 4.0, spacingPx);
  float dotRes = smoothstep(1.5, 4.0, pitchPx);
  float segment = floor(p.x / (spacing * run) + hash12(vec2(row, seed)) * 7.0);
  float on = step(hash12(vec2(row * 1.37 + seed, segment)), occupancy);
  float across = glint((rowF - row) * spacingPx);
  float along = glint((fract(p.x / pitch + hash12(vec2(row, seed + 5.0))) - 0.5) * pitchPx);
  float pattern = mix(occupancy, on, lineRes) * mix(1.0, across, lineRes) * mix(1.0, along, dotRes);
  float mean = occupancy * mix(1.0, 1.48 / spacingPx, lineRes) * mix(1.0, 1.48 / pitchPx, dotRes);
  return pattern / max(mean, 1e-4);
}

float scatterLights(vec2 p, float cell, float pixelKm, float occupancy, float seed) {
  float cellPx = cell / pixelKm;
  float res = smoothstep(1.5, 4.0, cellPx);
  vec2 g = p / cell + seed;
  vec2 id = floor(g);
  float on = step(hash12(id + seed * 3.1), occupancy);
  vec2 jitter = vec2(hash12(id + 3.7), hash12(id + 11.3)) * 0.7 + 0.15;
  vec2 offsetPx = (fract(g) - jitter) * cellPx;
  float spot = exp(-dot(offsetPx, offsetPx) / 0.7);
  float pattern = mix(occupancy, on * spot, res);
  float mean = occupancy * mix(1.0, 2.2 / (cellPx * cellPx), res);
  return pattern / max(mean, 1e-4);
}

vec3 urbanLights(vec2 km, float energy, float pixelKm) {
  float occupancy = smoothstep(0.02, 0.9, energy);
  vec2 base = floor(km / 8.0);
  vec2 district = base;
  vec2 centre = (base + 0.5) * 8.0;
  float nearest = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = base + vec2(float(i), float(j));
      vec2 site = (id + 0.15 + 0.7 * vec2(hash12(id + 13.0), hash12(id + 29.0))) * 8.0;
      vec2 delta = km - site;
      float d = dot(delta, delta);
      if (d < nearest) {
        nearest = d;
        district = id;
        centre = site;
      }
    }
  }
  float angle = (hash12(district + 41.0) - 0.5) * 0.9;
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = km - centre;
  vec2 p = vec2(c * q.x - s * q.y, s * q.x + c * q.y) + hash12(district + 7.0) * 3.0;
  float park = smoothstep(0.3, 0.62, valueNoise(km / 1.9 + 9.0));
  float local = occupancy * mix(0.25, 1.0, park);
  float arterial = roadFamily(p, 1.35, 0.11, 6.0, pixelKm, local * 0.8, 1.0) + roadFamily(p.yx, 1.6, 0.11, 6.0, pixelKm, local * 0.8, 2.0);
  float street = roadFamily(p, 0.31, 0.055, 2.3, pixelKm, local * 0.45, 3.0) + roadFamily(p.yx, 0.27, 0.055, 2.3, pixelKm, local * 0.45, 4.0);
  float scatter = scatterLights(km, 0.42, pixelKm, local * 0.85, 5.0) + scatterLights(km, 0.13, pixelKm, local * 0.8, 6.0);
  float level = energy / (1.0 + 1.3 * energy);
  vec3 sodium = vec3(1.0, 0.6, 0.27);
  vec3 led = vec3(1.0, 0.88, 0.74);
  vec3 cool = vec3(0.82, 0.9, 1.0);
  vec3 lights = sodium * min(arterial * level * 0.15, 3.0);
  lights += mix(sodium, led, 0.6) * min(street * level * 0.09, 1.5);
  lights += mix(led, cool, 0.35) * min(scatter * level * 0.17, 2.6);
  return lights;
}

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
    vec3 japanNight = texture(uJapanNight, juv).rgb;
    if (uDetail > 0.001) {
      japanNight = mix(japanNight, bicubic(uJapanNight, juv), uDetail);
    }
    night = mix(night, japanNight, japan);
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
  if (uDetail > 0.001) {
    vec2 km = vec2((lon - uTargetLonLat.x) * 111.32 * cos(radians(lat)), (lat - uTargetLonLat.y) * 110.57);
    float pixelKm = max(length(fwidth(km)), 1e-5);
    float energy = lights * 1.6 + lights * lights * 2.0;
    vec3 grid = urbanLights(km, energy, pixelKm);
    vec3 skyglow = lightColor * energy / (1.0 + energy) * 0.05;
    city = mix(city, (grid * 0.82 + skyglow) * uLights, uDetail);
  }
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

export const CARD_PALETTE_GLSL = `
vec3 palette(float seed, float layer) {
  float pick = floor(fract(seed * 13.17 + layer * 0.37) * 6.0);
  if (layer < 0.5) {
    if (pick < 1.0) return vec3(0.42, 0.62, 0.86);
    if (pick < 2.0) return vec3(0.96, 0.62, 0.34);
    if (pick < 3.0) return vec3(0.58, 0.74, 0.86);
    if (pick < 4.0) return vec3(0.82, 0.86, 0.88);
    if (pick < 5.0) return vec3(0.3, 0.52, 0.8);
    return vec3(0.98, 0.78, 0.5);
  }
  if (pick < 1.0) return vec3(0.22, 0.42, 0.2);
  if (pick < 2.0) return vec3(0.36, 0.22, 0.14);
  if (pick < 3.0) return vec3(0.16, 0.34, 0.42);
  if (pick < 4.0) return vec3(0.62, 0.52, 0.36);
  if (pick < 5.0) return vec3(0.3, 0.3, 0.32);
  return vec3(0.46, 0.2, 0.16);
}
`;

const FLIGHT_GLSL = `
uniform vec3 uTarget;
uniform float uTime;
uniform vec2 uViewport;

vec3 arcPoint(vec3 a, vec3 b, float angle, float s, float lift, float fan) {
  vec3 dir = angle < 1e-4 ? a : (sin((1.0 - s) * angle) * a + sin(s * angle) * b) / sin(angle);
  float rise = sin(3.14159265 * s);
  vec3 side = cross(a, b);
  float sideLength = length(side);
  side = sideLength > 1e-5 ? side / sideLength : vec3(0.0);
  dir = normalize(dir + side * fan * rise * min(1.0, angle / 1.1));
  return dir * (1.0008 + lift * rise * (1.0 - 0.25 * s));
}

float fanOf(float seed) {
  float u = fract(seed * 5.37) * 2.0 - 1.0;
  return u * abs(u) * 0.24;
}

float flightHead(float progress) {
  float p = clamp(progress, 0.0, 1.0);
  return p * p * (3.0 - 2.0 * p);
}

vec2 toScreen(vec4 clip) {
  return clip.xy / max(clip.w, 1e-6) * uViewport;
}
`;

export const ARC_VERTEX = `
attribute float aS;
attribute float aSide;
attribute vec4 aOrigin;
attribute vec4 aTiming;
uniform float uWidth;
uniform float uTail;

varying float vK;
varying float vSide;
varying float vSeed;
varying float vLife;

${FLIGHT_GLSL}

void main() {
  float progress = (uTime - aTiming.x) / aTiming.y;
  float head = flightHead(progress) * (1.0 + uTail);
  float from = clamp(head - uTail, 0.0, 1.0);
  float to = clamp(head, 0.0, 1.0);
  float visible = step(0.0, progress) * step(from + 1e-4, to);
  float s = mix(from, to, aS);
  vK = clamp((s - (head - uTail)) / uTail, 0.0, 1.0);
  vSide = aSide;
  vSeed = aTiming.w;
  vLife = smoothstep(0.0, 0.06, progress);
  float angle = acos(clamp(dot(aOrigin.xyz, uTarget), -1.0, 1.0));
  float ds = max(0.002, (to - from) * 0.02);
  mat4 viewProjection = projectionMatrix * viewMatrix;
  float fan = fanOf(aTiming.w);
  vec4 c0 = viewProjection * vec4(arcPoint(aOrigin.xyz, uTarget, angle, s, aTiming.z, fan), 1.0);
  vec4 ca = viewProjection * vec4(arcPoint(aOrigin.xyz, uTarget, angle, max(s - ds, 0.0), aTiming.z, fan), 1.0);
  vec4 cb = viewProjection * vec4(arcPoint(aOrigin.xyz, uTarget, angle, min(s + ds, 1.0), aTiming.z, fan), 1.0);
  vec2 tangent = toScreen(cb) - toScreen(ca);
  float len = length(tangent);
  vec2 dir = len > 1e-6 ? tangent / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float width = uWidth * (0.55 + 0.9 * vK * vK);
  c0.xy += normal * aSide * 0.5 * width * c0.w / uViewport;
  gl_Position = visible > 0.5 && c0.w > 0.0 ? c0 : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const ARC_FRAGMENT = `
uniform float uGain;
uniform float uFade;

varying float vK;
varying float vSide;
varying float vSeed;
varying float vLife;

void main() {
  float k = clamp(vK, 0.0, 1.0);
  float side = clamp(vSide, -1.0, 1.0);
  float across = exp(-side * side * 3.0);
  float trail = k * sqrt(k) * (0.4 + 0.6 * k);
  vec3 tailColor = mix(vec3(1.0, 0.46, 0.16), vec3(1.0, 0.6, 0.28), vSeed);
  vec3 headColor = vec3(1.0, 0.86, 0.66);
  vec3 color = mix(tailColor, headColor, k * k * k) * trail * across;
  gl_FragColor = vec4(color * uGain * uFade * vLife, 1.0);
}
`;

export const CARD_VERTEX = `
attribute vec2 aCorner;
attribute vec4 aOrigin;
attribute vec4 aTiming;
uniform float uCardSize;
uniform float uCardShare;
uniform float uFade;

varying vec2 vLocal;
varying float vAlpha;
varying vec3 vSky;
varying vec3 vGround;
varying float vHorizon;
varying float vPixel;
varying float vCard;

${FLIGHT_GLSL}

const float HALO = 2.6;

${CARD_PALETTE_GLSL}
void main() {
  float progress = (uTime - aTiming.x) / aTiming.y;
  float alive = step(0.0, progress) * step(progress, 1.0);
  float s = min(flightHead(progress), 1.0);
  float angle = acos(clamp(dot(aOrigin.xyz, uTarget), -1.0, 1.0));
  mat4 viewProjection = projectionMatrix * viewMatrix;
  float fan = fanOf(aTiming.w);
  vec4 clip = viewProjection * vec4(arcPoint(aOrigin.xyz, uTarget, angle, s, aTiming.z, fan), 1.0);
  vec4 ca = viewProjection * vec4(arcPoint(aOrigin.xyz, uTarget, angle, max(s - 0.01, 0.0), aTiming.z, fan), 1.0);
  vec4 cb = viewProjection * vec4(arcPoint(aOrigin.xyz, uTarget, angle, min(s + 0.01, 1.0), aTiming.z, fan), 1.0);
  vec2 tangent = toScreen(cb) - toScreen(ca);
  float heading = length(tangent) > 1e-5 ? atan(tangent.y, tangent.x) : 0.0;
  float seed = aTiming.w;
  float wobble = sin(uTime * (3.0 + 4.0 * seed) + seed * 40.0) * 0.32;
  float turn = heading + (seed - 0.5) * 0.9 + wobble;
  vCard = step(fract(seed * 11.7), uCardShare);
  float size = uCardSize * mix(0.55, 0.8 + 0.5 * fract(seed * 7.31), vCard) * (1.0 - 0.6 * smoothstep(0.75, 1.0, progress));
  vec2 local = aCorner * HALO;
  vec2 offset = vec2(cos(turn) * local.x - sin(turn) * local.y, sin(turn) * local.x + cos(turn) * local.y) * size;
  clip.xy += offset * clip.w / uViewport;
  vLocal = local;
  vPixel = 1.0 / max(size, 0.5);
  vAlpha = smoothstep(0.0, 0.07, progress) * (1.0 - smoothstep(0.93, 1.0, progress)) * uFade;
  vSky = palette(seed, 0.0);
  vGround = palette(seed, 1.0);
  vHorizon = (fract(seed * 3.71) - 0.5) * 0.5;
  gl_Position = alive > 0.5 && clip.w > 0.0 && vAlpha > 0.002 ? clip : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const CARD_FRAGMENT = `
uniform float uBrightness;

varying vec2 vLocal;
varying float vAlpha;
varying vec3 vSky;
varying vec3 vGround;
varying float vHorizon;
varying float vPixel;
varying float vCard;

float roundBox(vec2 p, vec2 extent, float radius) {
  vec2 q = abs(p) - extent + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  vec2 p = vLocal;
  float aa = vPixel * 0.9;
  vec3 warm = vec3(1.0, 0.62, 0.3);
  if (vCard < 0.5) {
    float r = length(p);
    float core = exp(-r * r * 2.6) * 1.6;
    float halo = exp(-r * r * 0.5) * 0.14;
    gl_FragColor = vec4((vec3(1.0, 0.88, 0.7) * core + warm * halo) * vAlpha * uBrightness * 0.7, 1.0);
    return;
  }
  float edge = roundBox(p, vec2(1.0, 0.74), 0.08);
  float card = 1.0 - smoothstep(-aa, aa, edge);
  float window = 1.0 - smoothstep(-aa, aa, roundBox(p, vec2(0.72, 0.48), 0.02));
  vec3 picture = mix(vGround, vSky, smoothstep(-aa, aa, p.y - vHorizon));
  vec3 paper = vec3(1.0, 0.96, 0.88);
  vec3 face = mix(paper, picture * 0.9, window) * uBrightness;
  float outside = max(edge, 0.0);
  float glow = exp(-outside * outside * 3.5) * 0.22 + exp(-outside * 2.6) * 0.06;
  vec3 halo = warm * glow * (1.0 - card);
  gl_FragColor = vec4((face * card + halo) * vAlpha, 1.0);
}
`;

export const ORIGIN_VERTEX = `
attribute vec2 aCorner;
attribute vec4 aOrigin;
attribute vec4 aTiming;
uniform float uTime;
uniform vec2 uViewport;
uniform float uSize;
uniform float uFade;

varying vec2 vCorner;
varying float vIntensity;
varying float vRing;
varying float vRingAlpha;

const float SPAN = 3.6;

void main() {
  float since = uTime - aOrigin.w;
  float on = smoothstep(0.0, 0.1, since);
  float flare = on * exp(-max(since, 0.0) * 5.0) * 1.3;
  float launched = uTime - aTiming.x;
  float ping = step(0.0, launched) * exp(-max(launched, 0.0) * 6.0) * 1.2;
  float ember = on * (0.36 - 0.24 * smoothstep(0.0, aTiming.y, launched));
  vIntensity = (ember + flare + ping) * uFade;
  vRing = clamp(launched / 0.75, 0.0, 1.0);
  vRingAlpha = step(0.0, launched) * (1.0 - vRing) * (1.0 - vRing) * uFade;
  vCorner = aCorner * SPAN;
  vec3 p = aOrigin.xyz * 1.0012;
  p += normalize(cameraPosition - p) * 0.004;
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  clip.xy += aCorner * SPAN * uSize * clip.w / uViewport;
  gl_Position = vIntensity + vRingAlpha > 0.002 ? clip : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const ORIGIN_FRAGMENT = `
varying vec2 vCorner;
varying float vIntensity;
varying float vRing;
varying float vRingAlpha;

void main() {
  float r = length(vCorner);
  float core = exp(-r * r * 3.2);
  float halo = exp(-r * r * 0.6) * 0.05;
  float ringRadius = 0.6 + vRing * 2.8;
  float ring = exp(-pow((r - ringRadius) / 0.22, 2.0)) * vRingAlpha * 0.35;
  vec3 color = vec3(1.0, 0.74, 0.44) * (core + halo) * vIntensity + vec3(1.0, 0.82, 0.6) * ring;
  gl_FragColor = vec4(color, 1.0);
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

import { FILTER_GLSL, NOISE_GLSL } from "./glsl";
import { CARD_PALETTE_GLSL } from "./globe-shaders";

export const CITY_COMMON_GLSL = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uTwilight;
uniform float uFogDensity;
uniform float uTime;

vec3 skyColor(vec3 dir) {
  float e = dir.y;
  float up = pow(smoothstep(-0.02, 0.6, e), 0.5);
  vec3 color = mix(uHorizon, uZenith, up);
  float west = max(-dir.x * 0.9 + dir.z * 0.1, 0.0);
  color += uTwilight * west * west * exp(-max(e, 0.0) * 8.0);
  return color;
}

vec3 applyFog(vec3 color, vec3 world) {
  vec3 d = world - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float lowAir = exp(-max(min(world.y, cameraPosition.y), 0.0) / 900.0);
  float fog = 1.0 - exp(-dist * uFogDensity * (0.55 + 0.75 * lowAir));
  vec3 haze = skyColor(vec3(dir.x, max(dir.y, 0.0) * 0.25, dir.z)) + vec3(0.014, 0.0125, 0.011) * lowAir;
  return mix(color, haze, fog);
}

float district(vec2 p) {
  float value = 0.22 + 0.35 * valueNoise(p / 650.0 + vec2(11.0, 3.0));
  vec2 a = (p - vec2(-950.0, -1450.0)) / 520.0;
  vec2 b = (p - vec2(260.0, -520.0)) / 380.0;
  vec2 c = (p - vec2(1300.0, -900.0)) / 420.0;
  vec2 d = (p - vec2(-300.0, -2600.0)) / 700.0;
  value += exp(-dot(a, a)) + 0.75 * exp(-dot(b, b)) + 0.6 * exp(-dot(c, c)) + 0.55 * exp(-dot(d, d));
  value += 0.25 * valueNoise(p / 2600.0 + vec2(5.0, 9.0));
  return min(1.4, value);
}
`;

export const CITY_VERTEX = `
varying vec3 vWorld;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const CITY_SKY_FRAGMENT = `
${NOISE_GLSL}
${CITY_COMMON_GLSL}
varying vec3 vWorld;

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 color = skyColor(dir);
  vec2 grid = vec2(atan(dir.z, dir.x) * 180.0, dir.y * 260.0);
  vec2 cell = floor(grid);
  float star = step(0.985, hash12(cell)) * smoothstep(0.05, 0.4, dir.y);
  vec2 f = fract(grid) - 0.5;
  star *= exp(-dot(f, f) * 30.0) * hash12(cell + 7.0);
  color += vec3(0.6, 0.7, 0.8) * star * 0.05;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const GROUND_FRAGMENT = `
${NOISE_GLSL}
${FILTER_GLSL}
${CITY_COMMON_GLSL}
uniform vec4 uStreets;
uniform vec3 uStreetWidth;
uniform vec4 uCorridor;
uniform float uLightGain;

varying vec3 vWorld;

float shoreZ(float x) {
  return -1950.0 + 240.0 * sin(x * 0.0009 + 0.4) + 70.0 * sin(x * 0.004 + 1.1);
}

vec3 streetLight(float coord, float pitch, float origin, float along, float fwAcross, float fwAlong, float axis, out float road) {
  float g = (coord - origin) / pitch;
  float index = floor(g + 0.5);
  float d = (g - index) * pitch;
  float avenue = step(mod(index, uStreetWidth.z), 0.5);
  float halfWidth = mix(uStreetWidth.x, uStreetWidth.y, avenue) * 0.5;
  road = bandAA(d, halfWidth, fwAcross);
  float rows = bandAA(abs(d) - (halfWidth - 1.6), 0.5, fwAcross);
  float spacing = mix(27.0, 21.0, avenue);
  float phase = hash12(vec2(index, axis));
  float dots = filteredPulse(along / spacing + phase, 0.46, 0.54, fwAlong / spacing);
  float gain = mix(0.5, 1.0, avenue) * mix(0.55, 1.3, hash12(vec2(index, axis + 7.0)));
  vec3 color = mix(vec3(1.0, 0.58, 0.26), vec3(1.0, 0.84, 0.64), avenue);
  color = mix(color, vec3(0.8, 0.9, 1.0), step(0.8, hash12(vec2(index, axis + 3.0))) * (1.0 - avenue));
  float spill = exp(-pow(abs(d) / (halfWidth + 9.0), 2.0));
  vec3 light = color * gain * (rows * dots * 8.0 + spill * 0.08 + road * 0.025);
  float lane = bandAA(abs(d) - halfWidth * 0.42, 0.4, fwAcross) * avenue;
  float heading = d > 0.0 ? 1.0 : -1.0;
  float cars = filteredPulse((along + heading * uTime * 14.0) / 17.0 + index * 0.37, 0.0, 0.1, fwAlong / 17.0);
  vec3 carColor = d > 0.0 ? vec3(0.95, 0.97, 1.0) * 2.2 : vec3(1.0, 0.42, 0.14) * 1.3;
  light += lane * cars * carColor;
  return light;
}

vec3 blockLights(vec2 p, float footprint, float density) {
  float cell = 9.0;
  vec2 g = p / cell;
  vec2 id = floor(g);
  float probability = 0.05 + 0.1 * density;
  float on = step(1.0 - probability, hash12(id + 17.0));
  float spot = filteredPulse(g.x, 0.43, 0.57, footprint / cell) * filteredPulse(g.y, 0.43, 0.57, footprint / cell);
  float near = 1.0 - smoothstep(0.25, 0.75, footprint / cell);
  vec3 color = mix(vec3(1.0, 0.68, 0.38), vec3(0.85, 0.92, 1.0), step(0.62, hash12(id + 3.0)));
  float average = probability * 0.0196;
  return color * mix(average, on * spot, near) * 14.0;
}

void main() {
  vec2 p = vWorld.xz;
  float fwx = max(fwidth(p.x), 1e-3);
  float fwz = max(fwidth(p.y), 1e-3);
  float shore = shoreZ(p.x);
  float sea = smoothstep(3.0, -3.0, p.y - shore);
  float density = district(p);
  float roadX;
  float roadZ;
  vec3 lights = streetLight(p.x, uStreets.x, uStreets.z, p.y, fwx, fwz, 1.0, roadX);
  lights += streetLight(p.y, uStreets.y, uStreets.w, p.x, fwz, fwx, 2.0, roadZ);
  float road = max(roadX, roadZ);
  lights *= mix(0.3, 1.25, smoothstep(0.15, 0.95, density));
  float corridor = step(uCorridor.x, p.x) * step(p.x, uCorridor.y) * step(uCorridor.z, p.y) * step(p.y, uCorridor.w);
  lights += blockLights(p, max(fwx, fwz), density) * (1.0 - road) * (1.0 - 0.75 * corridor);
  vec3 ground = vec3(0.005, 0.0062, 0.0062) * (0.75 + 0.5 * valueNoise(p * 0.02));
  ground = mix(ground, vec3(0.004, 0.0075, 0.0055), corridor * (1.0 - road));
  ground += vec3(0.022, 0.015, 0.009) * road;
  vec3 land = ground + lights * uLightGain;
  vec3 view = normalize(vWorld - cameraPosition);
  vec3 reflected = reflect(view, vec3(0.0, 1.0, 0.0));
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(-view.y, 0.0), 5.0);
  vec3 water = skyColor(reflected) * fresnel + vec3(0.0015, 0.0032, 0.0038);
  float nearShore = exp(-max(shore - p.y, 0.0) / 160.0);
  float ripple = valueNoise(vec2(p.x * 0.05, p.y * 0.45 + uTime * 0.4));
  water += vec3(1.0, 0.68, 0.38) * nearShore * ripple * ripple * 0.08;
  float quay = exp(-pow((p.y - shore - 18.0) / 10.0, 2.0));
  float quayLights = filteredPulse(p.x / 24.0 + hash12(vec2(floor(p.x / 240.0), 2.0)), 0.45, 0.55, fwx / 24.0);
  land += vec3(1.0, 0.78, 0.5) * quay * (quayLights * 6.0 + 0.04);
  vec3 color = mix(land, water, sea);
  gl_FragColor = vec4(applyFog(color, vWorld), 1.0);
}
`;

export const BUILDING_VERTEX = `
attribute vec4 aStyle;
varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vNormalLocal;
varying vec3 vWorld;
varying vec4 vStyle;

void main() {
  vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vLocal = position;
  vNormalLocal = normal;
  vStyle = aStyle;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const BUILDING_FRAGMENT = `
${NOISE_GLSL}
${FILTER_GLSL}
${CITY_COMMON_GLSL}
uniform vec3 uWindowCenter;
uniform vec2 uWindowSize;
uniform float uWindowFrame;
uniform float uHeroGlow;
uniform float uWindowGain;
uniform float uPortal;

varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vNormalLocal;
varying vec3 vWorld;
varying vec4 vStyle;

vec3 reflectedCity(vec3 origin, vec3 r) {
  vec3 sky = skyColor(vec3(r.x, abs(r.y), r.z));
  float reach = 70.0 / max(abs(r.z) + abs(r.x), 0.2);
  vec2 q = origin.xy + vec2(r.x + r.z, r.y) * reach;
  vec2 g = q / vec2(3.4, 3.7);
  vec2 id = floor(g);
  vec2 f = fract(g);
  float pane = smoothstep(0.0, 0.3, f.x) * smoothstep(1.0, 0.7, f.x) * smoothstep(0.05, 0.35, f.y) * smoothstep(1.0, 0.7, f.y);
  float on = step(0.72, hash12(id + 17.0)) * smoothstep(-0.35, -0.15, r.y) * smoothstep(0.45, 0.25, r.y);
  vec3 tint = mix(vec3(1.0, 0.72, 0.44), vec3(0.8, 0.88, 1.0), step(0.5, hash12(id + 5.0)));
  float block = smoothstep(0.38, 0.62, valueNoise(q / 26.0));
  return sky * 2.2 + tint * pane * on * block * 0.5;
}

float span(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}

vec3 interior(vec2 cellFrac, vec3 ray, vec2 room, float depth, float seed, vec3 lamp, float office) {
  vec3 start = vec3(cellFrac * room, 0.0);
  float tx = ray.x > 0.0 ? (room.x - start.x) / ray.x : start.x / max(-ray.x, 1e-4);
  float ty = ray.y > 0.0 ? (room.y - start.y) / ray.y : start.y / max(-ray.y, 1e-4);
  float tz = depth / max(ray.z, 1e-4);
  float t = min(min(tx, ty), tz);
  vec3 h = start + ray * t;
  float height = h.y / room.y;
  vec3 color;
  if (t == tz) {
    float divider = step(0.55, hash12(vec2(seed, 41.0)));
    float door = (1.0 - smoothstep(0.02, 0.05, abs(h.x / room.x - 0.3 - 0.4 * hash12(vec2(seed, 9.0))) - 0.09)) * step(height, 0.62);
    color = vec3(0.26, 0.25, 0.23) * (0.5 + 0.5 * height) * (1.0 - 0.35 * divider * step(0.5, h.x / room.x));
    color *= 1.0 - 0.55 * door;
    color *= 1.0 - 0.5 * (1.0 - smoothstep(0.18, 0.22, height));
  } else if (t == ty && ray.y > 0.0) {
    float strip = filteredPulse(h.z / 1.7 + 0.25, 0.44, 0.56, 0.05) * filteredPulse(h.x / room.x, 0.12, 0.88, 0.05);
    color = vec3(0.12) + vec3(2.2) * strip * office;
  } else if (t == ty) {
    float desk = step(0.35, fract(h.z / 1.6 + seed)) * step(fract(h.z / 1.6 + seed), 0.75);
    color = vec3(0.07, 0.065, 0.06) * (0.6 + 0.4 * smoothstep(0.0, depth, h.z)) * (1.0 - 0.5 * desk);
  } else {
    color = vec3(0.18, 0.18, 0.17) * (0.55 + 0.45 * height);
  }
  float pool = exp(-pow((h.x / room.x - 0.5 + 0.3 * (seed - 0.5)) * 2.6, 2.0) - pow((height - 0.55) * 2.4, 2.0)) * (1.0 - office);
  color *= mix(1.0, 0.55 + 1.6 * pool, 1.0 - office);
  return color * lamp * (0.65 + 0.35 * smoothstep(depth, 0.0, h.z));
}

void main() {
  vec3 n = vNormalLocal;
  float style = vStyle.x;
  float seed = vStyle.y;
  float litRatio = vStyle.z;
  vec3 p = vLocal * vSize;
  vec3 color;
  if (n.y > 0.5) {
    float edge = min(min(p.x + vSize.x * 0.5, vSize.x * 0.5 - p.x), min(p.z + vSize.z * 0.5, vSize.z * 0.5 - p.z));
    float parapet = 1.0 - smoothstep(0.3, 0.9, edge);
    color = vec3(0.0055, 0.0065, 0.007) * (0.8 + 0.4 * hash12(vec2(seed, 5.0))) + vec3(0.004, 0.005, 0.005) * parapet;
    vec2 g = p.xz / 7.0;
    float unit = step(0.93, hash12(floor(g) + seed * 31.0));
    vec2 fw = fwidth(g);
    float spot = filteredPulse(g.x, 0.4, 0.6, fw.x) * filteredPulse(g.y, 0.4, 0.6, fw.y);
    color += vec3(0.8, 0.9, 1.0) * unit * spot * 0.25 * step(30.0, vSize.y);
  } else {
    bool sideX = abs(n.x) > 0.5;
    vec3 normal = sideX ? vec3(sign(n.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(n.z));
    vec3 tangent = sideX ? vec3(0.0, 0.0, sign(n.x)) : vec3(-sign(n.z), 0.0, 0.0);
    float u = sideX ? p.z * sign(n.x) : -p.x * sign(n.z);
    float v = p.y;
    float face = sideX ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
    float hero = step(2.5, style);
    float office = max(step(style, 0.5), hero);
    float warehouse = step(1.5, style) * (1.0 - hero);
    float floorHeight = mix(3.0, 3.7, office);
    float bay = mix(4.2, 3.2, office);
    float lobby = mix(3.0, 4.4, office);
    vec2 cell = vec2(u / bay + 0.5 * seed, (v - lobby) / floorHeight);
    vec2 id = floor(cell);
    vec2 fw = fwidth(cell);
    float x0 = mix(0.24, 0.07, office);
    float y0 = mix(0.32, 0.16, office);
    float y1 = mix(0.8, 0.9, office);
    float cover = filteredPulse(cell.x, x0, 1.0 - x0, fw.x) * filteredPulse(cell.y, y0, y1, fw.y);
    float storeys = smoothstep(-0.05, 0.05, cell.y) * (1.0 - smoothstep(vSize.y - 1.6, vSize.y - 1.0, v));
    cover *= storeys;
    cover *= 1.0 - warehouse * 0.7;
    float floorRandom = hash12(vec2(id.y, seed * 91.0 + face));
    float floorBias = office > 0.5 ? mix(0.1, 2.0, floorRandom * floorRandom) : mix(0.6, 1.35, floorRandom);
    float probability = clamp(litRatio * floorBias, 0.0, 1.0);
    float lit = step(hash13(vec3(id, seed * 57.0 + face)), probability);
    float tint = hash13(vec3(id.yx, seed * 13.0 + face));
    vec3 warm = vec3(1.0, 0.66, 0.36);
    vec3 neutral = vec3(1.0, 0.86, 0.68);
    vec3 cool = vec3(0.76, 0.87, 1.0);
    vec3 windowColor = office > 0.5 ? mix(neutral, cool, step(0.5, tint)) : mix(warm, neutral, step(0.72, tint));
    vec3 average = office > 0.5 ? mix(neutral, cool, 0.5) : mix(warm, neutral, 0.28);
    float shade = hash13(vec3(id, seed + 3.1));
    float bright = mix(0.28, 1.1, shade * shade);
    float footprint = max(fw.x, fw.y);
    float detail = 1.0 - smoothstep(0.3, 0.85, footprint);
    float close = 1.0 - smoothstep(0.05, 0.22, footprint);
    vec3 glass = vec3(0.005, 0.0075, 0.0095);
    vec3 near = windowColor * lit * bright;
    vec3 view = normalize(vWorld - cameraPosition);
    if (close > 0.001 && cover > 0.001) {
      vec3 ray = vec3(dot(view, tangent), view.y, -dot(view, normal));
      ray.z = max(ray.z, 0.05);
      vec2 room = vec2(bay, floorHeight);
      vec2 cellFrac = fract(cell);
      vec2 recess = ray.xy / ray.z * 0.16 / room;
      vec2 behind = cellFrac + recess;
      vec2 fwc = fw;
      float inGlass = span(behind.x, x0, 1.0 - x0, fwc.x) * span(behind.y, y0, y1, fwc.y);
      float mullion = office * bandAA(behind.x - 0.5, 0.012, fwc.x);
      float blindLevel = mix(y1, mix(y0, y1, 0.35), step(0.62, hash13(vec3(id, seed + 5.0))) * hash13(vec3(id, seed + 6.0)));
      float blind = smoothstep(blindLevel - fwc.y, blindLevel + fwc.y, behind.y);
      float slats = 0.75 + 0.25 * filteredPulse(behind.y * 34.0, 0.0, 0.55, fwc.y * 34.0);
      vec3 lamp = windowColor * lit * bright * 1.15;
      vec3 rooms = interior(behind, ray, room, mix(4.5, 3.4, 1.0 - office) + 1.5 * hash13(vec3(id, seed + 2.0)), hash13(vec3(id, seed + 7.0)), lamp, office);
      rooms += vec3(0.006, 0.007, 0.008) * (1.0 - lit);
      rooms = mix(rooms, lamp * vec3(0.26, 0.23, 0.19) * slats + vec3(0.01) * (1.0 - lit), blind);
      vec3 r = reflect(view, normal);
      float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(-dot(view, normal), 0.0, 1.0), 5.0);
      vec3 mirror = reflectedCity(vWorld, r) * fresnel;
      vec3 reveal = vec3(0.012, 0.013, 0.013) + lamp * 0.05;
      vec3 pane = mix(reveal, rooms * (1.0 - fresnel) + mirror, inGlass);
      pane = mix(pane, vec3(0.022, 0.024, 0.026) + mirror * 0.4, mullion);
      near = mix(near, pane, close);
      glass = mix(glass, vec3(0.0), close);
    }
    vec3 emission = mix(average * probability * 0.9, near, detail) * uWindowGain;
    vec3 wall = mix(vec3(0.010, 0.012, 0.013), vec3(0.015, 0.016, 0.015), hash12(vec2(seed, 2.0)));
    float spandrel = filteredPulse(cell.y, y1 + 0.02, 1.0 + y0 - 0.02, fw.y) * office;
    wall *= 1.0 - 0.25 * spandrel;
    float frameEdge = cover * (1.0 - filteredPulse(cell.x, x0 + 0.02, 0.98 - x0, fw.x) * filteredPulse(cell.y, y0 + 0.02, y1 - 0.02, fw.y)) * close;
    wall += vec3(0.05, 0.034, 0.02) * exp(-v / 10.0) * 0.5;
    color = mix(wall, glass + emission, cover);
    color = mix(color, vec3(0.03, 0.032, 0.034) + windowColor * lit * bright * 0.05, frameEdge);
    float lobbyGlow = (1.0 - smoothstep(lobby - 0.6, lobby, v)) * smoothstep(0.4, 0.9, v) * office;
    color += vec3(1.0, 0.82, 0.62) * lobbyGlow * 0.12 * step(0.35, hash12(vec2(seed, face)));
    if (hero > 0.5 && n.z > 0.5) {
      vec2 local = vec2(vWorld.x - uWindowCenter.x, vWorld.y - uWindowCenter.y);
      vec2 halfSize = uWindowSize * 0.5;
      vec2 glassHalf = halfSize - uWindowFrame;
      vec2 fwl = fwidth(local);
      float inside = (1.0 - smoothstep(halfSize.x - fwl.x, halfSize.x + fwl.x, abs(local.x))) * (1.0 - smoothstep(halfSize.y - fwl.y, halfSize.y + fwl.y, abs(local.y)));
      float pane = (1.0 - smoothstep(glassHalf.x - fwl.x, glassHalf.x + fwl.x, abs(local.x))) * (1.0 - smoothstep(glassHalf.y - fwl.y, glassHalf.y + fwl.y, abs(local.y)));
      vec2 lampOffset = (local - vec2(-0.35, 0.05)) * vec2(1.0, 1.3);
      float lampSpot = exp(-dot(lampOffset, lampOffset) * 5.0);
      float pool = exp(-pow((local.y + 0.42) / 0.28, 2.0)) * exp(-pow(local.x / 0.9, 2.0));
      float desk = 1.0 - 0.6 * smoothstep(-0.62, -0.7, local.y);
      vec3 roomGlow = vec3(1.0, 0.66, 0.38) * (0.14 + 0.12 * smoothstep(1.1, -0.6, local.y)) * desk + vec3(0.42, 0.66, 0.52) * pool * 0.3 + vec3(1.0, 0.8, 0.54) * lampSpot * 1.1;
      vec3 r = reflect(view, vec3(0.0, 0.0, 1.0));
      float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(-view.z, 0.0, 1.0), 5.0);
      vec3 mirror = reflectedCity(vWorld, r) * fresnel * 0.7;
      float sheen = smoothstep(0.6, 1.0, abs(local.x / glassHalf.x + 0.35 * local.y / glassHalf.y - 0.2)) * 0.012;
      vec3 heroGlass = roomGlow * uHeroGlow * (1.0 - uPortal) + mirror + vec3(0.9, 0.95, 1.0) * sheen;
      float sill = smoothstep(-glassHalf.y - uWindowFrame, -glassHalf.y, local.y) * (1.0 - step(-glassHalf.y, local.y));
      vec3 frame = vec3(0.028, 0.029, 0.031) + vec3(1.0, 0.7, 0.42) * sill * 0.12 * uHeroGlow;
      color = mix(color, mix(frame, heroGlass, pane), inside);
    }
  }
  gl_FragColor = vec4(applyFog(color, vWorld), 1.0);
}
`;

const STREAM_GLSL = `
attribute vec4 aP0;
attribute vec4 aP1;
attribute vec4 aP2;
uniform vec3 uEnd;
uniform float uTime;
uniform vec2 uViewport;

vec3 bezier(float t) {
  float u = 1.0 - t;
  return u * u * u * aP0.xyz + 3.0 * u * u * t * aP1.xyz + 3.0 * u * t * t * aP2.xyz + t * t * t * uEnd;
}

float streamProgress() {
  return (uTime - aP0.w) / max(aP1.w, 1e-3);
}

float streamHead(float progress) {
  float p = clamp(progress, 0.0, 1.0);
  return p * p * (3.0 - 2.0 * p);
}

vec2 toScreen(vec4 clip) {
  return clip.xy / max(clip.w, 1e-6) * uViewport;
}
`;

export const STREAM_VERTEX = `
attribute float aS;
attribute float aSide;
uniform float uWidth;
uniform float uTail;

varying float vK;
varying float vSide;
varying float vSeed;
varying float vLife;

${STREAM_GLSL}

void main() {
  float progress = streamProgress();
  float head = streamHead(progress) * (1.0 + uTail);
  float from = clamp(head - uTail, 0.0, 1.0);
  float to = clamp(head, 0.0, 1.0);
  float visible = step(0.0, progress) * step(from + 1e-4, to);
  float s = mix(from, to, aS);
  vK = clamp((s - (head - uTail)) / uTail, 0.0, 1.0);
  vSide = aSide;
  vSeed = aP2.w;
  vLife = smoothstep(0.0, 0.08, progress) * (1.0 - smoothstep(0.92, 1.0, (head - uTail)));
  float ds = max(0.002, (to - from) * 0.02);
  mat4 viewProjection = projectionMatrix * viewMatrix;
  vec4 c0 = viewProjection * vec4(bezier(s), 1.0);
  vec4 ca = viewProjection * vec4(bezier(max(s - ds, 0.0)), 1.0);
  vec4 cb = viewProjection * vec4(bezier(min(s + ds, 1.0)), 1.0);
  vec2 tangent = toScreen(cb) - toScreen(ca);
  float len = length(tangent);
  vec2 dir = len > 1e-6 ? tangent / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float width = uWidth * (0.55 + 0.9 * vK * vK);
  c0.xy += normal * aSide * 0.5 * width * c0.w / uViewport;
  gl_Position = visible > 0.5 && c0.w > 0.0 && ca.w > 0.0 && cb.w > 0.0 ? c0 : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const STREAM_FRAGMENT = `
uniform float uGain;

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
  vec3 color = mix(tailColor, vec3(1.0, 0.86, 0.66), k * k * k) * trail * across;
  gl_FragColor = vec4(color * uGain * vLife, 1.0);
}
`;

export const STREAM_CARD_VERTEX = `
attribute vec2 aCorner;
uniform float uCardPixels;
uniform float uCardWorld;
uniform float uCardMax;
uniform float uCardShare;
uniform float uFade;

varying vec2 vLocal;
varying float vAlpha;
varying vec3 vSky;
varying vec3 vGround;
varying float vHorizon;
varying float vPixel;
varying float vCard;

${STREAM_GLSL}
${CARD_PALETTE_GLSL}

const float HALO = 2.6;

void main() {
  float progress = streamProgress();
  float alive = step(0.0, progress) * step(progress, 1.0);
  float s = streamHead(progress);
  mat4 viewProjection = projectionMatrix * viewMatrix;
  vec4 clip = viewProjection * vec4(bezier(s), 1.0);
  vec4 ca = viewProjection * vec4(bezier(max(s - 0.01, 0.0)), 1.0);
  vec4 cb = viewProjection * vec4(bezier(min(s + 0.01, 1.0)), 1.0);
  vec2 tangent = toScreen(cb) - toScreen(ca);
  float heading = length(tangent) > 1e-5 ? atan(tangent.y, tangent.x) : 0.0;
  float seed = aP2.w;
  float wobble = sin(uTime * (3.0 + 4.0 * seed) + seed * 40.0) * 0.4;
  float turn = heading + (seed - 0.5) * 1.2 + wobble;
  vCard = step(fract(seed * 11.7), uCardShare);
  float perspective = uCardWorld * projectionMatrix[1][1] * uViewport.y / max(clip.w, 1e-3);
  float size = clamp(perspective, uCardPixels, uCardMax) * mix(0.5, 0.8 + 0.5 * fract(seed * 7.31), vCard) * (1.0 - 0.6 * smoothstep(0.7, 1.0, progress));
  vec2 local = aCorner * HALO;
  vec2 offset = vec2(cos(turn) * local.x - sin(turn) * local.y, sin(turn) * local.x + cos(turn) * local.y) * size;
  clip.xy += offset * clip.w / uViewport;
  vLocal = local;
  vPixel = 1.0 / max(size, 0.5);
  vAlpha = smoothstep(0.0, 0.08, progress) * (1.0 - smoothstep(0.9, 1.0, progress)) * uFade;
  vSky = palette(seed, 0.0);
  vGround = palette(seed, 1.0);
  vHorizon = (fract(seed * 3.71) - 0.5) * 0.5;
  gl_Position = alive > 0.5 && clip.w > 0.0 && vAlpha > 0.002 ? clip : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const GLOW_VERTEX = `
attribute vec2 aCorner;
uniform vec3 uCenter;
uniform vec2 uViewport;
uniform float uSize;
uniform float uWorldSize;

varying vec2 vCorner;

void main() {
  vCorner = aCorner;
  vec4 clip = projectionMatrix * viewMatrix * vec4(uCenter, 1.0);
  float pixels = uSize + uWorldSize * projectionMatrix[1][1] * uViewport.y / max(clip.w, 1e-3);
  clip.xy += aCorner * pixels * clip.w / uViewport;
  gl_Position = clip.w > 0.0 ? clip : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const GLOW_FRAGMENT = `
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vCorner;

void main() {
  float d2 = dot(vCorner, vCorner);
  float core = exp(-d2 * 40.0) * 1.6;
  float inner = exp(-d2 * 9.0);
  float halo = exp(-d2 * 3.0) * 0.2;
  gl_FragColor = vec4(uColor * (core + inner + halo) * uIntensity, 1.0);
}
`;

export const EXPRESSWAY_VERTEX = `
attribute vec2 aRoad;
varying vec2 vRoad;
varying vec3 vWorld;

void main() {
  vRoad = aRoad;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const EXPRESSWAY_FRAGMENT = `
${NOISE_GLSL}
${FILTER_GLSL}
${CITY_COMMON_GLSL}
varying vec2 vRoad;
varying vec3 vWorld;

float traffic(float along, float lane, float speed, float fw) {
  float spacing = 22.0 + 10.0 * hash12(vec2(lane, 3.0));
  float shifted = (along - uTime * speed) / spacing + hash12(vec2(lane, 7.0));
  float car = filteredPulse(shifted, 0.0, 0.16, fw / spacing);
  float gap = step(0.35, hash12(vec2(floor(shifted), lane)));
  return car * gap;
}

void main() {
  float along = vRoad.x;
  float across = vRoad.y;
  float fw = max(fwidth(along), 1e-3);
  float fwy = max(fwidth(across), 1e-4);
  vec3 color = vec3(0.01, 0.011, 0.012);
  float laneA = bandAA(across + 0.45, 0.16, fwy);
  float laneB = bandAA(across + 0.15, 0.16, fwy);
  float laneC = bandAA(across - 0.15, 0.16, fwy);
  float laneD = bandAA(across - 0.45, 0.16, fwy);
  vec3 head = vec3(1.0, 0.95, 0.86) * 2.2;
  vec3 tail = vec3(1.0, 0.16, 0.06) * 1.6;
  color += head * (laneA * traffic(along, 1.0, 21.0, fw) + laneB * traffic(along, 2.0, 25.0, fw));
  color += tail * (laneC * traffic(along, 3.0, -23.0, fw) + laneD * traffic(along, 4.0, -19.0, fw));
  float edge = bandAA(abs(across) - 0.93, 0.05, fwy);
  float lamps = filteredPulse(along / 32.0, 0.47, 0.53, fw / 32.0);
  color += vec3(1.0, 0.7, 0.4) * edge * (0.08 + lamps * 3.0);
  gl_FragColor = vec4(applyFog(color, vWorld), 1.0);
}
`;

export const BEACON_VERTEX = `
attribute vec2 aCorner;
attribute vec4 aBeacon;
uniform vec2 uViewport;
uniform float uSize;
uniform float uTime;

varying vec2 vCorner;
varying float vOn;

void main() {
  vCorner = aCorner;
  float phase = fract(uTime * 0.62 + aBeacon.w * 7.0);
  vOn = smoothstep(0.0, 0.05, phase) * (1.0 - smoothstep(0.42, 0.52, phase));
  vec4 clip = projectionMatrix * viewMatrix * vec4(aBeacon.xyz, 1.0);
  clip.xy += aCorner * uSize * clip.w / uViewport;
  gl_Position = vOn > 0.01 && clip.w > 0.0 ? clip : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

export const BEACON_FRAGMENT = `
varying vec2 vCorner;
varying float vOn;

void main() {
  float d2 = dot(vCorner, vCorner);
  float core = exp(-d2 * 9.0) * 2.4;
  float halo = exp(-d2 * 2.5) * 0.35;
  gl_FragColor = vec4(vec3(1.0, 0.12, 0.05) * (core + halo) * vOn, 1.0);
}
`;

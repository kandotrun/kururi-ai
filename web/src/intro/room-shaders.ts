import { NOISE_GLSL } from "./glsl";

export const ROOM_VERTEX = `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ROOM_LIGHT_GLSL = `
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform vec3 uLampColor;
uniform float uLampPower;
uniform vec2 uLampCone;
uniform vec3 uGlowPos;
uniform vec3 uGlowColor;
uniform float uGlowPower;
uniform vec3 uSkyColor;
uniform vec4 uBackWindow;
uniform float uBackZ;
uniform vec3 uAmbient;

vec3 roomLight(vec3 p, vec3 n, vec3 v, float shininess, float specular) {
  vec3 toLamp = uLampPos - p;
  float d2 = dot(toLamp, toLamp);
  vec3 l = toLamp * inversesqrt(max(d2, 1e-4));
  float cone = smoothstep(uLampCone.x, uLampCone.y, dot(-l, uLampDir));
  float nl = max(dot(n, l), 0.0);
  vec3 h = normalize(l + v);
  float spec = pow(max(dot(n, h), 0.0), shininess) * specular;
  vec3 lamp = uLampColor * uLampPower * cone * nl * (1.0 + spec) / (1.0 + d2 * 0.012);
  vec3 spill = uLampColor * uLampPower * 0.03 * (0.35 + 0.65 * max(dot(n, l), 0.0)) / (1.0 + d2 * 0.012);
  vec3 tg = uGlowPos - p;
  float dg2 = dot(tg, tg);
  vec3 glow = uGlowColor * uGlowPower * max(dot(n, tg * inversesqrt(max(dg2, 1e-4))), 0.0) / (1.0 + dg2 * 0.05);
  vec3 wp = vec3(clamp(p.x, uBackWindow.x - uBackWindow.y, uBackWindow.x + uBackWindow.y), clamp(p.y, uBackWindow.z, uBackWindow.w), uBackZ);
  vec3 tw = wp - p;
  float dw2 = dot(tw, tw);
  float facing = max(dot(n, tw * inversesqrt(max(dw2, 1e-4))), 0.0);
  vec3 window = uSkyColor * facing * 60.0 / (60.0 + dw2) * step(uBackZ, p.z);
  return lamp + spill + glow + window + uAmbient;
}
`;

export const ROOM_FRAGMENT = `
${NOISE_GLSL}
${ROOM_LIGHT_GLSL}
uniform vec3 uAlbedo;
uniform vec3 uEmissive;
uniform float uKind;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

vec3 woodGrain(vec2 p, vec3 dark, vec3 light) {
  float ring = p.y * 1.7 + fbm(vec2(p.x * 0.08, p.y * 0.6)) * 3.2;
  float grain = fract(ring);
  grain = smoothstep(0.0, 0.5, grain) * smoothstep(1.0, 0.55, grain);
  float streak = valueNoise(vec2(p.x * 0.9, p.y * 22.0));
  return mix(dark, light, clamp(grain * 0.65 + streak * 0.35, 0.0, 1.0));
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) {
    n = -n;
  }
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 albedo = uAlbedo;
  float shininess = 8.0;
  float specular = 0.0;
  if (uKind > 0.5 && uKind < 1.5) {
    float plank = vWorld.x / 1.6;
    float row = floor(plank);
    float seam = smoothstep(0.0, 0.03, fract(plank)) * smoothstep(1.0, 0.97, fract(plank));
    vec2 q = vec2(vWorld.z + row * 7.3, vWorld.x);
    albedo = woodGrain(vec2(q.x * 0.35, q.y), uAlbedo * 0.7, uAlbedo * 1.3) * mix(0.55, 1.0, seam) * (0.85 + 0.3 * hash12(vec2(row, 3.0)));
    shininess = 30.0;
    specular = 0.6;
  } else if (uKind > 1.5 && uKind < 2.5) {
    vec2 q = abs(n.y) > 0.5 ? vWorld.zx : (abs(n.x) > 0.5 ? vWorld.zy : vWorld.xy);
    albedo = woodGrain(vec2(q.x * 0.25, q.y * 0.9), uAlbedo * 0.62, uAlbedo * 1.25);
    shininess = 42.0;
    specular = 1.1;
  } else if (uKind > 2.5 && uKind < 3.5) {
    albedo *= 0.92 + 0.12 * fbm(vWorld.xy * 0.35 + vWorld.zz * 0.2);
  } else if (uKind > 3.5 && uKind < 4.5) {
    shininess = 60.0;
    specular = 3.0;
  } else if (uKind > 4.5) {
    vec2 q = vUv - 0.5;
    float border = step(0.42, max(abs(q.x) * 1.0, abs(q.y) * 1.0));
    vec3 sky = mix(vec3(0.42, 0.56, 0.7), vec3(0.85, 0.62, 0.4), smoothstep(0.1, -0.25, q.y));
    vec3 land = mix(vec3(0.18, 0.26, 0.16), vec3(0.32, 0.3, 0.22), valueNoise(q * 9.0));
    vec3 photo = mix(land, sky, smoothstep(-0.08, -0.02, q.y + 0.08 * sin(q.x * 9.0)));
    albedo = mix(photo, vec3(0.92, 0.9, 0.85), border);
    shininess = 60.0;
    specular = 1.4;
  }
  vec3 color = albedo * roomLight(vWorld, n, v, shininess, specular) + uEmissive;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const MAT_FRAGMENT = `
${NOISE_GLSL}
${ROOM_LIGHT_GLSL}
uniform vec3 uMat;
uniform vec3 uLine;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uMargin;
uniform float uRadius;
uniform vec2 uPoolCenter;
uniform float uPoolRadius;
uniform vec3 uPoolTint;
uniform float uMatAmbient;
uniform vec3 uSatinPos;
uniform float uRoomMix;
uniform vec2 uFogCenter;
uniform vec2 uFogRange;
uniform vec3 uMatDeep;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

float fbm4(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * valueNoise(p);
    p = p * 2.03 + vec2(17.1, 9.4);
    amplitude *= 0.5;
  }
  return value;
}

float gridLine(float coord, float width) {
  float deriv = max(length(vec2(dFdx(coord), dFdy(coord))), 1e-5);
  float drawWidth = clamp(width, deriv, 0.5);
  float aa = deriv * 1.5;
  float dist = 1.0 - abs(fract(coord) * 2.0 - 1.0);
  float line = 1.0 - smoothstep(drawWidth - aa, drawWidth + aa, dist);
  line *= clamp(width / drawWidth, 0.0, 1.0);
  return mix(line, width, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
}

float singleLine(float distance, float width) {
  float deriv = max(fwidth(distance), 1e-5);
  float drawWidth = max(width, deriv);
  float line = 1.0 - smoothstep(drawWidth * 0.5 - deriv * 0.75, drawWidth * 0.5 + deriv * 0.75, abs(distance));
  return line * clamp(width / drawWidth, 0.0, 1.0);
}

float rulerTicks(float along, float across) {
  float minor = gridLine(along * 10.0, 0.06) * step(across, 0.2) * step(0.06, across);
  float mid = gridLine(along * 2.0, 0.016) * step(across, 0.32) * step(0.06, across);
  float major = gridLine(along, 0.012) * step(across, 0.44) * step(0.06, across);
  return max(max(minor, mid), major);
}

void main() {
  vec2 p = vWorld.xz;
  vec2 q = abs(p - uCenter);
  vec2 corner = q - (uHalf - uRadius);
  float sdf = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - uRadius;
  float sdfWidth = max(fwidth(sdf), 1e-4);
  float insideMat = 1.0 - smoothstep(-sdfWidth, sdfWidth, sdf);
  if (insideMat < 0.002) {
    discard;
  }

  float mottle = fbm4(p * 0.22) - 0.5;
  float grainScale = clamp(1.0 - fwidth(p.x) * 26.0, 0.0, 1.0);
  float grain = (valueNoise(p * 31.0) - 0.5) * grainScale;
  vec3 base = uMat * (1.0 + mottle * 0.1 + grain * 0.035);

  vec2 gridEdge = uHalf - uMargin;
  vec2 overEdge = q - gridEdge;
  float gridMask = 1.0 - smoothstep(-0.015, 0.015, max(overEdge.x, overEdge.y));
  float minor = max(gridLine(p.x * 10.0, 0.034), gridLine(p.y * 10.0, 0.034));
  float major = max(gridLine(p.x + 0.5, 0.0115), gridLine(p.y + 0.5, 0.0115));
  float decade = max(gridLine((p.x + 0.5) / 5.0, 0.0034), gridLine((p.y + 0.5) / 5.0, 0.0034));
  float diagonal = max(singleLine((p.x - p.y) * 0.70710678, 0.009), singleLine((p.x + p.y) * 0.70710678, 0.009));
  float lines = clamp(minor * 0.075 + major * 0.19 + decade * 0.12 + diagonal * 0.09, 0.0, 0.5) * gridMask;

  float acrossX = uHalf.y - q.y;
  float acrossZ = uHalf.x - q.x;
  float bandX = step(acrossX, uMargin) * step(q.x, gridEdge.x + 0.02);
  float bandZ = step(acrossZ, uMargin) * step(q.y, gridEdge.y + 0.02);
  float ruler = max(rulerTicks(p.x - uCenter.x + gridEdge.x, acrossX) * bandX, rulerTicks(p.y - uCenter.y + gridEdge.y, acrossZ) * bandZ) * 0.6;

  vec3 mat = mix(base, uLine, max(lines, ruler));
  float bevel = smoothstep(-0.06, -0.012, sdf) * (1.0 - smoothstep(-0.012, 0.0, sdf));
  mat *= 1.0 + bevel * 0.22;

  vec2 d = p - uPoolCenter;
  float pool = exp(-dot(d, d) / (uPoolRadius * uPoolRadius));
  vec3 lampLight = mix(vec3(0.5, 0.53, 0.56) * uMatAmbient, uPoolTint * 1.2, pool);
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 room = roomLight(vWorld, n, v, 12.0, 0.15);
  vec3 color = mat * mix(lampLight, room, uRoomMix);
  vec3 tg = uGlowPos - vWorld;
  float dg = length(tg);
  color += mat * uGlowColor * uGlowPower * max(tg.y / dg, 0.0) / (1.0 + dg * dg * 0.05);
  vec3 toLamp = normalize(uSatinPos - vWorld);
  float satin = pow(max(dot(normalize(toLamp + v), n), 0.0), 9.0);
  color += vec3(0.011, 0.012, 0.0105) * satin;
  float fog = smoothstep(uFogRange.x, uFogRange.y, length(p - uFogCenter)) * (1.0 - uRoomMix);
  color = mix(color, uMatDeep, fog);
  gl_FragColor = vec4(color, insideMat);
}
`;

export const GLASS_FRAGMENT = `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = abs(dot(n, v));
  float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  vec3 tint = vec3(0.012, 0.016, 0.016);
  float alpha = clamp(0.05 + fresnel * 0.4, 0.0, 0.85);
  gl_FragColor = vec4(tint * alpha, alpha);
}
`;

export const CITYVIEW_FRAGMENT = `
${NOISE_GLSL}
uniform float uTime;
uniform float uBrightness;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

const float HORIZON = -1.5;

float tower(float x, float scale, float seed, out float id) {
  id = floor(x / scale);
  float h = hash12(vec2(id, seed));
  float tall = step(0.84, hash12(vec2(id, seed + 4.0)));
  return (0.3 + 0.9 * h * h + tall * (0.9 + 1.3 * hash12(vec2(id, seed + 9.0)))) * scale;
}

vec3 layer(vec2 p, float scale, float seed, float base, float haze, float litShare, inout float covered) {
  float idA;
  float idB;
  float topA = tower(p.x, scale, seed, idA);
  float topB = tower(p.x + scale * 0.43, scale * 0.66, seed + 2.0, idB) * 0.85;
  float useB = step(topA, topB);
  float top = base + max(topA, topB);
  float id = mix(idA, idB + 500.0, useB);
  float width = mix(scale, scale * 0.66, useB);
  float left = mix(idA * scale, idB * scale * 0.66 - scale * 0.43, useB);
  float inside = step(p.y, top) * (1.0 - covered);
  vec2 local = vec2(p.x - left, p.y - base);
  vec2 cellSize = vec2(width / max(3.0, floor(width / (scale * 0.13))), scale * 0.11);
  vec2 grid = local / cellSize;
  vec2 cell = floor(grid);
  vec2 f = fract(grid);
  float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.74);
  float margin = step(cellSize.x * 0.6, local.x) * step(local.x, width - cellSize.x * 0.6) * step(local.y, top - base - cellSize.y * 0.8);
  float floorLit = step(1.0 - litShare * 1.6, hash12(vec2(cell.y, id + seed * 7.0)));
  float lit = step(1.0 - litShare, hash12(cell + vec2(id * 17.0, seed * 13.0)));
  float on = max(lit, floorLit * step(0.35, hash12(cell + id + 3.0)));
  vec3 warm = vec3(1.0, 0.72, 0.44);
  vec3 cool = vec3(0.74, 0.86, 1.0);
  vec3 lamp = mix(warm, cool, step(0.55, hash12(vec2(id, cell.y + seed)))) * pane * margin * on * (0.45 + 0.75 * hash12(cell + 9.0));
  float tall = step(0.84, hash12(vec2(idA, seed + 4.0))) * (1.0 - useB);
  vec2 beacon = (p - vec2((idA + 0.5) * scale, top + scale * 0.03)) / (scale * 0.04);
  float blink = 0.35 + 0.65 * step(0.5, fract(uTime * 0.55 + hash12(vec2(idA, seed))));
  float aviation = exp(-dot(beacon, beacon)) * tall * blink;
  vec3 wall = vec3(0.004, 0.0055, 0.006) * (0.8 + 0.4 * hash12(vec2(id, 1.0)));
  vec3 color = (wall + lamp * 1.2) * inside;
  color = mix(color, vec3(0.05, 0.048, 0.044), haze * inside);
  color += vec3(1.0, 0.14, 0.06) * aviation * 1.6 * (1.0 - haze * 0.6);
  covered = max(covered, inside);
  return color;
}

void main() {
  vec2 p = vWorld.xy;
  float up = clamp((p.y - HORIZON) / 36.0, 0.0, 1.0);
  vec3 sky = mix(vec3(0.07, 0.058, 0.046), vec3(0.006, 0.012, 0.016), pow(up, 0.5));
  float covered = 0.0;
  vec3 color = vec3(0.0);
  color += layer(p + vec2(17.0, 0.0), 5.6, 1.0, HORIZON - 9.0, 0.08, 0.16, covered);
  color += layer(p + vec2(43.0, 0.0), 3.0, 2.0, HORIZON - 2.5, 0.32, 0.22, covered);
  color += layer(p + vec2(5.0, 0.0), 1.5, 3.0, HORIZON - 0.4, 0.58, 0.3, covered);
  float street = step(0.93, hash12(floor(p * vec2(3.0, 6.0)))) * smoothstep(HORIZON + 0.6, HORIZON - 0.2, p.y) * smoothstep(HORIZON - 3.0, HORIZON - 1.0, p.y);
  color += vec3(1.0, 0.7, 0.4) * street * 0.6 * (1.0 - covered);
  color += sky * (1.0 - covered);
  gl_FragColor = vec4(color * uBrightness, 1.0);
}
`;

export const BEAM_VERTEX = `
uniform vec3 uApex;
uniform vec3 uAxis;
uniform float uLength;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vAlong = clamp(dot(world.xyz - uApex, uAxis) / uLength, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const BEAM_FRAGMENT = `
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;

void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vNormal), v));
  float core = pow(facing, 2.2);
  float fade = smoothstep(0.0, 0.12, vAlong) * pow(max(1.0 - vAlong, 0.0), 1.4) * (1.0 - smoothstep(0.75, 0.95, vAlong));
  float dust = 0.8 + 0.4 * valueNoise(vWorld.xz * 1.7 + vec2(uTime * 0.12, vWorld.y * 0.9));
  gl_FragColor = vec4(max(uColor * core * fade * dust * uIntensity, vec3(0.0)), 1.0);
}
`;

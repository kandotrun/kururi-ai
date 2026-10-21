import { NOISE_GLSL } from "./glsl";

export const ROOM_VERTEX = `
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ROOM_LIGHT_GLSL = `
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform vec3 uLampColor;
uniform float uLampPower;
uniform vec3 uGlowPos;
uniform vec3 uGlowColor;
uniform float uGlowPower;
uniform vec3 uCityColor;
uniform vec3 uWindowCenter;
uniform vec2 uPoolCenter;
uniform float uPoolRadius;
uniform vec3 uPoolTint;

vec3 roomLight(vec3 p, vec3 n) {
  vec3 toLamp = uLampPos - p;
  float dl = length(toLamp);
  vec3 l = toLamp / dl;
  float cone = smoothstep(0.3, 0.8, dot(-l, uLampDir));
  vec3 lamp = uLampColor * uLampPower * cone * max(dot(n, l), 0.0) / (1.0 + dl * dl * 0.02);
  vec3 tg = uGlowPos - p;
  float dg = length(tg);
  vec3 glow = uGlowColor * uGlowPower * max(dot(n, tg / dg), 0.0) / (1.0 + dg * dg * 0.06);
  vec3 tw = uWindowCenter - p;
  float dw = length(tw);
  vec3 city = uCityColor * max(dot(n, tw / dw) * 0.8 + 0.2, 0.0) * 40.0 / (40.0 + dw * dw);
  float nearDesk = exp(-length(p.xz) / 11.0) * exp(-abs(p.y) / 9.0);
  vec3 bounce = vec3(0.02, 0.04, 0.032) * nearDesk * (0.6 - 0.4 * n.y);
  return lamp + glow + city + bounce + vec3(0.004, 0.0055, 0.0055);
}

vec3 deskPool(vec2 xz) {
  vec2 d = xz - uPoolCenter;
  float pool = exp(-dot(d, d) / (uPoolRadius * uPoolRadius));
  vec3 light = mix(vec3(0.5, 0.53, 0.56), uPoolTint * 1.2, pool);
  return light * (1.0 - 0.72 * smoothstep(6.5, 15.0, length(xz)));
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

void main() {
  vec3 n = normalize(vNormal);
  vec3 albedo = uAlbedo;
  if (uKind > 0.5 && uKind < 1.5) {
    float plank = fract(vWorld.x / 1.45);
    float seam = smoothstep(0.0, 0.02, plank) * smoothstep(1.0, 0.98, plank);
    albedo *= (0.82 + 0.3 * valueNoise(vec2(floor(vWorld.x / 1.45) * 7.1, vWorld.z * 0.08))) * mix(0.6, 1.0, seam);
  }
  vec3 light = roomLight(vWorld, n);
  if (uKind > 1.5 && uKind < 2.5) {
    light = deskPool(vWorld.xz) * max(n.y, 0.0) + roomLight(vWorld, n) * (1.0 - max(n.y, 0.0));
    albedo *= 0.9 + 0.2 * valueNoise(vWorld.xz * vec2(0.5, 4.0));
  }
  vec3 color = albedo * light + uEmissive;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const MAT_FRAGMENT = `
${NOISE_GLSL}
${ROOM_LIGHT_GLSL}
uniform vec3 uMat;
uniform vec3 uLine;
uniform vec3 uDesk;
uniform vec2 uHalf;
uniform float uMargin;

varying vec3 vWorld;
varying vec3 vNormal;

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
  vec2 q = abs(p);
  float radius = 0.35;
  vec2 corner = q - (uHalf - radius);
  float sdf = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - radius;
  float sdfWidth = max(fwidth(sdf), 1e-4);
  float insideMat = 1.0 - smoothstep(-sdfWidth, sdfWidth, sdf);

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
  float ruler = max(rulerTicks(p.x + gridEdge.x, acrossX) * bandX, rulerTicks(p.y + gridEdge.y, acrossZ) * bandZ) * 0.65;

  vec3 mat = mix(base, uLine, max(lines, ruler));
  float bevel = smoothstep(-0.06, -0.012, sdf) * (1.0 - smoothstep(-0.012, 0.0, sdf));
  mat *= 1.0 + bevel * 0.22;

  float deskGrain = valueNoise(p * 0.9 + 40.0) - 0.5;
  float outside = max(sdf, 0.0);
  vec3 desk = uDesk * (1.0 + deskGrain * 0.12) * (1.0 - 0.55 * exp(-outside / 0.16));
  vec3 color = mix(desk, mat, insideMat);
  color *= deskPool(p);
  vec3 tg = uGlowPos - vWorld;
  float dg = length(tg);
  color += mix(desk, mat, insideMat) * uGlowColor * uGlowPower * max(tg.y / dg, 0.0) / (1.0 + dg * dg * 0.06);
  vec3 toLamp = normalize(uLampPos - vWorld);
  vec3 toEye = normalize(cameraPosition - vWorld);
  float satin = pow(max(dot(normalize(toLamp + toEye), vec3(0.0, 1.0, 0.0)), 0.0), 9.0);
  color += vec3(0.011, 0.012, 0.0105) * satin * insideMat;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const GLASS_FRAGMENT = `
${ROOM_LIGHT_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = abs(dot(n, v));
  float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  vec3 r = reflect(-v, n * sign(dot(n, v)));
  vec3 toLamp = normalize(uLampPos - vWorld);
  float glint = pow(max(dot(r, toLamp), 0.0), 60.0);
  vec3 color = vec3(0.02, 0.03, 0.032) + uLampColor * glint * 0.6;
  float alpha = clamp(0.05 + fresnel * 0.6 + glint * 0.3, 0.0, 0.8);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

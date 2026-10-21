import { type CanvasTexture, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { SHARED_FUNCTIONS_GLSL, SHARED_UNIFORMS_GLSL } from "./glsl";
import { linearColor } from "./palette";
import type { SharedUniforms } from "./uniforms";

const MAT_VERTEX = `
varying vec3 vWorld;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const MAT_FRAGMENT = `
${SHARED_UNIFORMS_GLSL}
uniform vec3 uMat;
uniform vec3 uLine;
uniform vec3 uDesk;
uniform float uHalf;
uniform float uMargin;
uniform sampler2D uDigits;

varying vec3 vWorld;

${SHARED_FUNCTIONS_GLSL}

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

float rulerNumber(float along, float across, float gridMin, float sideways) {
  float coord = along - gridMin;
  float value = floor(coord + 0.5);
  float local = coord - value;
  float digits = value > 9.5 ? 2.0 : 1.0;
  float digitWidth = 0.105;
  float digitHeight = 0.17;
  vec2 metric = sideways > 0.5
    ? vec2(across - 0.56, local + digitHeight * 0.5)
    : vec2(local + digits * digitWidth * 0.5, across - 0.6);
  vec2 box = metric / vec2(digitWidth, digitHeight);
  vec2 dx = dFdx(box);
  vec2 dy = dFdy(box);
  float valid = step(-0.5, value) * step(value, 99.5)
    * step(0.0, box.x) * step(box.x, digits)
    * step(0.0, box.y) * step(box.y, 1.0);
  float index = floor(box.x);
  float tens = floor(value / 10.0);
  float ones = value - tens * 10.0;
  float digit = digits > 1.5 && index < 0.5 ? tens : ones;
  vec2 atlas = vec2((digit + clamp(fract(box.x), 0.0, 1.0)) / 10.0, clamp(box.y, 0.0, 1.0));
  float glyph = textureGrad(uDigits, atlas, vec2(dx.x / 10.0, dx.y), vec2(dy.x / 10.0, dy.y)).a;
  return glyph * valid;
}

float rulerTicks(float along, float across, float gridMin) {
  float coord = along - gridMin;
  float minor = gridLine(coord * 10.0, 0.06) * step(across, 0.2) * step(0.06, across);
  float mid = gridLine(coord * 2.0, 0.016) * step(across, 0.32) * step(0.06, across);
  float major = gridLine(coord, 0.012) * step(across, 0.44) * step(0.06, across);
  return max(max(minor, mid), major);
}

void main() {
  vec2 p = vWorld.xz;
  vec2 q = abs(p);
  float radius = 0.35;
  vec2 corner = q - vec2(uHalf - radius);
  float matSdf = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - radius;
  float sdfWidth = max(fwidth(matSdf), 1e-4);
  float insideMat = 1.0 - smoothstep(-sdfWidth, sdfWidth, matSdf);

  float mottle = fbm(p * 0.22) - 0.5;
  float grainScale = clamp(1.0 - fwidth(p.x) * 26.0, 0.0, 1.0);
  float grain = (valueNoise(p * 31.0) - 0.5) * grainScale;
  vec3 base = uMat * (1.0 + mottle * 0.1 + grain * 0.035);

  float gridEdge = uHalf - uMargin;
  float edge = max(q.x, q.y);
  float gridMask = 1.0 - smoothstep(-0.015, 0.015, edge - gridEdge);
  float minor = max(gridLine(p.x * 10.0, 0.034), gridLine(p.y * 10.0, 0.034));
  float major = max(gridLine(p.x + 0.5, 0.0115), gridLine(p.y + 0.5, 0.0115));
  float decade = max(gridLine((p.x + 0.5) / 5.0, 0.0034), gridLine((p.y + 0.5) / 5.0, 0.0034));
  float diagonal = max(singleLine((p.x - p.y) * 0.70710678, 0.009), singleLine((p.x + p.y) * 0.70710678, 0.009));
  float lines = minor * 0.075 + major * 0.19 + decade * 0.12 + diagonal * 0.09;
  lines = clamp(lines, 0.0, 0.5) * gridMask;

  float gridMin = -gridEdge;
  float north = p.y + uHalf;
  float west = p.x + uHalf;
  float south = uHalf - p.y;
  float east = uHalf - p.x;
  float inNorth = step(north, uMargin) * step(q.x, gridEdge + 0.02);
  float inSouth = step(south, uMargin) * step(q.x, gridEdge + 0.02);
  float inWest = step(west, uMargin) * step(q.y, gridEdge + 0.02);
  float inEast = step(east, uMargin) * step(q.y, gridEdge + 0.02);
  float northMarks = max(rulerTicks(p.x, north, gridMin) * 0.7, rulerNumber(p.x, north, gridMin, 0.0) * 0.66);
  float westMarks = max(rulerTicks(p.y, west, gridMin) * 0.7, rulerNumber(p.y, west, gridMin, 1.0) * 0.66);
  float southMarks = rulerTicks(p.x, south, gridMin) * 0.55;
  float eastMarks = rulerTicks(p.y, east, gridMin) * 0.55;
  float ruler = max(max(northMarks * inNorth, westMarks * inWest), max(southMarks * inSouth, eastMarks * inEast));

  vec3 mat = mix(base, uLine, max(lines, ruler));
  float bevel = smoothstep(-0.06, -0.012, matSdf) * (1.0 - smoothstep(-0.012, 0.0, matSdf));
  mat *= 1.0 + bevel * 0.22;

  float outside = max(matSdf, 0.0);
  float deskGrain = valueNoise(p * 0.9 + 40.0) - 0.5;
  vec3 desk = uDesk * (1.0 + deskGrain * 0.12);
  desk *= 1.0 - 0.55 * exp(-outside / 0.16);

  vec3 color = mix(desk, mat, insideMat);
  color *= lampLight(p);
  vec3 toLamp = normalize(uLampPos - vWorld);
  vec3 toEye = normalize(uCameraPos - vWorld);
  float satin = pow(max(dot(normalize(toLamp + toEye), vec3(0.0, 1.0, 0.0)), 0.0), 9.0);
  color += vec3(0.011, 0.012, 0.0105) * satin * insideMat;
  color = mix(color, uMatDeep, fogAmount(p));
  color *= vignette(gl_FragCoord.xy);
  gl_FragColor = vec4(shoulder(color), 1.0);
  #include <colorspace_fragment>
}
`;

export interface DeskMat {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  dispose(): void;
}

export function createMat(
  shared: SharedUniforms,
  halfSize: number,
  digits: CanvasTexture,
): DeskMat {
  const extent = Math.max(240, halfSize * 8);
  const geometry = new PlaneGeometry(extent, extent, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    uniforms: {
      ...shared,
      uMat: { value: linearColor("mat") },
      uLine: { value: linearColor("matLine") },
      uDesk: { value: linearColor("desk") },
      uHalf: { value: halfSize },
      uMargin: { value: 1.5 },
      uDigits: { value: digits },
    },
    vertexShader: MAT_VERTEX,
    fragmentShader: MAT_FRAGMENT,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

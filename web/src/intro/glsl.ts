export const NOISE_GLSL = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float valueNoise3(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(cell), hash13(cell + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash13(cell + vec3(0.0, 1.0, 0.0)), hash13(cell + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash13(cell + vec3(0.0, 0.0, 1.0)), hash13(cell + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash13(cell + vec3(0.0, 1.0, 1.0)), hash13(cell + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * valueNoise(p);
    p = p * 2.03 + vec2(17.1, 9.4);
    amplitude *= 0.5;
  }
  return value;
}

float fbm3(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * valueNoise3(p);
    p = p * 2.07 + vec3(11.3, 5.7, 3.1);
    amplitude *= 0.5;
  }
  return value;
}

float interleavedGradient(vec2 coord) {
  return fract(52.9829189 * fract(dot(coord, vec2(0.06711056, 0.00583715))));
}
`;

export const FILTER_GLSL = `
float pulseIntegral(float x, float a, float b) {
  return floor(x) * (b - a) + clamp(fract(x), a, b) - a;
}

float filteredPulse(float x, float a, float b, float width) {
  float w = max(width, 1e-4);
  return (pulseIntegral(x + 0.5 * w, a, b) - pulseIntegral(x - 0.5 * w, a, b)) / w;
}

float bandAA(float distance, float halfWidth, float footprint) {
  float fw = max(footprint, 1e-5);
  float drawHalf = max(halfWidth, fw * 0.75);
  float coverage = 1.0 - smoothstep(drawHalf - fw * 0.5, drawHalf + fw * 0.5, abs(distance));
  return coverage * halfWidth / drawHalf;
}
`;

export const TONE_GLSL = `
vec3 shoulder(vec3 color) {
  vec3 knee = vec3(0.8);
  vec3 over = max(color - knee, 0.0);
  return min(color, knee) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
}
`;

export const FULLSCREEN_VERTEX = `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

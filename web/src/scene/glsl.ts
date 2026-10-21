export const SHARED_UNIFORMS_GLSL = `
uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uLampPos;
uniform vec2 uLampCenter;
uniform float uLampRadius;
uniform vec2 uFogCenter;
uniform vec2 uFogRange;
uniform vec3 uMatDeep;
uniform vec3 uLampTint;
uniform vec2 uViewport;
uniform vec2 uViewShift;
`;

export const SHARED_FUNCTIONS_GLSL = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
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

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * valueNoise(p);
    p = p * 2.03 + vec2(17.1, 9.4);
    amplitude *= 0.5;
  }
  return value;
}

float lampPool(vec2 xz) {
  vec2 d = xz - uLampCenter;
  return exp(-dot(d, d) / (uLampRadius * uLampRadius));
}

vec3 lampLight(vec2 xz) {
  float pool = lampPool(xz);
  return mix(vec3(0.5, 0.53, 0.56), uLampTint * 1.2, pool);
}

float vignette(vec2 fragCoord) {
  vec2 centred = fragCoord / max(uViewport, vec2(1.0)) - vec2(0.5 + uViewShift.x, 0.46 - uViewShift.y);
  centred.x *= uViewport.x / max(uViewport.y, 1.0);
  float reach = length(centred) / (0.5 * length(vec2(uViewport.x / max(uViewport.y, 1.0), 1.0)));
  return 1.0 - 0.34 * smoothstep(0.35, 1.05, reach);
}

float fogAmount(vec2 xz) {
  return smoothstep(uFogRange.x, uFogRange.y, length(xz - uFogCenter));
}

vec3 shoulder(vec3 color) {
  vec3 knee = vec3(0.8);
  vec3 over = max(color - knee, 0.0);
  return min(color, knee) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
}

float ditherThreshold(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}
`;

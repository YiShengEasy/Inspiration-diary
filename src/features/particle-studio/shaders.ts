export const particleVertexShader = /* glsl */ `
  attribute float aDepth;
  attribute float aRandom;
  attribute float aScale;
  attribute float aOpacity;
  attribute float aDissolve;

  varying vec3 vColor;
  varying float vAlpha;

  uniform float uDepthStrength;
  uniform float uScatter;
  uniform float uDrift;
  uniform float uTime;
  uniform float uProgress;
  uniform float uPointSize;

  void main() {
    vec3 randomVector = fract(vec3(aRandom, aRandom * 17.17, aRandom * 43.71));
    vec3 settled = position;
    settled.z += (aDepth - 0.5) * uDepthStrength * (0.32 + aDissolve * 0.68);

    float phase = uTime * (0.35 + randomVector.z) + randomVector.x * 6.2831853;
    vec3 motion = vec3(sin(phase), cos(phase * 0.83), sin(phase * 0.57));
    vec3 scattered = settled + (randomVector - 0.5) * uScatter * 0.65 * aDissolve;
    vec3 transformed = mix(scattered, settled, uProgress) + motion * uDrift * 0.08 * aDissolve;

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Keep particles crisp at the default camera distance. The old 260 factor
    // made each point tens of pixels wide, so additive blending and Bloom
    // merged the whole image into one large light blob.
    gl_PointSize = uPointSize * aScale * (5.0 / max(1.0, -mvPosition.z));
    vColor = color;
    vAlpha = smoothstep(0.0, 0.18, uProgress) * aOpacity;
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered) * 2.0;
    if (distanceFromCenter > 1.0) discard;
    float alpha = (1.0 - smoothstep(0.48, 1.0, distanceFromCenter)) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

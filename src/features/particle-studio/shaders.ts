export const particleVertexShader = /* glsl */ `
  attribute float aDepth;
  attribute float aRandom;
  attribute float aScale;
  attribute float aOpacity;
  attribute float aDissolve;
  attribute float aEdge;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkle;

  uniform float uDepthStrength;
  uniform float uScatter;
  uniform float uDrift;
  uniform float uTime;
  uniform float uProgress;
  uniform float uExit;
  uniform float uPointSize;

  void main() {
    vec3 randomVector = fract(vec3(aRandom, aRandom * 17.17, aRandom * 43.71));
    vec3 settled = position;
    settled.z += (aDepth - 0.5) * uDepthStrength * (0.32 + aDissolve * 0.5 + aEdge * 0.18);

    float phase = uTime * (0.35 + randomVector.z) + randomVector.x * 6.2831853;
    vec3 motion = vec3(sin(phase), cos(phase * 0.83), sin(phase * 0.57));
    vec3 scattered = settled + (randomVector - 0.5) * uScatter * 0.65 * aDissolve;
    vec3 transformed = mix(scattered, settled, uProgress)
      + motion * uDrift * 0.08 * mix(aDissolve, 0.32, aEdge);
    vec3 exitDirection = normalize(vec3(position.xy, 0.16 + randomVector.z));
    transformed += (exitDirection * (0.45 + randomVector * 0.7) + motion * 0.22) * uExit * (0.35 + aDissolve);

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Keep particles crisp at the default camera distance. The old 260 factor
    // made each point tens of pixels wide, so additive blending and Bloom
    // merged the whole image into one large light blob.
    gl_PointSize = uPointSize * aScale * (5.0 / max(1.0, -mvPosition.z));
    vColor = color;
    vAlpha = smoothstep(0.0, 0.18, uProgress) * aOpacity * (1.0 - uExit);
    float animatedWeight = max(aDissolve, aEdge * 0.58);
    vTwinkle = mix(1.0, 0.84 + sin(phase * 2.4) * 0.16, animatedWeight);
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkle;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered) * 2.0;
    if (distanceFromCenter > 1.0) discard;
    float alpha = (1.0 - smoothstep(0.48, 1.0, distanceFromCenter)) * vAlpha * vTwinkle;
    gl_FragColor = vec4(vColor * (0.94 + vTwinkle * 0.06), alpha);
  }
`;

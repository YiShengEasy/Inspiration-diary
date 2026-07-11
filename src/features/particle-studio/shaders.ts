export const particleVertexShader = /* glsl */ `
  attribute float aDepth;
  attribute float aRandom;

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
    settled.z += (aDepth - 0.5) * uDepthStrength;

    float phase = uTime * (0.35 + randomVector.z) + randomVector.x * 6.2831853;
    vec3 motion = vec3(sin(phase), cos(phase * 0.83), sin(phase * 0.57));
    vec3 scattered = settled + (randomVector - 0.5) * uScatter * 5.0;
    vec3 transformed = mix(scattered, settled, uProgress) + motion * uDrift;

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Keep particles crisp at the default camera distance. The old 260 factor
    // made each point tens of pixels wide, so additive blending and Bloom
    // merged the whole image into one large light blob.
    gl_PointSize = uPointSize * (5.0 / max(1.0, -mvPosition.z));
    vColor = color;
    vAlpha = smoothstep(0.0, 0.18, uProgress);
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered) * 2.0;
    if (distanceFromCenter > 1.0) discard;
    // This layer only adds a subtle grain over the photo. The original image
    // remains the visual subject instead of being covered by opaque points.
    float alpha = (1.0 - smoothstep(0.62, 1.0, distanceFromCenter)) * vAlpha * 0.14;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export const particleGlowFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered) * 2.0;
    if (distanceFromCenter > 1.0) discard;
    float luminance = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
    float highlight = 0.28 + smoothstep(0.18, 0.9, luminance) * 0.72;
    float halo = 1.0 - smoothstep(0.05, 1.0, distanceFromCenter);
    gl_FragColor = vec4(max(vColor, vec3(0.16)) * 1.22, halo * highlight * vAlpha * 0.28);
  }
`;

export const imagePlaneVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const imagePlaneFragmentShader = /* glsl */ `
  uniform sampler2D uImage;
  varying vec2 vUv;

  void main() {
    vec4 sampled = texture2D(uImage, vUv);
    float edgeDistance = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edgeFade = smoothstep(0.0, 0.028, edgeDistance);
    float centerLight = 1.0 + (1.0 - smoothstep(0.0, 0.72, distance(vUv, vec2(0.5)))) * 0.18;
    vec3 color = sampled.rgb * centerLight;
    gl_FragColor = vec4(color, sampled.a * edgeFade);
  }
`;

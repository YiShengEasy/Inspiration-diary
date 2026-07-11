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
    float depthEnvelope = mix(0.11, 0.38, max(aDissolve, aEdge * 0.55));
    settled.z += (aDepth - 0.5) * uDepthStrength * depthEnvelope;

    float phase = uTime * (0.35 + randomVector.z) + randomVector.x * 6.2831853;
    vec3 motion = vec3(sin(phase), cos(phase * 0.83), sin(phase * 0.57));
    vec3 entryScatter = (randomVector - 0.5) * uScatter * 0.65 * aDissolve;
    vec3 persistentScatter = (randomVector - 0.5) * uScatter * 0.16 * aDissolve;
    vec3 transformed = settled + mix(entryScatter, persistentScatter, uProgress)
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
    gl_FragColor = vec4(vColor * (1.02 + vTwinkle * 0.28), alpha);
  }
`;

export const imageSurfaceVertexShader = /* glsl */ `
  varying vec2 vUv;

  uniform sampler2D uDepthMap;
  uniform float uDepthStrength;
  uniform float uProgress;
  uniform float uExit;

  void main() {
    vUv = uv;
    vec3 transformed = position;
    float imageDepth = texture2D(uDepthMap, uv).r;
    transformed.z += (imageDepth - 0.5) * uDepthStrength * 0.11;
    transformed.z += uExit * 0.16;
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const imageSurfaceFragmentShader = /* glsl */ `
  varying vec2 vUv;

  uniform sampler2D uImage;
  uniform sampler2D uContentMask;
  uniform float uTime;
  uniform float uProgress;
  uniform float uExit;
  uniform float uBrightnessThreshold;
  uniform float uAlphaThreshold;
  uniform float uEdgeStrength;

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    fraction = fraction * fraction * (3.0 - 2.0 * fraction);
    return mix(
      mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), fraction.x),
      mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), fraction.x),
      fraction.y
    );
  }

  void main() {
    vec4 imageColor = texture2D(uImage, vUv);
    float contentMask = texture2D(uContentMask, vUv).r;
    float luminance = dot(imageColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float coarse = valueNoise(vUv * 4.2 + vec2(8.7, -3.4));
    float fine = valueNoise(vUv * 19.0 + vec2(-2.6, 11.3));
    float dissolveNoise = coarse * 0.64 + fine * 0.36 - 0.5;
    float noisyContent = contentMask
      + dissolveNoise * mix(0.15, 0.3, uEdgeStrength)
      + (luminance - 0.45) * 0.08;
    float dissolveMask = smoothstep(0.28, 0.7, noisyContent);
    float darkPresence = smoothstep(
      uBrightnessThreshold * 0.5,
      max(0.12, uBrightnessThreshold + 0.08),
      luminance
    );
    float darkMask = mix(0.16, 1.0, darkPresence);
    float alphaMask = smoothstep(uAlphaThreshold, min(1.0, uAlphaThreshold + 0.08), imageColor.a);
    float entrance = smoothstep(0.02, 0.42, uProgress);
    float alpha = alphaMask * dissolveMask * darkMask * entrance * (1.0 - uExit);
    if (alpha < 0.01) discard;
    // Keep the coherent surface below the default Bloom threshold. Bright
    // particles still glow, while white image backgrounds retain detail.
    vec3 color = imageColor.rgb * mix(0.44, 0.72, smoothstep(0.22, 0.82, contentMask));
    gl_FragColor = vec4(color, alpha);
  }
`;

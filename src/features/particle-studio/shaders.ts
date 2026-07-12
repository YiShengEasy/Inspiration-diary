export const particleVertexShader = /* glsl */ `
  attribute float aDepth;
  attribute float aRandom;
  attribute float aScale;
  attribute float aOpacity;
  attribute float aDissolve;
  attribute float aEdge;
  attribute float aContent;
  attribute float aBoundary;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkle;

  uniform float uDepthStrength;
  uniform float uScatter;
  uniform float uDrift;
  uniform float uTime;
  uniform float uLoopDuration;
  uniform float uProgress;
  uniform float uExit;
  uniform float uPointSize;
  uniform float uWaveStrength;
  uniform float uWaveScale;
  uniform float uWaveSpeed;
  uniform float uInvasionRange;
  uniform float uEdgeSoftness;
  uniform float uIrregularity;
  uniform float uNoiseScale;
  uniform float uOuterDispersion;
  uniform float uColorRetention;

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
    float loopPhase = mod(max(0.0, uTime), uLoopDuration) / uLoopDuration * 6.2831853;
    float warpedPhase = loopPhase + sin(loopPhase) * uWaveSpeed * 1.35;
    vec2 loopOffset = vec2(cos(loopPhase), sin(loopPhase));
    vec2 fieldUv = position.xy * uNoiseScale;
    float coarse = valueNoise(fieldUv + loopOffset * 0.42);
    float fine = valueNoise(fieldUv * 3.17 - loopOffset * 0.28);
    float erosionNoise = coarse * 0.68 + fine * 0.32 - 0.5;
    float centerProtect = 1.0 - smoothstep(0.42, 1.05, length(position.xy * vec2(1.15, 0.9)));
    float field = aContent * 0.8 + centerProtect * 0.9
      - (uInvasionRange - 0.5) * 0.82
      + erosionNoise * uIrregularity * 0.72
      + aBoundary * 0.08;
    float invasion = 1.0 - smoothstep(0.5 - uEdgeSoftness, 0.5 + uEdgeSoftness, field);

    vec3 randomVector = fract(vec3(aRandom, aRandom * 17.17, aRandom * 43.71));
    vec3 transformed = position;
    float wave = (
      sin(position.x * uWaveScale * 3.1 + warpedPhase)
      + cos(position.y * uWaveScale * 2.35 - warpedPhase * 0.86)
    ) * 0.5;
    float waveEnvelope = mix(0.22, 1.0, invasion);
    transformed.xy += vec2(cos(warpedPhase + position.y * 2.1), sin(warpedPhase - position.x * 1.7))
      * wave * uWaveStrength * 0.18 * waveEnvelope;
    transformed.z += wave * uWaveStrength * waveEnvelope;
    transformed.z += (aDepth - 0.5) * uDepthStrength * mix(0.1, 0.36, invasion);

    vec2 radial = normalize(position.xy + vec2(0.0001));
    vec2 curl = vec2(-radial.y, radial.x);
    vec2 fieldDirection = normalize(curl + radial * (coarse - 0.5) * 0.72);
    float distanceNoise = 0.22 + randomVector.x * 0.78;
    float erosionBoundary = smoothstep(0.08, 0.32, invasion)
      * (1.0 - smoothstep(0.68, 0.94, invasion));
    float innerErosion = (1.0 - smoothstep(0.02, 0.58, invasion))
      * (1.0 - smoothstep(0.72, 0.95, aContent))
      * clamp(aBoundary * 1.28 + aEdge * 0.34, 0.0, 1.0);
    float erodedVoid = smoothstep(0.76, 1.0, invasion);
    float particleRegion = max(erosionBoundary, innerErosion * 0.38)
      * (1.0 - erodedVoid);
    transformed.xy += fieldDirection * particleRegion
      * uOuterDispersion * distanceNoise * 0.075;

    float phase = warpedPhase + randomVector.x * 6.2831853;
    vec3 motion = vec3(sin(phase), cos(phase * 0.83), sin(phase * 0.57));
    transformed += (randomVector - 0.5) * uScatter * 0.1 * particleRegion;
    transformed += motion * uDrift * 0.055 * mix(0.12, 1.0, particleRegion);

    vec3 exitDirection = normalize(vec3(position.xy, 0.16 + randomVector.z));
    transformed += (exitDirection * (0.45 + randomVector * 0.7) + motion * 0.22)
      * uExit * (0.35 + invasion);

    float particlePresence = particleRegion;
    float densityChance = mix(0.16, 0.96, erosionBoundary)
      * mix(0.72, 1.0, aBoundary);
    float densityGate = step(aRandom, densityChance);
    float originalLuminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float highlight = smoothstep(0.62, 0.96, originalLuminance)
      * clamp(aEdge * 1.35 + aBoundary * 0.82, 0.0, 1.0);
    float maxChannel = max(color.r, max(color.g, color.b));
    vec3 luminousSource = color * max(1.0, 0.52 / max(0.08, maxChannel));
    vec3 highlighted = mix(luminousSource, vec3(1.0), highlight * 0.42);
    float effectiveRetention = mix(uColorRetention, min(uColorRetention, 0.62), erosionBoundary);
    vColor = mix(highlighted, color, effectiveRetention);
    vec3 coolGlow = vec3(0.15, 0.92, 1.0);
    float coolMix = erosionBoundary * (1.0 - uColorRetention) * 0.86;
    vColor = mix(vColor, coolGlow, coolMix);
    vColor *= mix(0.92, 1.18, erosionBoundary);

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uPointSize * aScale * (5.0 / max(1.0, -mvPosition.z));
    vAlpha = smoothstep(0.0, 0.18, uProgress) * aOpacity * particlePresence
      * densityGate * (1.0 - uExit);
    vTwinkle = 0.9 + sin(phase * 2.0) * 0.1 * mix(0.25, 1.0, particleRegion);
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
    float alpha = (1.0 - smoothstep(0.42, 1.0, distanceFromCenter)) * vAlpha * vTwinkle;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor * (1.35 + vTwinkle * 0.45), alpha);
  }
`;

export const imageSurfaceVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vInvasion;

  uniform sampler2D uDepthMap;
  uniform sampler2D uContentMask;
  uniform float uDepthStrength;
  uniform float uTime;
  uniform float uLoopDuration;
  uniform float uProgress;
  uniform float uExit;
  uniform float uWaveStrength;
  uniform float uWaveScale;
  uniform float uWaveSpeed;
  uniform float uInvasionRange;
  uniform float uEdgeSoftness;
  uniform float uIrregularity;
  uniform float uNoiseScale;

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
    vUv = uv;
    float loopPhase = mod(max(0.0, uTime), uLoopDuration) / uLoopDuration * 6.2831853;
    float warpedPhase = loopPhase + sin(loopPhase) * uWaveSpeed * 1.35;
    vec2 loopOffset = vec2(cos(loopPhase), sin(loopPhase));
    float content = texture2D(uContentMask, uv).r;
    float coarse = valueNoise(uv * uNoiseScale + loopOffset * 0.42);
    float fine = valueNoise(uv * uNoiseScale * 3.17 - loopOffset * 0.28);
    float erosionNoise = coarse * 0.68 + fine * 0.32 - 0.5;
    vec2 centeredUv = (uv - 0.5) * 2.0;
    float centerProtect = 1.0 - smoothstep(0.42, 1.08, length(centeredUv * vec2(0.9, 1.12)));
    float field = content * 0.8 + centerProtect * 0.9 - (uInvasionRange - 0.5) * 0.82
      + erosionNoise * uIrregularity * 0.72;
    vInvasion = 1.0 - smoothstep(0.5 - uEdgeSoftness, 0.5 + uEdgeSoftness, field);

    vec3 transformed = position;
    float imageDepth = texture2D(uDepthMap, uv).r;
    float wave = (
      sin(position.x * uWaveScale * 3.1 + warpedPhase)
      + cos(position.y * uWaveScale * 2.35 - warpedPhase * 0.86)
    ) * 0.5;
    transformed.xy += vec2(cos(warpedPhase + position.y * 2.1), sin(warpedPhase - position.x * 1.7))
      * wave * uWaveStrength * 0.18 * mix(0.18, 0.9, vInvasion);
    transformed.z += wave * uWaveStrength * mix(0.18, 0.9, vInvasion);
    transformed.z += (imageDepth - 0.5) * uDepthStrength * 0.11;
    transformed.z += uExit * 0.16;
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const imageSurfaceFragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vInvasion;

  uniform sampler2D uImage;
  uniform sampler2D uContentMask;
  uniform float uProgress;
  uniform float uExit;
  uniform float uBrightnessThreshold;
  uniform float uAlphaThreshold;

  void main() {
    vec4 imageColor = texture2D(uImage, vUv);
    float contentMask = texture2D(uContentMask, vUv).r;
    float luminance = dot(imageColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float contentPresence = smoothstep(0.005, 0.12, contentMask);
    vec2 centeredUv = (vUv - 0.5) * 2.0;
    float automaticProtection = (1.0 - smoothstep(0.38, 1.02, length(centeredUv * vec2(0.9, 1.12))))
      * contentPresence;
    float effectiveInvasion = vInvasion * (1.0 - automaticProtection * 0.98);
    float darkPresence = smoothstep(
      uBrightnessThreshold * 0.5,
      max(0.12, uBrightnessThreshold + 0.08),
      luminance
    );
    float alphaMask = smoothstep(uAlphaThreshold, min(1.0, uAlphaThreshold + 0.08), imageColor.a);
    float entrance = smoothstep(0.02, 0.42, uProgress);
    float surfacePresence = mix(1.0, 0.028, smoothstep(0.2, 0.94, effectiveInvasion));
    float alpha = alphaMask * contentPresence * mix(0.48, 1.0, darkPresence)
      * surfacePresence * entrance * (1.0 - uExit);
    if (alpha < 0.008) discard;
    float blackening = mix(1.2, 0.07, smoothstep(0.14, 0.96, effectiveInvasion));
    gl_FragColor = vec4(imageColor.rgb * blackening, alpha);
  }
`;

export const particleVertexShader = /* glsl */ `
  attribute float aDepth;
  attribute float aRandom;
  attribute float aScale;
  attribute float aOpacity;
  attribute float aEdge;
  attribute float aContent;
  attribute float aBoundary;
  attribute vec2 aUv;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkle;
  varying float vEmission;

  uniform float uDepthStrength;
  uniform float uScatter;
  uniform float uDrift;
  uniform float uTime;
  uniform float uLoopDuration;
  uniform float uProgress;
  uniform float uExit;
  uniform float uPointSize;
  uniform float uDensity;
  uniform float uWaveStrength;
  uniform float uWaveScale;
  uniform float uWaveSpeed;
  uniform float uInvasionRange;
  uniform float uEdgeSoftness;
  uniform float uIrregularity;
  uniform float uNoiseScale;
  uniform float uOuterDispersion;
  uniform float uColorRetention;
  uniform float uInnerCrossStrength;
  uniform int uEffectMode;
  uniform int uDissolveDirection;
  uniform float uDissolveProgress;
  uniform float uDissolveBandwidth;

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

  float directionScore(vec2 uv) {
    float radial = clamp(length((uv - 0.5) * vec2(1.0, 1.08)) * 1.52, 0.0, 1.0);
    if (uDissolveDirection == 1) return 1.0 - radial;
    if (uDissolveDirection == 2) return 1.0 - uv.x;
    if (uDissolveDirection == 3) return uv.y;
    if (uDissolveDirection == 4) return 1.0 - uv.y;
    return radial;
  }

  float effectDissolve(vec2 uv, vec2 loopOffset) {
    float coarse = valueNoise(uv * uNoiseScale + loopOffset * 0.16);
    float fine = valueNoise(uv * uNoiseScale * 3.71 - loopOffset * 0.11);
    float noise = (coarse * 0.66 + fine * 0.34 - 0.5) * uIrregularity;
    float threshold = 1.0 - uDissolveProgress;
    return smoothstep(
      threshold - uDissolveBandwidth,
      threshold + uDissolveBandwidth,
      directionScore(uv) + noise * 0.7
    );
  }

  void main() {
    float loopPhase = mod(max(0.0, uTime), uLoopDuration) / uLoopDuration * 6.2831853;
    float warpedPhase = loopPhase + sin(loopPhase) * uWaveSpeed * 1.35;
    vec2 loopOffset = vec2(cos(loopPhase), sin(loopPhase));
    vec2 fieldUv = aUv * uNoiseScale;
    float coarse = valueNoise(fieldUv + loopOffset * 0.42);
    float fine = valueNoise(fieldUv * 3.17 - loopOffset * 0.28);
    float erosionNoise = coarse * 0.68 + fine * 0.32 - 0.5;
    float centerProtect = 1.0 - smoothstep(0.42, 1.05, length(position.xy * vec2(1.15, 0.9)));
    float portraitField = aContent * 0.8 + centerProtect * 0.9
      - (uInvasionRange - 0.5) * 0.82
      + erosionNoise * uIrregularity * 0.72
      + aBoundary * 0.08;
    float portraitInvasion = 1.0 - smoothstep(
      0.5 - uEdgeSoftness,
      0.5 + uEdgeSoftness,
      portraitField
    );
    float dissolve = uEffectMode == 0
      ? portraitInvasion
      : effectDissolve(aUv, loopOffset);

    vec3 randomVector = fract(vec3(aRandom, aRandom * 17.17, aRandom * 43.71));
    vec3 transformed = position;
    float wave = (
      sin(position.x * uWaveScale * 3.1 + warpedPhase)
      + cos(position.y * uWaveScale * 2.35 - warpedPhase * 0.86)
    ) * 0.5;
    float waveEnvelope = mix(0.18, 1.0, dissolve);
    transformed.xy += vec2(cos(warpedPhase + position.y * 2.1), sin(warpedPhase - position.x * 1.7))
      * wave * uWaveStrength * 0.16 * waveEnvelope;
    transformed.z += wave * uWaveStrength * waveEnvelope;
    transformed.z += (aDepth - 0.5) * uDepthStrength * mix(0.1, 0.36, dissolve);

    vec2 radial = normalize(position.xy + vec2(0.0001));
    vec2 curl = vec2(-radial.y, radial.x);
    vec2 fieldDirection = normalize(curl + radial * (coarse - 0.5) * 0.72);
    float distanceNoise = 0.22 + randomVector.x * 0.78;
    float contentGate = smoothstep(0.04, 0.24, aContent);
    float innerBand = smoothstep(0.05, 0.3, dissolve)
      * (1.0 - smoothstep(0.82, 1.0, dissolve));
    float boundaryBand = smoothstep(0.12, 0.42, dissolve)
      * (1.0 - smoothstep(0.58, 0.9, dissolve));
    float sourceDetail = clamp(
      aBoundary * (0.72 + uInnerCrossStrength * 0.2)
      + aEdge * 0.48
      + aContent * 0.34,
      0.0,
      1.0
    );
    float particleRegion = innerBand * contentGate * mix(0.55, 1.0, sourceDetail);

    if (uEffectMode == 0) {
      float erodedVoid = smoothstep(0.86, 1.0, dissolve);
      particleRegion = smoothstep(0.38, 0.82, dissolve)
        * contentGate
        * sourceDetail
        * (1.0 - erodedVoid);
      transformed.xy += fieldDirection * particleRegion
        * uOuterDispersion * distanceNoise * 0.075;
    } else if (uEffectMode == 1) {
      vec2 dustFlow = normalize(fieldDirection + radial * 0.34);
      transformed.xy += dustFlow * particleRegion * uOuterDispersion * (0.025 + distanceNoise * 0.055);
      transformed.y += sin(warpedPhase + aRandom * 9.0) * uDrift * 0.018 * particleRegion;
    } else if (uEffectMode == 2) {
      float pulse = 0.72 + 0.28 * sin(warpedPhase + aRandom * 4.0);
      transformed.xy += (radial * 0.74 + curl * (coarse - 0.5))
        * particleRegion * uOuterDispersion * (0.045 + distanceNoise * 0.075) * pulse;
      transformed.z += (coarse - 0.5) * particleRegion * uOuterDispersion * 0.16;
    } else if (uEffectMode == 3) {
      float scanLift = boundaryBand * (0.035 + randomVector.x * 0.045);
      transformed.x += scanLift * uOuterDispersion;
      transformed.y += (fine - 0.5) * scanLift * 0.5;
    } else if (uEffectMode == 4) {
      transformed.x += (coarse - 0.5) * particleRegion * uOuterDispersion * 0.09;
      transformed.y -= particleRegion * uOuterDispersion * (0.025 + distanceNoise * 0.08);
      transformed.z += (fine - 0.5) * particleRegion * 0.11;
    } else {
      float heat = sin(position.y * 18.0 + warpedPhase * 3.0 + aRandom * 8.0);
      transformed.x += heat * particleRegion * uWaveStrength * (0.22 + distanceNoise * 0.34);
      transformed.y += particleRegion * uOuterDispersion * (0.035 + distanceNoise * 0.12);
      transformed.z += (coarse - 0.5) * particleRegion * 0.12;
    }

    transformed.z += particleRegion * 0.15;
    float phase = warpedPhase + randomVector.x * 6.2831853;
    vec3 motion = vec3(sin(phase), cos(phase * 0.83), sin(phase * 0.57));
    transformed += (randomVector - 0.5) * uScatter * 0.085 * particleRegion;
    transformed += motion * uDrift * 0.05 * mix(0.1, 1.0, particleRegion);
    vec3 exitDirection = normalize(vec3(position.xy, 0.16 + randomVector.z));
    transformed += (exitDirection * (0.45 + randomVector * 0.7) + motion * 0.22)
      * uExit * (0.35 + dissolve);

    float srcLuminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float maxChannel = max(color.r, max(color.g, color.b));
    vec3 normalizedSource = color / max(0.08, maxChannel);
    vec3 luminousSource = color * max(1.0, 0.48 / max(0.08, maxChannel));
    float highlight = smoothstep(0.68, 0.96, srcLuminance) * max(aEdge, aBoundary);
    vColor = mix(luminousSource, color, uColorRetention);
    vColor = mix(vColor, normalizedSource * 1.08, highlight * 0.26);
    if (uEffectMode == 5) {
      vec3 ember = mix(vec3(0.98, 0.12, 0.015), vec3(1.0, 0.72, 0.12),
        clamp(srcLuminance + randomVector.x * 0.25, 0.0, 1.0));
      vColor = mix(vColor, ember, boundaryBand * (0.34 + (1.0 - uColorRetention) * 0.42));
    }

    float densityChance = mix(0.28, 0.94, sourceDetail)
      * mix(0.48, 1.0, boundaryBand + aBoundary * 0.45);
    if (uEffectMode == 4) densityChance *= 0.78;
    float densityGate = step(aRandom, min(0.98, densityChance * uDensity));
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float effectScale = 1.0;
    if (uEffectMode == 1) effectScale = 0.72;
    if (uEffectMode == 2) effectScale = 0.9 + boundaryBand * 0.35;
    if (uEffectMode == 4) effectScale = 0.64;
    if (uEffectMode == 5) effectScale = 0.72 + boundaryBand * 0.42;
    gl_PointSize = uPointSize * aScale * effectScale * (5.0 / max(1.0, -mvPosition.z));
    vAlpha = smoothstep(0.0, 0.18, uProgress) * aOpacity * particleRegion
      * densityGate * (1.0 - uExit);
    vTwinkle = 0.92 + sin(phase * 2.0) * 0.08 * mix(0.2, 1.0, particleRegion);
    vEmission = highlight * 0.38 + boundaryBand * (uEffectMode == 5 ? 0.42 : 0.14);
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkle;
  varying float vEmission;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered) * 2.0;
    if (distanceFromCenter > 1.0) discard;
    float alpha = (1.0 - smoothstep(0.38, 1.0, distanceFromCenter)) * vAlpha * vTwinkle;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor * (1.04 + vEmission), alpha);
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
  uniform int uEffectMode;
  uniform int uDissolveDirection;
  uniform float uDissolveProgress;
  uniform float uDissolveBandwidth;

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

  float directionScore(vec2 uv) {
    float radial = clamp(length((uv - 0.5) * vec2(1.0, 1.08)) * 1.52, 0.0, 1.0);
    if (uDissolveDirection == 1) return 1.0 - radial;
    if (uDissolveDirection == 2) return 1.0 - uv.x;
    if (uDissolveDirection == 3) return uv.y;
    if (uDissolveDirection == 4) return 1.0 - uv.y;
    return radial;
  }

  float effectDissolve(vec2 uv, vec2 loopOffset) {
    float coarse = valueNoise(uv * uNoiseScale + loopOffset * 0.16);
    float fine = valueNoise(uv * uNoiseScale * 3.71 - loopOffset * 0.11);
    float noise = (coarse * 0.66 + fine * 0.34 - 0.5) * uIrregularity;
    float threshold = 1.0 - uDissolveProgress;
    return smoothstep(
      threshold - uDissolveBandwidth,
      threshold + uDissolveBandwidth,
      directionScore(uv) + noise * 0.7
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
    float portraitInvasion = 1.0 - smoothstep(
      0.5 - uEdgeSoftness,
      0.5 + uEdgeSoftness,
      field
    );
    vInvasion = uEffectMode == 0
      ? portraitInvasion
      : effectDissolve(uv, loopOffset);

    vec3 transformed = position;
    float imageDepth = texture2D(uDepthMap, uv).r;
    float wave = (
      sin(position.x * uWaveScale * 3.1 + warpedPhase)
      + cos(position.y * uWaveScale * 2.35 - warpedPhase * 0.86)
    ) * 0.5;
    float motionMask = uEffectMode == 0
      ? mix(0.18, 0.9, vInvasion)
      : smoothstep(0.02, 0.72, vInvasion) * (1.0 - smoothstep(0.78, 1.0, vInvasion));
    transformed.xy += vec2(cos(warpedPhase + position.y * 2.1), sin(warpedPhase - position.x * 1.7))
      * wave * uWaveStrength * 0.15 * motionMask;
    transformed.z += wave * uWaveStrength * motionMask;
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
  uniform float uTime;
  uniform float uWaveStrength;
  uniform int uEffectMode;

  void main() {
    vec2 sampleUv = vUv;
    float boundary = smoothstep(0.08, 0.36, vInvasion)
      * (1.0 - smoothstep(0.58, 0.88, vInvasion));
    if (uEffectMode == 5) {
      float heat = sin(vUv.y * 75.0 + uTime * 4.2)
        + sin(vUv.y * 31.0 - uTime * 2.7);
      sampleUv.x += heat * uWaveStrength * 0.022 * boundary;
    }
    vec4 imageColor = texture2D(uImage, sampleUv);
    float contentMask = texture2D(uContentMask, sampleUv).r;
    float luminance = dot(imageColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float contentPresence = smoothstep(0.005, 0.12, contentMask);
    vec2 centeredUv = (vUv - 0.5) * 2.0;
    float automaticProtection = (1.0 - smoothstep(0.38, 1.02, length(centeredUv * vec2(0.9, 1.12))))
      * contentPresence;
    float effectiveInvasion = uEffectMode == 0
      ? vInvasion * (1.0 - automaticProtection * 0.98)
      : vInvasion;
    float darkPresence = smoothstep(
      uBrightnessThreshold * 0.5,
      max(0.12, uBrightnessThreshold + 0.08),
      luminance
    );
    float alphaMask = smoothstep(uAlphaThreshold, min(1.0, uAlphaThreshold + 0.08), imageColor.a);
    float entrance = smoothstep(0.02, 0.42, uProgress);
    float surfacePresence = uEffectMode == 0
      ? mix(1.0, 0.028, smoothstep(0.2, 0.94, effectiveInvasion))
      : 1.0 - smoothstep(0.08, 0.78, effectiveInvasion);
    float alpha = alphaMask * contentPresence * mix(0.48, 1.0, darkPresence)
      * surfacePresence * entrance * (1.0 - uExit);
    if (alpha < 0.008) discard;
    float blackening = uEffectMode == 0
      ? mix(1.2, 0.07, smoothstep(0.14, 0.96, effectiveInvasion))
      : mix(1.02, 0.18, smoothstep(0.05, 0.78, effectiveInvasion));
    vec3 outputColor = imageColor.rgb * blackening;
    if (uEffectMode == 5) {
      vec3 ember = mix(vec3(0.42, 0.025, 0.004), vec3(1.0, 0.4, 0.035), luminance);
      outputColor = mix(outputColor, ember, boundary * 0.32);
    }
    gl_FragColor = vec4(outputColor, alpha);
  }
`;

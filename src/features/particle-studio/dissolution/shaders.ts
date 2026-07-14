export const dissolutionParticleVertexShader = /* glsl */ `
  uniform float uInvasion;
  uniform float uBandwidth;
  uniform float uScatter;
  uniform float uPointSize;
  uniform float uNoise;
  uniform float uTime;
  uniform int uMode;
  uniform float uWaveStr;
  uniform float uWaveFreq;
  uniform int uEffect;

  attribute vec3 aColor;
  attribute vec2 aUV;
  attribute float aRnd;

  varying vec3 vCol;
  varying float vAlpha;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += vnoise(p) * a;
      p *= 2.1;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vCol = aColor;
    float dfc = length(aUV - 0.5) * 1.4142;
    float dissolveStart;
    if (uEffect == 1) dissolveStart = 1.0 - aUV.y;
    else if (uMode == 1) dissolveStart = dfc;
    else if (uMode == 2) dissolveStart = aUV.x;
    else if (uMode == 3) dissolveStart = aUV.y;
    else dissolveStart = 1.0 - dfc;

    float n = (fbm(aUV * 2.8 + uTime * 0.04) - 0.5) * uNoise * 2.2;
    float noisedStart = clamp(dissolveStart + n, 0.0, 1.0);
    float ds = smoothstep(noisedStart, noisedStart + uBandwidth, uInvasion);
    float alpha = smoothstep(0.0, 0.15, ds) * (1.0 - smoothstep(0.65, 1.0, ds));
    float scatterAge = uScatter * smoothstep(0.05, 0.7, ds);
    float angle = aRnd * 6.28318 + uTime * (0.12 + aRnd * 0.22);

    vec3 pos = position;
    pos.xy += vec2(cos(angle), sin(angle)) * scatterAge;
    float wt = uTime * 1.5;
    float waveAlive = (1.0 - ds) * uWaveStr * 0.4;
    pos.xy += vec2(
      sin(aUV.y * uWaveFreq + wt) * waveAlive,
      cos(aUV.x * uWaveFreq * 0.85 + wt * 0.8) * waveAlive
    );
    if (uEffect == 1) {
      float age = clamp(ds * 1.3, 0.0, 1.0);
      pos.y += age * age * 0.55;
      pos.x += sin(aRnd * 23.17 + uTime * 2.8 + aUV.y * 5.0) * 0.045 * age;
    }

    vAlpha = alpha * (0.55 + aRnd * 0.45);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPointSize;
  }
`;

export const dissolutionParticleFragmentShader = /* glsl */ `
  uniform int uEffect;
  varying vec3 vCol;
  varying float vAlpha;

  void main() {
    if (uEffect == 1) discard;
    vec2 cxy = gl_PointCoord * 2.0 - 1.0;
    float radius = dot(cxy, cxy);
    if (radius > 1.0) discard;
    float soft = 1.0 - smoothstep(0.3, 1.0, radius);
    gl_FragColor = vec4(vCol, vAlpha * soft);
  }
`;

export const dissolutionPlaneVertexShader = /* glsl */ `
  varying vec2 vUV;
  void main() {
    vUV = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const dissolutionPlaneFragmentShader = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uInvasion;
  uniform float uBandwidth;
  uniform float uNoise;
  uniform int uMode;
  uniform float uWaveStr;
  uniform float uWaveFreq;
  uniform float uTime;
  uniform int uEffect;
  varying vec2 vUV;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += vnoise(p) * a;
      p *= 2.1;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float dfc = length(vUV - 0.5) * 1.4142;
    float dissolveStart;
    if (uEffect == 1) dissolveStart = vUV.y;
    else if (uMode == 1) dissolveStart = dfc;
    else if (uMode == 2) dissolveStart = vUV.x;
    else if (uMode == 3) dissolveStart = 1.0 - vUV.y;
    else dissolveStart = 1.0 - dfc;

    float n = (fbm(vUV * 2.8 + uTime * 0.04) - 0.5) * uNoise * 2.2;
    float noisedStart = clamp(dissolveStart + n, 0.0, 1.0);
    float ds = smoothstep(noisedStart, noisedStart + uBandwidth, uInvasion);
    float wt = uTime * 1.5;
    float waveAlive = (1.0 - smoothstep(0.0, 0.35, ds)) * uWaveStr;
    vec2 warpedUv = vUV;
    warpedUv.x += sin(vUV.y * uWaveFreq + wt) * waveAlive;
    warpedUv.y += cos(vUV.x * uWaveFreq * 0.85 + wt * 0.8) * waveAlive;

    if (uEffect == 1) {
      float heatBand = smoothstep(0.0, 0.22, ds) * (1.0 - smoothstep(0.22, 0.68, ds));
      float heatStrength = heatBand * uWaveStr;
      warpedUv.x += sin(vUV.y * uWaveFreq + uTime * 5.0) * heatStrength;
      warpedUv.y -= abs(cos(vUV.x * uWaveFreq * 0.75 + uTime * 3.8)) * heatStrength * 2.2;
    }
    warpedUv = clamp(warpedUv, 0.001, 0.999);

    vec4 tex = texture2D(uTex, warpedUv);
    if (tex.a < 0.01) discard;
    float imageAlpha = tex.a * (1.0 - smoothstep(0.0, 0.42, ds));
    if (imageAlpha < 0.004) discard;

    if (uEffect == 1) {
      float edgeGlow = smoothstep(0.0, 0.18, ds) * (1.0 - smoothstep(0.18, 0.52, ds));
      vec3 ember = mix(vec3(1.0, 0.62, 0.08), vec3(1.0, 0.12, 0.0), edgeGlow);
      gl_FragColor = vec4(mix(tex.rgb, ember * 2.2, edgeGlow * 0.8), imageAlpha);
    } else {
      float shimmerA = sin(warpedUv.x * uWaveFreq * 4.0 + wt * 2.5) * 0.5 + 0.5;
      float shimmerB = sin(warpedUv.y * uWaveFreq * 3.2 - wt * 2.0) * 0.5 + 0.5;
      float shimmer = clamp(shimmerA * shimmerB * waveAlive * 14.0, 0.0, 0.4);
      vec3 iridescence = vec3(
        0.55 + 0.45 * sin(shimmerA * 6.28),
        0.55 + 0.45 * sin(shimmerA * 6.28 + 2.1),
        0.6 + 0.4 * sin(shimmerA * 6.28 + 4.2)
      );
      gl_FragColor = vec4(mix(tex.rgb, tex.rgb * iridescence * 1.7, shimmer), imageAlpha);
    }
  }
`;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const PARTICLE_LOOP_SECONDS = 5;

export function loopPhase(seconds: number, duration = PARTICLE_LOOP_SECONDS): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return 0;
  const wrapped = ((seconds % duration) + duration) % duration;
  return wrapped / duration;
}

export function dispersionForCoherence(coherence: number, amount: number): number {
  return Math.pow(1 - clamp01(coherence), 1.35) * Math.max(0, amount);
}

export function retainParticleColor(
  rgb: readonly [number, number, number],
  highlight: number,
  retention: number,
): [number, number, number] {
  const keep = clamp01(retention);
  const whitening = clamp01(highlight) * (1 - keep) * 0.58;
  return rgb.map((channel) => channel + (1 - channel) * whitening) as [number, number, number];
}

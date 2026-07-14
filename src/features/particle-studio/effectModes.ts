import type { DissolveDirection, ParticleEffectMode } from "./types";

const EFFECT_UNIFORMS: Record<ParticleEffectMode, number> = {
  portrait: 0,
  dust: 1,
  nebula: 2,
  linear: 3,
  fog: 4,
  fire: 5,
};

const DIRECTION_UNIFORMS: Record<DissolveDirection, number> = {
  "edge-in": 0,
  "center-out": 1,
  "left-to-right": 2,
  "top-to-bottom": 3,
  "bottom-to-top": 4,
};

export const effectModeToUniform = (mode: ParticleEffectMode): number => EFFECT_UNIFORMS[mode] ?? 0;

export const dissolveDirectionToUniform = (direction: DissolveDirection): number =>
  DIRECTION_UNIFORMS[direction] ?? 0;

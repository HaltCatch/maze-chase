import type { Pendulum } from '../content/maps.ts';
/** One phase function for server collision and client display; seconds since round start. */
export function pendulumPose(p: Pendulum, time: number) {
  const angle = Math.sin((time * Math.PI * 2) / p.period + p.phase) * 0.95;
  const offset = Math.sin(angle) * p.length;
  return {
    x: p.x + (p.axis === 'x' ? offset : 0),
    y: p.y - Math.cos(angle) * p.length,
    z: p.z + (p.axis === 'z' ? offset : 0),
    angle,
  };
}

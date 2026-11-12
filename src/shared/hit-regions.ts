// Compact server-side proxies measured from the authored standing/crouching rigs.
// Hats, hair tips and carried props do not enlarge the damage volume.
const adventurers: Record<string, { y: number; radius: number; halfHeight: number }> = {
  knight: { y: 1.25, radius: 0.35, halfHeight: 0.36 },
  rogue: { y: 1.32, radius: 0.39, halfHeight: 0.39 },
  mage: { y: 1.32, radius: 0.38, halfHeight: 0.39 },
  barbarian: { y: 1.32, radius: 0.38, halfHeight: 0.39 },
  ranger: { y: 1.3, radius: 0.38, halfHeight: 0.39 },
};
export type HitRegion = 'head' | 'body' | 'legs';
export const damageMultiplier: Record<HitRegion, number> = { head: 2, body: 1, legs: 0.75 };
type Target = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  kit?: { character?: string };
  input?: { quiet?: boolean };
};
export function bulletRegion(target: Target, x: number, y: number, z: number): HitRegion | null {
  const small = adventurers[target.kit?.character ?? ''];
  const crouch = !!target.input?.quiet;
  const headY = small ? small.y - (crouch ? 0.12 : 0) : crouch ? 1.02 : 1.61;
  const forward = crouch ? (small ? 0.25 : 0.19) : 0.02;
  const hx = target.x - Math.sin(target.yaw) * forward,
    hz = target.z - Math.cos(target.yaw) * forward;
  const radius = small?.radius ?? 0.155,
    halfHeight = small?.halfHeight ?? 0.17;
  const localY = y - target.y;
  if (((x - hx) ** 2 + (z - hz) ** 2) / radius ** 2 + (localY - headY) ** 2 / halfHeight ** 2 <= 1)
    return 'head';
  if (
    localY < 0.1 ||
    localY > headY - halfHeight * 0.72 ||
    Math.hypot(x - target.x, z - target.z) >= 0.26
  )
    return null;
  return localY < (small ? 0.34 : crouch ? 0.38 : 0.65) ? 'legs' : 'body';
}

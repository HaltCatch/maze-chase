import type { Collider } from './maps.ts';
/** Collision hull for a staircase's smooth walking surface; artwork remains the authored GLB. */
export function rampGeometry(c: Collider) {
  const x = c.width / 2,
    y = c.height / 2,
    z = c.depth / 2,
    sign = c.ramp === 'negative-z' ? -1 : 1;
  const positions = [-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, -x, y, z, x, y, z];
  for (let i = 2; i < positions.length; i += 3) positions[i] *= sign;
  const indices = [0, 2, 1, 0, 3, 2, 3, 5, 2, 3, 4, 5, 0, 4, 3, 1, 2, 5, 0, 1, 5, 0, 5, 4];
  if (sign < 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return { positions, indices };
}

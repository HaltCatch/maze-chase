import type { Collider, MapDefinition, Point } from '../content/maps.ts';
export function stairHeight(c: Collider, z: number) {
  const t = Math.max(0, Math.min(1, (z - c.z) / c.depth + 0.5));
  return c.y - c.height / 2 + c.height * (c.ramp === 'positive-z' ? t : 1 - t);
}
export function stairAt(map: MapDefinition, p: Point & { grounded?: boolean }) {
  if (!p.grounded) return undefined;
  return map.colliders.find(
    (c) =>
      c.ramp &&
      Math.abs(p.x - c.x) < c.width / 2 + 0.1 &&
      Math.abs(p.z - c.z) < c.depth / 2 + 0.1 &&
      Math.abs(p.y - stairHeight(c, p.z)) < 0.18,
  );
}

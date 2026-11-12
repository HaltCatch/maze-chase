import type { MapDefinition, Point } from './maps.ts';
export type Bounds = { min: Point; max: Point };
/** Static scenery must clear platform geometry, headroom and jump approaches.
 * Uses the loaded model's world AABB, including its canopy and rotation.
 * Evaluated once at load time; never changes course physics or adds frame work.
 */
export function sceneryBlocksCourse(map: MapDefinition, bounds: Bounds) {
  const overlaps = (min: Point, max: Point) =>
    bounds.min.x < max.x &&
    bounds.max.x > min.x &&
    bounds.min.y < max.y &&
    bounds.max.y > min.y &&
    bounds.min.z < max.z &&
    bounds.max.z > min.z;
  if (
    map.colliders.some((c) =>
      overlaps(
        { x: c.x - c.width / 2 - 1.4, y: c.y - c.height / 2 - 0.3, z: c.z - c.depth / 2 - 1.4 },
        { x: c.x + c.width / 2 + 1.4, y: c.y + c.height / 2 + 3, z: c.z + c.depth / 2 + 1.4 },
      ),
    )
  )
    return true;
  // Keep a clear ground approach to the return stairs and the initial platform.
  const spawn = map.spawn;
  return (
    !!spawn &&
    overlaps(
      { x: spawn.x - 3, y: map.groundY ?? -3, z: spawn.z - 3 },
      { x: spawn.x + 3, y: spawn.y + 3, z: spawn.z + 16 },
    )
  );
}

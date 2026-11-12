import { arenas } from '../shared/docks.js';

export interface Point {
  x: number;
  y: number;
  z: number;
}
export interface Collider extends Point {
  id: string;
  width: number;
  height: number;
  depth: number;
  surface: string;
  ramp?: 'positive-z' | 'negative-z';
  model?: 'ascent-stairs' | 'ascent-bridge' | 'ascent-bounce';
  bounce?: number;
  shape?: 'sphere';
  climbable: boolean;
}
export interface Pendulum extends Point {
  id: string;
  axis: 'x' | 'z';
  length: number;
  radius: number;
  period: number;
  phase: number;
}
export interface MapDefinition {
  id: string;
  grid: string[];
  size: number;
  colliders: Collider[];
  climbable: boolean;
  ground?: boolean;
  groundY?: number;
  killY?: number;
  spawn?: Point;
  checkpoints?: Point[];
  spawnYaw?: number;
  environment?: 'forest';
  collectibles?: (Point & { id: string })[];
  obstacles?: Pendulum[];
  pickups?: (Point & {
    id: string;
    kind: 'rocket' | 'refill' | 'shield' | 'double-jump';
    ammo?: number;
  })[];
}
const definitions = new WeakMap<string[], MapDefinition>();
/** One geometry contract for drawing, Havok, projectiles and AI sight. Units: metres. */
export function defineMap(grid: string[], arena?: string): MapDefinition {
  const cached = definitions.get(grid);
  if (cached && (!arena || cached.id === arena)) return cached;
  const size = Math.max(grid.length, grid[0]?.length ?? 0),
    colliders: Collider[] = [];
  const add = (
    id: string,
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    surface: string,
    climbable = false,
  ) =>
    colliders.push({
      id,
      x: x + w / 2,
      y: h / 2,
      z: z + d / 2,
      width: w,
      height: h,
      depth: d,
      surface,
      climbable,
    });
  if (
    arena &&
    grid.length === 25 &&
    grid.every((row) => row.length === 25) &&
    Object.hasOwn(arenas, arena)
  ) {
    const layout = arenas[arena as keyof typeof arenas];
    for (const [i, b] of layout.blocks.entries()) {
      const h =
        b.paint === 'wagon'
          ? 2.45
          : b.paint === 'depot'
            ? 3.37
            : arena === 'docks' && (i % 6 === 2 || i % 6 === 3)
              ? 3.2
              : 1.96;
      add('block-' + i, b.x, b.z, b.w, b.d, h, b.paint);
    }
    add('north', 0, 0, size, 1, 3.4, 'concrete');
    add('south', 0, size - 1, size, 1, 3.4, 'concrete');
    add('west', 0, 1, 1, size - 2, 3.4, 'concrete');
    add('east', size - 1, 1, 1, size - 2, 3.4, 'concrete');
    for (const [i, [x, z]] of layout.hurdles.entries())
      add('hurdle-' + i, x, z + 0.34, 1, 0.32, 0.23, 'concrete');
  } else {
    // Merge contiguous walls, retaining the exact authored footprint and climb policy.
    for (let z = 0; z < grid.length; z++)
      for (let x = 0; x < grid[z].length; x++) {
        if (grid[z][x] !== '#') continue;
        const edge = z === 0 || z === grid.length - 1 || x === 0 || x === grid[z].length - 1;
        let end = x + 1;
        while (
          end < grid[z].length &&
          grid[z][end] === '#' &&
          (z === 0 || z === grid.length - 1 || end === grid[z].length - 1) === edge
        )
          end++;
        add('wall-' + x + '-' + z, x, z, end - x, 1, edge ? 3.4 : 2.05, 'brick', !edge);
        x = end - 1;
      }
  }
  const definition = { id: arena ?? 'maze', grid, size, colliders, climbable: !arena };
  definitions.set(grid, definition);
  return definition;
}
export function inside(c: Collider, x: number, y: number, z: number, padding = 0) {
  return (
    Math.abs(x - c.x) < c.width / 2 + padding &&
    Math.abs(y - c.y) < c.height / 2 + padding &&
    Math.abs(z - c.z) < c.depth / 2 + padding
  );
}
export function obstructed(def: MapDefinition, x: number, y: number, z: number) {
  return (
    y <= 0 ||
    x < 0 ||
    z < 0 ||
    x >= def.size ||
    z >= def.size ||
    def.colliders.some((c) => inside(c, x, y, z))
  );
}
export function rayBox(from: Point, to: Point, c: Collider): number | null {
  let near = 0,
    far = 1;
  for (const [axis, extent] of [
    ['x', c.width],
    ['y', c.height],
    ['z', c.depth],
  ] as const) {
    const d = to[axis] - from[axis],
      lo = c[axis] - extent / 2,
      hi = c[axis] + extent / 2;
    if (Math.abs(d) < 1e-9) {
      if (from[axis] < lo || from[axis] > hi) return null;
      continue;
    }
    let a = (lo - from[axis]) / d,
      b = (hi - from[axis]) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return near;
}
export const hasLineOfSight = (def: MapDefinition, a: Point, b: Point) =>
  !def.colliders.some((c) => rayBox(a, b, c) !== null);

export function registerMap(definition: MapDefinition) {
  definitions.set(definition.grid, definition);
  return definition;
}

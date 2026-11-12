import type { Collider, MapDefinition } from './maps.ts';
import { forestBounds } from './forest-bounds.ts';
import { sceneryBlocksCourse, type Bounds } from './scenery-clearance.ts';
export type ForestModel = keyof typeof forestBounds;
export interface ForestProp {
  id: string;
  model: ForestModel;
  x: number;
  z: number;
  height: number;
  yaw: number;
  bounds: Bounds;
  solid?: Collider;
}
/** One deterministic layout for drawing and Havok; actual shipped mesh bounds are
 * measured offline. Stairs, jump approaches and previously placed props stay clear. */
export function forestLayout(map: MapDefinition): ForestProp[] {
  if (map.environment !== 'forest') return [];
  const ground = map.groundY ?? -3;
  const route = { ...map, colliders: map.colliders.filter((c) => c.surface !== 'scenery') };
  const props: ForestProp[] = [];
  function place(model: ForestModel, x: number, z: number, height: number, yaw = 0) {
    const authored = forestBounds[model];
    const scale = height / (authored.max[1] - authored.min[1]);
    const width = (authored.max[0] - authored.min[0]) * scale;
    const depth = (authored.max[2] - authored.min[2]) * scale;
    // Conservative rotated AABB; the rendering adapter rechecks real mesh bounds.
    const w = Math.abs(Math.cos(yaw)) * width + Math.abs(Math.sin(yaw)) * depth;
    const d = Math.abs(Math.sin(yaw)) * width + Math.abs(Math.cos(yaw)) * depth;
    const bounds = {
      min: { x: x - w / 2, y: ground, z: z - d / 2 },
      max: { x: x + w / 2, y: ground + height, z: z + d / 2 },
    };
    if (bounds.min.x < 0 || bounds.min.z < 0 || bounds.max.x > map.size || bounds.max.z > map.size)
      return;
    if (sceneryBlocksCourse(route, bounds)) return;
    if (
      props.some(
        (p) =>
          bounds.min.x < p.bounds.max.x + 0.15 &&
          bounds.max.x > p.bounds.min.x - 0.15 &&
          bounds.min.z < p.bounds.max.z + 0.15 &&
          bounds.max.z > p.bounds.min.z - 0.15,
      )
    )
      return;
    const id = 'forest-prop-' + props.length;
    let solid: Collider | undefined;
    if (model !== 'forest-fern') {
      const tree = model === 'forest-pine' || model === 'forest-fir';
      const cx = ((authored.max[0] + authored.min[0]) / 2) * scale;
      const cz = ((authored.max[2] + authored.min[2]) / 2) * scale;
      solid = {
        id,
        x: tree ? x - Math.cos(yaw) * cx - Math.sin(yaw) * cz : x,
        z: tree ? z + Math.sin(yaw) * cx - Math.cos(yaw) * cz : z,
        y: ground + (tree ? height * 0.38 : height) / 2,
        width: tree ? height * 0.035 : w,
        depth: tree ? height * 0.035 : d,
        height: tree ? height * 0.38 : height,
        surface: 'scenery',
        climbable: false,
      };
    }
    props.push({ id, model, x, z, height, yaw, bounds, solid });
  }
  // Village clearing, then a forest edge and scattered undergrowth.
  for (const [x, z, model, h, yaw] of [
    [26, 27, 'forest-house', 4.5, 0],
    [39, 26, 'forest-house-alt', 5, Math.PI / 2],
    [25, 40, 'forest-tower', 7, 0],
    [39, 39, 'forest-house', 4.8, Math.PI],
  ] as const)
    place(model, x, z, h, yaw);
  for (let i = 0; i < 40; i++) {
    const a = (i * Math.PI * 2) / 40;
    place(
      i % 3 ? 'forest-fir' : 'forest-pine',
      32 + Math.cos(a) * (27 + Math.sin(i * 2.1) * 2),
      32 + Math.sin(a) * (25 + Math.cos(i * 1.7) * 2),
      (i % 3 ? 6 : 4.5) + (i % 4) * 0.7,
      i * 0.8,
    );
  }
  for (let i = 0; i < 36; i++) {
    const a = i * 2.4,
      r = 4 + (i % 7) * 1.8;
    place(
      i % 6 === 0 ? 'forest-stump' : i % 3 ? 'forest-fern' : 'forest-rock',
      32 + Math.cos(a) * r,
      32 + Math.sin(a) * r,
      0.5 + (i % 3) * 0.35,
      i,
    );
  }
  for (let i = 0; i < 24; i++)
    place('forest-fern', 16 + (i % 6) * 6.5, 12 + Math.floor(i / 6) * 12, 0.45, i);
  return props;
}

import { ascentMap } from './ascent-map.ts';
import type { MapDocument } from './map-document.ts';
const platform = (
  id: string,
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  surface: 'steel' | 'oxide' | 'concrete' = 'steel',
) => ({ id, x, y: y - 0.2, z, width, height: 0.4, depth, surface, climbable: false });
export const parkourMaps: Record<string, MapDocument> = {
  ascent: ascentMap(),
  skyline: {
    version: 1,
    id: 'skyline',
    name: '云端跃迁',
    size: 32,
    ground: false,
    spawn: { x: 5, y: 2, z: 5 },
    checkpoints: [
      { x: 11, y: 2.4, z: 5 },
      { x: 17, y: 3, z: 9 },
      { x: 23, y: 3.5, z: 14 },
    ],
    colliders: [
      platform('start', 5, 2, 5, 4, 4, 'concrete'),
      platform('step-1', 8.2, 2.2, 5, 1.8, 2),
      platform('check-1', 11, 2.4, 5, 2.6, 3),
      platform('step-2', 13.7, 2.7, 6.5, 1.7, 2),
      platform('check-2', 17, 3, 9, 3, 3, 'oxide'),
      platform('step-3', 19.5, 3.2, 11.5, 2, 2),
      platform('finish', 23, 3.5, 14, 4, 4, 'concrete'),
    ],
  },
  foundry: {
    version: 1,
    id: 'foundry',
    name: '熔炉试炼',
    size: 36,
    ground: false,
    spawn: { x: 5, y: 2, z: 5 },
    checkpoints: [
      { x: 5, y: 2.6, z: 12 },
      { x: 12, y: 3.2, z: 18 },
      { x: 20, y: 4, z: 23 },
    ],
    colliders: [
      platform('start', 5, 2, 5, 4, 4, 'concrete'),
      platform('step-1', 5, 2.3, 8.5, 2, 2, 'oxide'),
      platform('check-1', 5, 2.6, 12, 3, 3),
      platform('step-2', 7.5, 2.9, 14.5, 2, 2, 'oxide'),
      platform('check-2', 12, 3.2, 18, 4, 4),
      platform('step-3', 15.8, 3.5, 20.6, 2, 2, 'oxide'),
      platform('finish', 20, 4, 23, 4, 4, 'concrete'),
    ],
  },
};

// Short courses also use the same coin-race objective; no empty all-zero scoreboard.
for (const map of Object.values(parkourMaps))
  map.collectibles ??= map.colliders
    .filter((c) => !c.ramp && c.id !== 'start')
    .map((c) => ({ id: 'coin-' + c.id, x: c.x, y: c.y + c.height / 2 + 0.65, z: c.z }));

// Collision and rendering share the same footprints.
export const DOCKS_SIZE = 25;
const blocks = (entries) =>
  entries.flatMap(([x, z, w, d, paint]) => [
    { x, z, w, d, paint },
    { x: DOCKS_SIZE - x - w, z: DOCKS_SIZE - z - d, w, d, paint },
  ]);
export const arenas = {
  docks: {
    name: '封锁码头',
    blocks: blocks([
      [3, 5, 2, 5, 'steel'],
      [7, 3, 5, 2, 'oxide'],
      [9, 7, 2, 3, 'steel'],
      [4, 11, 5, 2, 'olive'],
      [3, 17, 5, 2, 'oxide'],
      [8, 16, 2, 4, 'steel'],
      [11, 11, 1, 3, 'oxide'],
    ]),
    shelters: [
      [5, 14.5, 6.4, 3],
      [20, 10.5, 6.4, 3],
    ],
    hurdles: [
      [6, 8],
      [18, 16],
    ],
  },
  // Three parallel lanes and split dividers adapted from Arena warehouse.js (MIT).
  // Rebuilt on our authoritative metre grid; no unsupported catwalk collision.
  warehouse: {
    name: '三线仓库',
    blocks: blocks([
      [7, 5, 2, 6, 'steel'],
      [16, 5, 2, 6, 'steel'],
      [3, 10, 2, 2, 'olive'],
      [11, 7, 2, 2, 'oxide'],
      [19, 8, 2, 2, 'olive'],
    ]),
    shelters: [
      [4, 12.5, 5, 21],
      [21, 12.5, 5, 21],
    ],
    hurdles: [
      [12, 10],
      [12, 14],
    ],
  },
  relay: {
    name: '中继站',
    blocks: blocks([
      [4, 5, 4, 3, 'depot'],
      [17, 6, 3, 4, 'steel'],
      [8, 10, 2, 5, 'olive'],
      [4, 15, 3, 2, 'oxide'],
      [10, 5, 2, 2, 'steel'],
    ]),
    shelters: [
      [6, 6.5, 6, 5],
      [19, 18.5, 6, 5],
    ],
    hurdles: [
      [5, 12],
      [19, 12],
    ],
  },
  rail: {
    name: '旧铁路货站',
    blocks: blocks([
      [4, 5, 3, 8, 'wagon'],
      [8, 7, 2, 4, 'steel'],
      [14, 4, 4, 2, 'depot'],
      [16, 9, 5, 2, 'steel'],
      [14, 18, 2, 2, 'olive'],
      [10, 14, 1, 3, 'steel'],
    ]),
    shelters: [
      [5, 8, 7, 9],
      [20, 17, 7, 9],
    ],
    hurdles: [
      [12, 8],
      [12, 16],
    ],
  },
};
export const docksSpawn = [
  { x: 12.5, z: 2.5, yaw: Math.PI },
  { x: 12.5, z: 22.5, yaw: 0 },
];
export const docksCores = [
  { x: 12.5, z: 12.5 },
  { x: 10.5, z: 12.5 },
  { x: 14.5, z: 12.5 },
];
export const docksDrops = [
  { x: 3.5, z: 3.5, name: '北仓' },
  { x: 21.5, z: 21.5, name: '南仓' },
  { x: 21.5, z: 3.5, name: '东门' },
  { x: 3.5, z: 21.5, name: '西门' },
];

export function docksMap(arena) {
  const size = DOCKS_SIZE;
  const map = Array.from({ length: size }, (_, z) =>
    Array.from({ length: size }, (_, x) =>
      x === 0 || z === 0 || x === size - 1 || z === size - 1 ? '#' : '.',
    ),
  );
  for (const { x, z, w, d } of arenas[arena].blocks) {
    for (let row = z; row < z + d; row++) for (let col = x; col < x + w; col++) map[row][col] = '#';
  }
  for (const [x, z] of arenas[arena].hurdles) if (map[z][x] === '.') map[z][x] = '+';
  return map.map((row) => row.join(''));
}

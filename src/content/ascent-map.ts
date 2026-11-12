import type { MapDocument } from './map-document.ts';
/** Authored crossing traverses, not a spiral. Fixed coordinates keep races fair.
 * An early spring pickup unlocks air jumps needed for the later coin islands. */
export function ascentMap(): MapDocument {
  const map: MapDocument = {
    version: 1,
    id: 'ascent',
    name: '林间天梯',
    size: 64,
    ground: true,
    groundY: -3,
    environment: 'forest',
    spawn: { x: 10, y: 2, z: 12 },
    spawnYaw: 0,
    checkpoints: [],
    colliders: [],
    collectibles: [],
    obstacles: [],
    pickups: [],
  };
  const anchors = [
    [10, 12],
    [42, 10],
    [42, 40],
    [18, 48],
    [12, 22],
    [40, 22],
    [36, 51],
    [18, 29],
    [46, 42],
  ];
  const route: { x: number; y: number; z: number }[] = [];
  const widths = [4.6, 2.8, 2.6, 3.2, 2.8, 3.0];
  const rises = [0.35, 0.65, 0.4, 0.55, 0.3, 0.7];
  const offsets = [0, 1.1, -0.6, 1.4, -1, 0.5, 0];
  const fractions = [0, 0.15, 0.32, 0.49, 0.65, 0.83, 1];
  let height = 2;
  function platform(
    id: string,
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    surface: MapDocument['colliders'][number]['surface'],
  ) {
    map.colliders.push({
      id,
      x,
      y: y - 0.35,
      z,
      width,
      height: 0.7,
      depth,
      surface,
      climbable: false,
    });
  }
  for (let section = 0; section < 8; section++) {
    const [ax, az] = anchors[section],
      [bx, bz] = anchors[section + 1];
    const length = Math.hypot(bx - ax, bz - az),
      nx = -(bz - az) / length,
      nz = (bx - ax) / length;
    for (let step = section === 0 ? 0 : 1; step <= 6; step++) {
      if (step && section !== 1 && section !== 4) height += rises[(step - 1 + section) % 6];
      const t = fractions[step],
        bend = section === 1 || section === 4 ? 0 : offsets[step] * (section % 2 ? -1 : 1);
      const x = ax + (bx - ax) * t + nx * bend,
        z = az + (bz - az) * t + nz * bend;
      const p = { x, y: Number(height.toFixed(3)), z },
        index = route.length;
      route.push(p);
      const rest = step === 0 || step === 6;
      platform(
        'route-' + index,
        x,
        p.y,
        z,
        rest ? 4.6 : widths[step],
        rest ? 4.6 : widths[(step + section) % 6] === 4.6 ? 3 : widths[(step + section) % 6],
        (['brick', 'wood', 'olive', 'concrete'] as const)[(section + step) % 4],
      );
      if (step === 6) map.checkpoints.push(p);
      if (step === 2 || step === 5)
        map.collectibles!.push({ id: 'coin-' + index, x, y: p.y + 0.65, z });
    }
  }
  // The final climb starts with a 1.8 m rise and a longer gap: the spring ability is required.
  // Remaining steps retain small, accurate landing targets.
  const finalBase = route.at(-1)!;
  for (let step = 1; step <= 10; step++) {
    const p = {
      x: finalBase.x,
      y: Number((finalBase.y + 1.05 + step * 0.75).toFixed(3)),
      z: finalBase.z - 3 - step * 3.2,
    };
    const rest = step % 5 === 0,
      index = route.length;
    platform(
      'route-' + index,
      p.x,
      p.y,
      p.z,
      rest ? 3.6 : 1.9,
      rest ? 3.6 : 1.8,
      step % 2 ? 'concrete' : 'olive',
    );
    route.push(p);
    if (rest) map.checkpoints.push(p);
    if (step % 2 === 0)
      map.collectibles!.push({ id: 'summit-coin-' + step, x: p.x, y: p.y + 0.65, z: p.z });
  }
  // Traverses interrupt the ascent: one rope bridge and one exposed balance beam.
  for (const [start, end, axis] of [
    [6, 12, 'z'],
    [24, 30, 'x'],
  ] as const) {
    for (let i = start + 1; i < end; i++) {
      const c = map.colliders[i];
      if (axis === 'z') c.width = 1.15;
      else c.depth = 1.05;
    }
    for (let i = start; i < end; i++) {
      const a = route[i],
        b = route[i + 1];
      const from = map.colliders.find((c) => c.id === 'route-' + i)!,
        to = map.colliders.find((c) => c.id === 'route-' + (i + 1))!;
      const fromEdge = a[axis] + (axis === 'x' ? from.width : from.depth) / 2;
      const toEdge = b[axis] - (axis === 'x' ? to.width : to.depth) / 2;
      const gap = toEdge - fromEdge;
      const width = axis === 'x' ? gap : 0.85,
        depth = axis === 'z' ? gap : 0.75;
      // Exact butt joints: do not draw a second coplanar bridge under the landing pads.
      platform(
        'walkway-' + i,
        axis === 'x' ? (fromEdge + toEdge) / 2 : a.x,
        a.y,
        axis === 'z' ? (fromEdge + toEdge) / 2 : a.z,
        width,
        depth,
        'wood',
      );
      const c = map.colliders.at(-1)!;
      if (axis === 'z') c.model = 'ascent-bridge';
    }
    for (let i = 0; i < 5; i++) {
      const p = route[start + 1 + i];
      map.obstacles!.push({
        id: `pendulum-${start}-${i}`,
        x: p.x,
        y: p.y + 4.2,
        z: p.z,
        length: 3.35,
        radius: 0.58,
        axis: axis === 'z' ? 'x' : 'z',
        period: 2.6 + i * 0.12,
        phase: (i * 1.8) % (Math.PI * 2),
      });
    }
  }
  map.spawn = route[0];
  map.spawnYaw = Math.atan2(-(route[1].x - route[0].x), -(route[1].z - route[0].z));
  // Two returning detours: same surfaces as the main path, coins beyond the junction.
  // They bend away from the route and return before the next save rather than ending in a trap.
  for (const [start, sign] of [
    [8, 1],
    [32, -1],
  ] as const) {
    const a = route[start],
      b = route[start + 2],
      dx = b.x - a.x,
      dz = b.z - a.z,
      l = Math.hypot(dx, dz);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4,
        offset = Math.sin(t * Math.PI) * 4 * sign;
      const x = a.x + dx * t - (dz / l) * offset,
        z = a.z + dz * t + (dx / l) * offset,
        y = a.y + (b.y - a.y) * t;
      platform(`branch-${start}-${i}`, x, y, z, 2.8, 2.8, i % 2 ? 'wood' : 'brick');
      if (i === 2) map.collectibles!.push({ id: `branch-coin-${start}`, x, y: y + 0.65, z });
    }
  }
  // These remote coin islands require the spring pickup collected earlier on route 4.
  for (const [index, sign] of [
    [12, 1],
    [36, -1],
  ] as const) {
    const p = route[index],
      x = p.x + sign * 9.2,
      y = p.y + 0.75,
      z = p.z;
    platform('challenge-' + index, x, y, z, 2.8, 3.2, 'olive');
    map.collectibles!.push({ id: 'challenge-coin-' + index, x, y: y + 0.65, z });
  }
  // Authored stone stairs use smooth convex collision under the twelve visible treads.
  for (const [index, sign] of [
    [6, -1],
    [24, -1],
  ] as const) {
    const p = route[index],
      base = p.y,
      z = p.z + sign * 3.5;
    map.colliders.push({
      id: `stair-${index}`,
      x: p.x,
      y: base + 0.96,
      z,
      width: 2.4,
      height: 1.92,
      depth: 3.6,
      surface: 'concrete',
      climbable: false,
      model: 'ascent-stairs',
      ramp: sign > 0 ? 'positive-z' : 'negative-z',
    });
    const topZ = p.z + sign * 6.7,
      top = base + 1.92;
    platform('bonus-' + index, p.x, top, topZ, 2.4, 2.8, 'brick');
    map.collectibles!.push({ id: 'bonus-coin-' + index, x: p.x, y: top + 0.65, z: topZ });
  }
  // Optional balloon chain: a high first rebound, two aerial steering transfers,
  // then a reward terrace with a descending return to the ordinary route.
  const entry = route[18];
  for (const [id, x, y, z] of [
    ['a', 18, entry.y + 0.25, 52],
    ['b', 23, entry.y + 1.75, 52.5],
    ['c', 22.5, entry.y + 3, 49.2],
  ] as const) {
    map.colliders.push({
      id: 'balloon-' + id,
      x,
      y: y - 1.5,
      z,
      width: 3,
      height: 3,
      depth: 3,
      surface: 'olive',
      climbable: false,
      model: 'ascent-bounce',
      bounce: 11.5,
    });
    map.collectibles!.push({ id: 'balloon-coin-' + id, x, y: y + 0.65, z });
  }
  platform('balloon-landing', 21, entry.y + 2.5, 43, 3.2, 3.2, 'brick');
  map.collectibles!.push({ id: 'balloon-reward', x: 21, y: entry.y + 3.15, z: 43 });
  for (const [index, kind] of [
    [2, 'shield'],
    [5, 'refill'],
    [13, 'rocket'],
    [18, 'shield'],
    [23, 'refill'],
    [31, 'rocket'],
    [37, 'shield'],
    [43, 'refill'],
    [48, 'rocket'],
    [53, 'refill'],
  ] as const) {
    const p = route[index];
    map.pickups!.push({ id: 'item-' + index, kind, x: p.x + 0.35, y: p.y + 0.65, z: p.z });
  }
  const spring = route[4];
  map.pickups!.push({
    id: 'air-jump-spring',
    kind: 'double-jump',
    x: spring.x,
    y: spring.y + 0.65,
    z: spring.z,
  });
  const summit = route.at(-1)!;
  const summitPlatform = map.colliders.find((c) => c.id === 'route-' + (route.length - 1))!;
  summitPlatform.width = 6;
  summitPlatform.depth = 4.6;
  // Separate the coin, trophy and launcher, including their collection radii.
  map.collectibles!.find((c) => c.id === 'summit-coin-10')!.x = summit.x - 1.8;
  map.pickups!.push({
    id: 'summit-launcher',
    kind: 'rocket',
    ammo: 3,
    x: summit.x + 2,
    y: summit.y + 0.65,
    z: summit.z,
  });
  // Ground remains walkable, including the stairs. Only a fall from elevated
  // support returns the player to the start; walking down does not trigger it.
  for (let i = 0; i < 3; i++)
    map.colliders.push({
      id: 'return-stairs-' + i,
      x: 10,
      y: 2 - (i + 0.5) * (5 / 3),
      z: 15.9 + i * 3.2,
      width: 3,
      depth: 3.2,
      height: 5 / 3,
      surface: 'concrete',
      climbable: false,
      model: 'ascent-stairs',
      ramp: 'negative-z',
    });
  return map;
}

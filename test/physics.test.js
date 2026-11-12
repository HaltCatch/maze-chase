import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PhysicsWorld, initPhysics } from '../src/engine/physics.ts';
import { defineMap } from '../src/content/maps.ts';
import { parkourMaps, mapFromDocument, mapDocumentSchema } from '../src/content/map-document.ts';
import { Parkour } from '../src/server/modes/parkour.ts';
import { stepMovement } from '../src/network/movement.ts';
import { readMovement } from '../src/shared/protocol.ts';
import { forestLayout } from '../src/content/forest-layout.ts';
import { ascentMap } from '../src/content/ascent-map.ts';
const havok = await initPhysics(
  await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))),
);
const player = (spawn = { x: 3, y: 0, z: 3 }) => ({
  ...spawn,
  id: 'test',
  name: 'test',
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  jumpAck: 0,
  energy: 1,
  recovery: 0,
  exhausted: false,
  input: readMovement({}),
});
const command = { moveX: 0, moveZ: 0, yaw: 0, run: false, quiet: false, jump: 0 };
const advance = (w, p, cmd, n) => {
  for (let i = 0; i < n; i++) stepMovement(p, cmd, w, 0.05);
};
test('forest village and tree trunks block sprinting players with the same map used for rendering', () => {
  const document = ascentMap(),
    original = structuredClone(document);
  const map = mapFromDocument(document),
    w = new PhysicsWorld(map, havok);
  try {
    assert.deepEqual(document, original, 'generated scenery must not modify editor documents');
    for (const model of [
      'forest-house',
      'forest-house-alt',
      'forest-tower',
      'forest-pine',
      'forest-fir',
    ]) {
      const prop = forestLayout(map).find((p) => p.model === model);
      assert.ok(prop?.solid, model + ' requires a physical obstacle');
      const c = prop.solid,
        left = c.x - c.width / 2;
      const p = player({ x: left - 1, y: map.groundY, z: c.z });
      advance(w, p, { ...command, moveX: 1, run: true }, 30);
      assert.ok(p.x < left, model + ': capsule entered the mesh');
      assert.ok(p.x > left - 0.5, model + ': collider must remain close to the visible obstacle');
    }
  } finally {
    w.dispose();
  }
});
test('Havok capsule stops at walls at sprint speed and lands after a jump', () => {
  const w = new PhysicsWorld(
      defineMap(['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######']),
      havok,
    ),
    p = player();
  try {
    advance(w, p, { ...command, moveZ: 1, run: true }, 80);
    assert.ok(p.z >= 1.21 && p.z < 1.3);
    assert.ok(Math.abs(p.y) < 0.03);
    advance(w, p, command, 3);
    stepMovement(p, { ...command, jump: 1 }, w, 0.05);
    let peak = p.y;
    for (let i = 0; i < 30; i++) {
      advance(w, p, { ...command, jump: 1 }, 1);
      peak = Math.max(peak, p.y);
    }
    assert.ok(peak > 0.8 && peak < 1.1);
    assert.ok(Math.abs(p.y) < 0.03);
    assert.ok(p.grounded);
  } finally {
    w.dispose();
  }
});
test('all built-in parkour documents have safe spawns and falls restart from the beginning', () => {
  for (const [id, map] of Object.entries(parkourMaps)) {
    assert.ok(mapDocumentSchema.safeParse(map).success, id);
    const mode = new Parkour(map, id),
      w = new PhysicsWorld(mode.map, havok),
      p = player(mode.map.spawn);
    try {
      advance(w, p, command, 20);
      assert.ok(Math.abs(p.y - map.spawn.y) < 0.02);
      Object.assign(p, map.checkpoints[0], { grounded: true });
      mode.tick(p, Date.now());
      assert.equal(p.checkpoint, 1);
      p.y = mode.map.killY - 1;
      mode.tick(p, Date.now());
      assert.equal(p.falls, 1);
      assert.equal(p.y, map.spawn.y);
      assert.equal(p.checkpoint, 0);
    } finally {
      w.dispose();
    }
  }
});
test('editor rejects obstructed spawns, floating checkpoints and duplicate object IDs', () => {
  for (const mutate of [
    (m) => (m.spawn.y += 3),
    (m) => (m.colliders[1].id = m.colliders[0].id),
    (m) => m.colliders.push({ ...m.colliders[0], id: 'ceiling', y: m.spawn.y + 1 }),
  ]) {
    const map = structuredClone(parkourMaps.skyline);
    mutate(map);
    assert.equal(mapDocumentSchema.safeParse(map).success, false);
  }
});
test('same fixed input stream gives matching Havok prediction and authority', () => {
  const map = mapFromDocument(parkourMaps.skyline),
    a = new PhysicsWorld(map, havok),
    b = new PhysicsWorld(map, havok),
    p = player(map.spawn),
    q = player(map.spawn);
  try {
    for (let i = 0; i < 160; i++) {
      const cmd = {
        ...command,
        moveX: i < 60 ? 0.6 : 0,
        moveZ: i < 90 ? -0.35 : 0,
        jump: Math.floor(i / 30),
        run: i < 50,
        quiet: i > 110,
      };
      advance(a, p, cmd, 1);
      advance(b, q, cmd, 1);
      for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'energy'])
        assert.ok(Math.abs(p[key] - q[key]) < 1e-8, key);
    }
  } finally {
    a.dispose();
    b.dispose();
  }
});
test('every authored parkour jump is reachable, with the final ascent gate requiring its earned ability', async () => {
  const { jumpLink } = await import('./support/jump-link.js');
  for (const original of Object.values(parkourMaps)) {
    const map = {
      ...original,
      colliders: original.colliders.filter((c) =>
        original.id === 'ascent' ? c.id.startsWith('route-') : true,
      ),
    };
    for (let i = 0; i < map.colliders.length - 1; i++) {
      const from = map.colliders[i],
        to = map.colliders[i + 1];
      if (original.id === 'ascent' && to.id === 'route-49') {
        assert.equal(
          jumpLink(original, havok, from.id, to.id, 1),
          null,
          'single jump cannot bypass the high gate',
        );
        assert.ok(
          jumpLink(original, havok, from.id, to.id, 2, 1),
          'earned standard double jump reaches the gate',
        );
        continue;
      }
      let landed = false;
      // Search ordinary takeoff timings. Releasing input in midair no longer acts
      // as an instant brake, so the previous edge-only sprint script overshot.
      attempts: for (const run of [false, true])
        for (const margin of [0.4, 0.8, 1.2, 1.6]) {
          const w = new PhysicsWorld(mapFromDocument(original), havok);
          const angle = Math.atan2(to.z - from.z, to.x - from.x);
          const dx = Math.cos(angle),
            dz = Math.sin(angle);
          const p = player({
            x: from.x - dx * 0.4,
            y: from.y + from.height / 2,
            z: from.z - dz * 0.4,
          });
          try {
            advance(w, p, command, 4);
            let jumped = false;
            for (let tick = 0; tick < 60; tick++) {
              const edge = Math.min(
                Math.abs(dx) > 0.001
                  ? (from.width / 2 - (p.x - from.x) * Math.sign(dx)) / Math.abs(dx)
                  : Infinity,
                Math.abs(dz) > 0.001
                  ? (from.depth / 2 - (p.z - from.z) * Math.sign(dz)) / Math.abs(dz)
                  : Infinity,
              );
              if (!jumped && edge < margin) jumped = true;
              stepMovement(
                p,
                { ...command, moveX: dx, moveZ: -dz, run, jump: Number(jumped) },
                w,
                0.05,
              );
              if (
                jumped &&
                p.grounded &&
                Math.abs(p.y - (to.y + to.height / 2)) < 0.06 &&
                Math.abs(p.x - to.x) < to.width / 2 - 0.15 &&
                Math.abs(p.z - to.z) < to.depth / 2 - 0.15
              ) {
                landed = true;
                break;
              }
              if (p.y < 0) break;
            }
          } finally {
            w.dispose();
          }
          if (landed) break attempts;
        }
      assert.ok(landed, `${map.id}: ${from.id} → ${to.id}`);
    }
  }
});

const floorWorld = () =>
  new PhysicsWorld({ id: 'flat', size: 64, grid: [], climbable: false, colliders: [] }, havok);
test('airborne release preserves momentum; landing is monotonic and stable', () => {
  const w = floorWorld(),
    p = player({ x: 20, y: 0, z: 20 });
  try {
    advance(w, p, { ...command, moveX: 1, run: true }, 15);
    stepMovement(p, { ...command, moveX: 1, run: true, jump: 1 }, w, 0.05);
    const vx = p.vx,
      startX = p.x;
    let descending = false,
      previousY = p.y,
      landed = false;
    for (let i = 0; i < 40; i++) {
      stepMovement(p, { ...command, jump: 1 }, w, 0.05);
      if (!p.grounded) assert.ok(Math.abs(p.vx - vx) < 0.001, 'no air braking on key release');
      if (descending)
        assert.ok(
          p.y <= previousY + 0.002,
          `landing must not bounce upward: ${previousY} → ${p.y}`,
        );
      if (p.vy < 0) descending = true;
      if (p.grounded) landed = true;
      if (landed) assert.ok(Math.abs(p.y) < 0.025, 'stable floor contact');
      previousY = p.y;
    }
    assert.ok(landed);
    assert.ok(p.x - startX > 2.8);
  } finally {
    w.dispose();
  }
});
test('a press shortly before touchdown is buffered into a same-step landing jump', () => {
  const w = floorWorld(),
    p = player();
  try {
    advance(w, p, command, 3);
    stepMovement(p, { ...command, jump: 1 }, w, 0.05);
    while (!(p.vy < 0 && p.y < 0.45)) stepMovement(p, { ...command, jump: 1 }, w, 0.05);
    assert.ok(!p.grounded);
    stepMovement(p, { ...command, jump: 2 }, w, 0.05);
    let rebounded = false;
    for (let i = 0; i < 3; i++) {
      stepMovement(p, { ...command, jump: 2 }, w, 0.05);
      if (p.vy > 4) rebounded = true;
    }
    assert.ok(rebounded);
    assert.equal(p.jumpBuffer, 0);
    assert.equal(p.jumpsUsed, 1);
    advance(w, p, { ...command, jump: 2 }, 25);
    assert.ok(p.grounded, 'holding the same sequence cannot auto-jump');
  } finally {
    w.dispose();
  }
});
test('double jump is opt-in, height-configurable, consumes once and resets on landing', () => {
  for (const maxJumps of [1, 2])
    for (const airJumpHeight of [0.7, 1, 1.3]) {
      const w = floorWorld(),
        p = { ...player(), maxJumps, airJumpHeight };
      try {
        advance(w, p, command, 3);
        advance(w, p, { ...command, jump: 1 }, 7);
        const before = p.vy;
        stepMovement(p, { ...command, jump: 2 }, w, 0.05);
        if (maxJumps === 1) assert.ok(p.vy < before);
        else {
          assert.ok(Math.abs(p.vy - (5.2 * Math.sqrt(airJumpHeight) - 13 * 0.05)) < 0.01);
          assert.equal(p.jumpsUsed, 2);
          const secondVy = p.vy;
          stepMovement(p, { ...command, jump: 3 }, w, 0.05);
          assert.ok(p.vy < secondVy, 'no third jump');
        }
        advance(w, p, { ...command, jump: 3 }, 40);
        assert.ok(p.grounded);
        assert.equal(p.jumpsUsed, 0);
        stepMovement(p, { ...command, jump: 4 }, w, 0.05);
        assert.ok(p.vy > 4);
        assert.equal(p.jumpsUsed, 1);
      } finally {
        w.dispose();
      }
    }
});
test('coyote time allows a near-edge jump but cannot be used twice', () => {
  const w = floorWorld(),
    p = { ...player({ x: 20, y: 3, z: 20 }), grounded: false, coyote: 0.08, jumpsUsed: 0 };
  try {
    stepMovement(p, { ...command, jump: 1 }, w, 0.05);
    assert.ok(p.vy > 4);
    assert.equal(p.coyote, 0);
    const vy = p.vy;
    stepMovement(p, { ...command, jump: 2 }, w, 0.05);
    assert.ok(p.vy < vy);
  } finally {
    w.dispose();
  }
});
test('a buffered landing jump still awards its parkour checkpoint', () => {
  const mode = new Parkour(parkourMaps.skyline, 'skyline');
  const point = mode.map.checkpoints[0];
  const p = { ...player({ ...point, y: point.y + 0.25 }), vy: -4, jumpBuffer: 0.14, jumpsUsed: 1 };
  const w = new PhysicsWorld(mode.map, havok);
  try {
    for (let i = 0; i < 3 && !p.landing; i++) stepMovement(p, command, w, 0.05);
    assert.ok(p.landing);
    assert.ok(p.vy > 0, 'jump has already relaunched');
    mode.tick(p, Date.now());
    assert.equal(p.checkpoint, 1);
  } finally {
    w.dispose();
  }
});
test('second jump remains blocked by physical ceilings', () => {
  const w = new PhysicsWorld(
    {
      id: 'ceiling',
      size: 16,
      grid: [],
      climbable: false,
      colliders: [
        {
          id: 'roof',
          x: 8,
          y: 2.7,
          z: 8,
          width: 8,
          height: 0.3,
          depth: 8,
          surface: 'steel',
          climbable: false,
        },
      ],
    },
    havok,
  );
  const p = { ...player({ x: 8, y: 0, z: 8 }), maxJumps: 2 };
  try {
    advance(w, p, command, 4);
    for (let i = 0; i < 30; i++) {
      stepMovement(p, { ...command, jump: i > 4 ? 2 : 1 }, w, 0.05);
      assert.ok(p.y < 1, 'head must not pass through roof');
    }
    assert.ok(p.grounded);
  } finally {
    w.dispose();
  }
});
test('authored ascent stairs use a smooth Havok hull and are walkable in both directions', () => {
  const map = parkourMaps.ascent,
    mode = new Parkour(map, 'ascent'),
    w = new PhysicsWorld(mode.map, havok);
  try {
    for (const index of [6, 24]) {
      const floor = map.colliders.find((c) => c.id === 'route-' + index),
        bonus = map.colliders.find((c) => c.id === 'bonus-' + index),
        sign = Math.sign(bonus.z - floor.z),
        p = player({ x: floor.x, y: floor.y + floor.height / 2, z: floor.z });
      advance(w, p, command, 4);
      for (let i = 0; i < 100; i++) {
        advance(w, p, { ...command, moveZ: -sign }, 1);
        if (Math.abs(p.z - bonus.z) < 0.2) break;
      }
      assert.ok(Math.abs(p.y - (bonus.y + bonus.height / 2)) < 0.04, `${index} staircase ${p.y}`);
      assert.ok(p.grounded);
    }
  } finally {
    w.dispose();
  }
});
test('jumping onto either staircase acquires support and preserves uphill walking speed', () => {
  const map = mapFromDocument(parkourMaps.ascent);
  for (const index of [6, 24])
    for (const character of ['operator', 'ranger']) {
      const w = new PhysicsWorld(map, havok);
      const stairs = map.colliders.find((c) => c.id === 'stair-' + index);
      const bonus = map.colliders.find((c) => c.id === 'bonus-' + index);
      const p = { ...player({ x: stairs.x, y: stairs.y + 2, z: stairs.z }), kit: { character } };
      try {
        advance(w, p, command, 35); // Land vertically on the middle of the sloping tread area.
        assert.ok(p.grounded, 'sloped landing must become a grounded contact');
        const z = p.z,
          y = p.y;
        advance(w, p, command, 10);
        assert.ok(
          Math.abs(p.z - z) < 0.01 && Math.abs(p.y - y) < 0.01,
          'standing on stairs must not slide',
        );
        advance(w, p, { ...command, moveZ: 1 }, 10);
        assert.ok(
          p.y > y + 0.5 && p.vz < -2.6,
          'uphill speed must not decay through repeated projection',
        );
        stepMovement(p, { ...command, moveZ: 1, jump: 1 }, w, 0.05);
        let landed = false;
        for (let i = 0; i < 50; i++) {
          stepMovement(p, { ...command, moveZ: 1, jump: 1 }, w, 0.05);
          if (p.grounded && Math.abs(p.y - bonus.y - bonus.height / 2) < 0.04) {
            landed = true;
            break;
          }
        }
        assert.ok(landed, 'jump out of slope continues onto the upper landing');
      } finally {
        w.dispose();
      }
    }
});
test('ascent keeps independent coins, saved height, fall cue and ranked multiplayer checkpoints', () => {
  const mode = new Parkour({ ...parkourMaps.ascent, obstacles: [] }, 'ascent'),
    a = player(mode.map.spawn),
    b = { ...player(mode.map.spawn), id: 'b', name: 'b' };
  const coin = mode.map.collectibles[0];
  Object.assign(a, { x: coin.x, y: coin.y - 0.65, z: coin.z, grounded: true });
  mode.tick(a, mode.started + 100);
  mode.tick(a, mode.started + 200);
  mode.tick(b, mode.started + 200);
  assert.equal(a.collected.size, 1);
  assert.equal(b.collected.size, 0);
  const checkpoint = mode.map.checkpoints[1];
  Object.assign(a, checkpoint);
  mode.tick(a, mode.started + 300);
  assert.equal(a.checkpoint ?? 0, 0, 'cannot skip the first route gate');
  Object.assign(a, mode.map.checkpoints[0]);
  mode.tick(a, mode.started + 400);
  assert.equal(a.checkpoint, 1);
  const best = a.highest;
  Object.assign(a, { y: mode.spawn(a).y - 2.1, vy: -7, grounded: false });
  assert.equal(
    mode.tick(a, mode.started + 500).fell,
    false,
    'descending above kill plane is not a failed run',
  );
  assert.equal(mode.tick(a, mode.started + 550).fell, false, 'scream only once per fall');
  a.y = -9;
  assert.equal(mode.tick(a, mode.started + 600).fell, true);
  assert.equal(mode.tick(a, mode.started + 650).fell, false, 'one cue per reset');
  assert.equal(a.falls, 1);
  assert.equal(a.y, mode.map.spawn.y);
  assert.equal(a.checkpoint, 0);
  assert.equal(a.highest, best);
  assert.equal(a.collected.size, 0);
  b.collected.add(coin.id);
  const snapshot = mode.snapshot([b, a], a);
  assert.equal(snapshot.standings[0].id, b.id);
  assert.equal(snapshot.coins, a.collected.size);
  assert.ok(Math.abs(snapshot.goalHeight - 26.25) < 0.001);
});

test('ascent detours work on one jump but remote coin islands require the ability pickup', async () => {
  const { jumpLink } = await import('./support/jump-link.js');
  const map = parkourMaps.ascent;
  for (const start of [8, 32]) {
    const route = [
      `route-${start}`,
      `branch-${start}-1`,
      `branch-${start}-2`,
      `branch-${start}-3`,
      `route-${start + 2}`,
    ];
    for (let i = 1; i < route.length; i++)
      assert.ok(jumpLink(map, havok, route[i - 1], route[i]), route[i - 1] + ' -> ' + route[i]);
  }
  for (const index of [12, 36]) {
    assert.equal(
      jumpLink(map, havok, 'route-' + index, 'challenge-' + index),
      null,
      'single jump must not reach challenge',
    );
    for (const power of [0.7, 1, 1.3]) {
      assert.ok(
        jumpLink(map, havok, 'route-' + index, 'challenge-' + index, 2, power),
        `challenge ${index}, power ${power}`,
      );
      assert.ok(
        jumpLink(map, havok, 'challenge-' + index, 'route-' + index, 2, power),
        `return ${index}, power ${power}`,
      );
    }
  }
});
test('flat balance beam is walkable on its centerline and stepping sideways falls', () => {
  const map = mapFromDocument(parkourMaps.ascent),
    w = new PhysicsWorld(map, havok);
  const from = map.colliders.find((c) => c.id === 'route-24');
  const p = player({ x: from.x, y: from.y + from.height / 2, z: from.z });
  try {
    advance(w, p, command, 4);
    advance(w, p, { ...command, moveX: 1 }, 45);
    assert.ok(p.grounded && Math.abs(p.y - from.y - from.height / 2) < 0.03);
    advance(w, p, { ...command, moveZ: 1 }, 20);
    assert.ok(p.y < from.y - 1, 'sideways error must fall off, no invisible support');
  } finally {
    w.dispose();
  }
});

test('both faster pendulum lanes have a timed walkable window through every obstacle', async () => {
  const { pendulumPose } = await import('../src/shared/obstacles.ts');
  const map = mapFromDocument(parkourMaps.ascent);
  for (const [start, end, axis] of [
    [6, 12, 'z'],
    [24, 30, 'x'],
  ]) {
    const w = new PhysicsWorld(map, havok),
      from = map.colliders.find((c) => c.id === 'route-' + start),
      to = map.colliders.find((c) => c.id === 'route-' + end);
    const p = player({ x: from.x, y: from.y + from.height / 2, z: from.z });
    const lane = map.obstacles.filter((o) => o.id.startsWith('pendulum-' + start + '-'));
    const { ParkourObstacles } = await import('../src/server/modes/parkour-obstacles.ts');
    const hazards = new ParkourObstacles(map);
    try {
      advance(w, p, command, 4);
      let time = 0;
      for (const hazard of lane) {
        const waitAt = hazard[axis] - 1.3;
        while (p[axis] < waitAt - 0.15) {
          stepMovement(
            p,
            { ...command, moveX: axis === 'x' ? 1 : 0, moveZ: axis === 'z' ? -1 : 0 },
            w,
            0.05,
          );
          time += 0.05;
          assert.equal(hazards.tick(p, time), false, 'safe approach');
        }
        advance(w, p, command, 8);
        time += 0.4;
        let found = false;
        for (let wait = 0; wait < 100; wait++) {
          let safe = true;
          // Evaluate the entire crossing, including acceleration and stopping distance.
          const duration = (hazard[axis] + 1.4 - p[axis]) / 3.25 + 0.12;
          for (let t = 0; t < duration; t += 0.025) {
            const position = pendulumPose(hazard, time + t);
            const forward = p[axis] + 3.25 * Math.max(0, t - 0.085);
            const along = position[axis] - forward,
              side = position[hazard.axis] - hazard[hazard.axis];
            if (Math.hypot(along, side) < 1.05) {
              safe = false;
              break;
            }
          }
          if (safe) {
            found = true;
            break;
          }
          stepMovement(p, command, w, 0.05);
          time += 0.05;
          assert.equal(hazards.tick(p, time), false, 'safe waiting');
        }
        assert.ok(found, 'there must be a timing window');
        while (p[axis] < hazard[axis] + 1.4) {
          stepMovement(
            p,
            { ...command, moveX: axis === 'x' ? 1 : 0, moveZ: axis === 'z' ? -1 : 0 },
            w,
            0.05,
          );
          time += 0.05;
          assert.equal(hazards.tick(p, time), false, 'timed crossing');
          assert.ok(p.grounded);
        }
      }
      while (p[axis] < to[axis] - 0.3) {
        stepMovement(
          p,
          { ...command, moveX: axis === 'x' ? 1 : 0, moveZ: axis === 'z' ? -1 : 0 },
          w,
          0.05,
        );
        time += 0.05;
        assert.equal(hazards.tick(p, time), false);
      }
      assert.ok(p.grounded);
    } finally {
      w.dispose();
    }
  }
});

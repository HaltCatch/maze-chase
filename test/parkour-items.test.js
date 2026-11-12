import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ParkourItems } from '../src/server/modes/parkour-items.ts';
import { Parkour } from '../src/server/modes/parkour.ts';
import { parkourMaps, mapFromDocument, mapDocumentSchema } from '../src/content/map-document.ts';
import { PhysicsWorld, initPhysics } from '../src/engine/physics.ts';
import { stepMovement, Pose, writePose, readPose } from '../src/network/movement.ts';
import { readMovement } from '../src/shared/protocol.ts';
const player = (id, x = 10, y = 2, z = 10) => ({
  id,
  name: id,
  x,
  y,
  z,
  yaw: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  energy: 1,
  recovery: 0,
  exhausted: false,
  grounded: true,
  jumpAck: 0,
  input: readMovement({}),
  rockets: 3,
  health: 100,
});
const command = { moveX: 0, moveZ: 0, yaw: 0, run: false, quiet: false, jump: 0 };
const havok = await initPhysics(
  await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))),
);

test('course rockets require a direct body hit, respect walls, preserve health and enforce cooldown', () => {
  for (const kind of ['hit', 'miss', 'wall']) {
    const items = new ParkourItems({
      size: 32,
      colliders: kind === 'wall' ? [{ x: 10, y: 3, z: 8, width: 2, height: 3, depth: 0.1 }] : [],
    });
    const a = player('a'),
      b = player('b', kind === 'miss' ? 10.7 : 10, 2, 6);
    assert.equal(items.fire(a, NaN, 0), false);
    assert.equal(items.fire(a, 0, 0), true);
    assert.equal(items.fire(a, 0, 100), false);
    assert.equal(a.rockets, 2);
    let impacts = [];
    for (let i = 0; i < 12; i++) impacts.push(...items.tick([a, b], 0.05));
    assert.equal(b.health, 100);
    assert.equal(a.vy, 0);
    if (kind === 'hit') {
      assert.equal(b.vz, -7);
      assert.equal(b.vy, 4.4);
      assert.equal(b.grounded, false);
      assert.equal(impacts.length, 1);
    } else assert.equal(b.vy, 0, 'no splash or through-wall hit');
    for (let i = 0; i < 60; i++) items.tick([a, b], 0.05);
    assert.equal(items.shots.length, 0);
  }
});

test('pickups are independent, bounded, one per attempt; falling resets only the falling player’s coins and ability', () => {
  const mode = new Parkour({ ...parkourMaps.ascent, obstacles: [] }, 'ascent');
  const a = player('a'),
    b = player('b');
  for (const kind of ['refill', 'shield']) {
    const p = mode.map.pickups.find((p) => p.kind === kind);
    for (const runner of [a, b]) {
      Object.assign(runner, {
        x: p.x,
        y: p.y - 0.65,
        z: p.z,
        energy: 0,
        exhausted: true,
        rockets: 0,
      });
      mode.items.collect(runner);
      if (kind === 'shield') assert.equal(runner.shield, true);
      else assert.equal(runner.energy, 1);
      const energy = runner.energy;
      runner.energy = energy / 2;
      mode.items.collect(runner);
      assert.equal(runner.energy, energy / 2);
    }
  }
  Object.assign(a, {
    y: -9,
    checkpoint: 3,
    highest: 12,
    collected: new Set(['coin']),
    boosted: true,
  });
  mode.tick(a, mode.started + 1000);
  assert.equal(a.checkpoint, 0);
  assert.equal(a.itemsTaken.size, 0);
  assert.equal(a.collected.size, 0);
  assert.equal(a.shield, false);
  assert.equal(a.boosted, false);
  assert.equal(a.rockets, 0);
  assert.equal(a.energy, 1);
  assert.equal(a.highest, 12);
  assert.equal(a.x, mode.map.spawn.x);
  assert.equal(a.y, mode.map.spawn.y);
  const invalid = structuredClone(parkourMaps.ascent);
  invalid.pickups[1].id = invalid.pickups[0].id;
  assert.equal(mapDocumentSchema.safeParse(invalid).success, false);
});

test('shield survives Pose replay without changing movement speed or energy', () => {
  const map = mapFromDocument(parkourMaps.ascent),
    world = new PhysicsWorld(map, havok);
  const p = { ...player('a', map.spawn.x, map.spawn.y, map.spawn.z), shield: true };
  try {
    const pose = new Pose();
    writePose(pose, p);
    const copy = player('copy');
    readPose(copy, pose);
    assert.equal(copy.shield, true);
    for (let i = 0; i < 10; i++) stepMovement(p, { ...command, moveX: 1 }, world, 0.05);
    assert.ok(p.vx <= 3.26 && p.vx > 3);
    assert.equal(p.energy, 1);
    assert.equal(p.shield, true);
  } finally {
    world.dispose();
  }
});

test('balloon rebound restores normal stamina and provides steering and neutral air brakes', () => {
  const map = mapFromDocument(parkourMaps.ascent),
    world = new PhysicsWorld(map, havok);
  const balloon = map.colliders.find((c) => c.id === 'balloon-a');
  const top = balloon.y + balloon.height / 2;
  const p = {
    ...player('a', balloon.x, top + 0.5, balloon.z),
    grounded: false,
    vy: -2,
    energy: 0.8,
  };
  try {
    for (let i = 0; i < 15 && !p.boosted; i++) stepMovement(p, command, world, 0.05);
    assert.equal(p.boosted, true);
    assert.ok(p.vy > 10);
    assert.equal(p.energy, 1);
    let highest = p.y;
    for (let i = 0; i < 17; i++) {
      stepMovement(p, { ...command, moveX: 1 }, world, 0.05);
      highest = Math.max(highest, p.y);
    }
    assert.ok(highest - top > 4.7);
    assert.ok(p.vx > 4, 'strong air steering after a bounce');
    for (let i = 0; i < 6; i++) stepMovement(p, command, world, 0.05);
    assert.ok(p.vx < 1.6, 'release brakes progressively over the landing target');
  } finally {
    world.dispose();
  }
});

test('balloon branch is reachable from the route and supports consecutive aerial transfers', async () => {
  const { jumpLink } = await import('./support/jump-link.js');
  assert.ok(jumpLink(parkourMaps.ascent, havok, 'route-18', 'balloon-a'));
  assert.ok(jumpLink(parkourMaps.ascent, havok, 'balloon-landing', 'route-19'));
  const map = mapFromDocument(parkourMaps.ascent),
    world = new PhysicsWorld(map, havok);
  const a = map.colliders.find((c) => c.id === 'balloon-a');
  const p = { ...player('chain', a.x, a.y + a.height / 2, a.z), grounded: false };
  try {
    for (let i = 0; i < 4; i++) stepMovement(p, command, world, 0.05);
    for (const id of ['balloon-b', 'balloon-c', 'balloon-landing']) {
      const target = map.colliders.find((c) => c.id === id);
      let reached = false;
      for (let i = 0; i < 80; i++) {
        const dx = target.x - p.x,
          dz = target.z - p.z;
        const tx = Math.max(-6.2, Math.min(6.2, dx * 5)),
          tz = Math.max(-6.2, Math.min(6.2, dz * 5));
        const scale = Math.max(1, Math.hypot(tx, tz) / 6.2);
        stepMovement(
          p,
          {
            ...command,
            run: true,
            moveX: Math.max(-1, Math.min(1, ((tx / scale) * 2 - p.vx) / 6.2)),
            moveZ: -Math.max(-1, Math.min(1, ((tz / scale) * 2 - p.vz) / 6.2)),
          },
          world,
          0.05,
        );
        if (
          i > 4 &&
          (target.bounce
            ? p.vy > 8 &&
              p.landing &&
              Math.abs(p.landing.x - target.x) < target.width / 2 + 0.22 &&
              Math.abs(p.landing.z - target.z) < target.depth / 2 + 0.22 &&
              Math.abs(p.landing.y - target.y - target.height / 2) < 0.05
            : p.grounded &&
              Math.hypot(p.x - target.x, p.z - target.z) < 0.95 &&
              Math.abs(p.y - target.y - target.height / 2) < 0.05)
        ) {
          reached = true;
          break;
        }
        if (p.y < target.y - 4) break;
      }
      assert.ok(reached, id + ' missed at ' + JSON.stringify([p.x, p.y, p.z]));
    }
  } finally {
    world.dispose();
  }
});

test('rocket elevation follows the same aim direction as the camera', () => {
  for (const pitch of [-1.3, -0.4, 0, 0.4, 1.3]) {
    const items = new ParkourItems({ size: 32, colliders: [] });
    const p = player('aim');
    p.yaw = 0.7;
    assert.ok(items.fire(p, pitch, 0));
    const shot = items.shots[0];
    assert.ok(Math.abs(shot.vy / 18 - Math.sin(pitch)) < 1e-10);
    assert.ok(Math.abs(shot.vx / 18 + Math.sin(p.yaw) * Math.cos(pitch)) < 1e-10);
    assert.ok(Math.abs(shot.vz / 18 + Math.cos(p.yaw) * Math.cos(pitch)) < 1e-10);
  }
});

test('high normal jumps and balloon descents do not play the failure cue', () => {
  const mode = new Parkour({ ...parkourMaps.ascent, obstacles: [] }, 'ascent');
  const p = player('fall', 32, 20, 32);
  for (const y of [20, 23, 27, 25, 21, 16, 10, 3, 0]) {
    p.y = y;
    p.vy = -9;
    p.grounded = false;
    assert.equal(mode.tick(p, Date.now()).fell, false);
    assert.equal(p.falls ?? 0, 0);
  }
  p.y = -9;
  assert.equal(mode.tick(p, Date.now()).fell, true);
  assert.equal(p.falls, 1);
  assert.equal(mode.tick(p, Date.now()).fell, false);
});

test('trophy requires every coin; summit ammo is a separate finite pickup and falls return to spawn', () => {
  const mode = new Parkour({ ...parkourMaps.ascent, obstacles: [] }, 'ascent');
  const a = player('a'),
    b = player('b');
  const coin = mode.map.collectibles[0],
    finish = mode.map.checkpoints.at(-1);
  Object.assign(a, { x: coin.x, y: coin.y - 0.65, z: coin.z });
  mode.tick(a, mode.started + 100);
  Object.assign(a, finish);
  mode.tick(a, mode.started + 200);
  assert.equal(mode.trophyOwner, undefined, 'reaching summit is not enough');
  assert.equal(a.finishedAt, undefined);
  assert.equal(a.rockets, 3); // Fixture starts with ammo; trophy never changes it.
  a.rockets = 0;
  a.collected = new Set(mode.map.collectibles.map((c) => c.id));
  mode.tick(a, mode.started + 250);
  assert.equal(mode.trophyOwner, 'a');
  assert.equal(a.finishedAt, 250);
  assert.equal(a.rockets, 0, 'trophy does not grant a launcher');
  const gun = mode.map.pickups.find((p) => p.id === 'summit-launcher');
  Object.assign(b, { x: gun.x, y: gun.y - 0.65, z: gun.z, rockets: 0 });
  mode.tick(b, mode.started + 300);
  assert.equal(b.rockets, 3, 'gun needs no trophy or coin gate');
  for (let i = 0; i < 3; i++) assert.equal(mode.items.fire(b, 0, 1000 + i * 900), true);
  assert.equal(mode.items.fire(b, 0, 4000), false);
  mode.items.collect(b);
  assert.equal(b.rockets, 0, 'standing at pickup cannot refill');
  Object.assign(a, { x: 30, y: -3, z: 30, grounded: true });
  assert.equal(mode.tick(a, mode.started + 400).fell, true);
  assert.deepEqual([a.x, a.y, a.z], [mode.map.spawn.x, mode.map.spawn.y, mode.map.spawn.z]);
  assert.equal(a.collected.size, 0);
  assert.equal(mode.tick(a, mode.started + 450).fell, false);
  Object.assign(b, { x: coin.x, y: coin.y - 0.65, z: coin.z });
  mode.tick(b, mode.started + 500);
  assert.equal(b.collected.size, 1, 'coins remain independent');
});

test('road launchers grant one shot; summit pickup is separated from trophy and coin', () => {
  const mode = new Parkour(parkourMaps.ascent, 'ascent');
  const roads = mode.map.pickups.filter((p) => p.kind === 'rocket' && p.id !== 'summit-launcher');
  assert.ok(roads.length >= 3);
  for (const item of roads) {
    const p = { ...player(item.id, item.x, item.y - 0.65, item.z), rockets: 0 };
    mode.items.collect(p);
    assert.equal(p.rockets, 1);
    assert.equal(mode.items.fire(p, 0, 0), true);
    assert.equal(mode.items.fire(p, 0, 1000), false);
  }
  const finish = mode.map.checkpoints.at(-1),
    gun = mode.map.pickups.find((p) => p.id === 'summit-launcher');
  assert.ok(Math.hypot(gun.x - finish.x, gun.z - finish.z) >= 2);
  assert.ok(
    mode.map.collectibles.every((c) => Math.hypot(c.x - gun.x, c.y - gun.y, c.z - gun.z) > 1.5),
  );
});

test('walking and jumping on the base stay playable without triggering fall resets', () => {
  const mode = new Parkour({ ...parkourMaps.ascent, obstacles: [] }, 'ascent'),
    w = new PhysicsWorld(mode.map, havok);
  const p = { ...player('ground', 12, -3, 30), maxJumps: 2, doubleJumpScale: 1.3 };
  try {
    for (let i = 0; i < 65; i++) {
      stepMovement(p, { ...command, moveX: 0.2, jump: i < 5 ? 0 : i < 10 ? 1 : 2 }, w, 0.05);
      assert.equal(mode.tick(p, mode.started + i * 50).fell, false);
    }
    assert.ok(Math.abs(p.y + 3) < 0.05);
    assert.equal(p.falls ?? 0, 0);
  } finally {
    w.dispose();
  }
});

test('return stairs lead from the real base to the original spawn without jumping', () => {
  const mode = new Parkour({ ...parkourMaps.ascent, obstacles: [] }, 'ascent');
  const world = new PhysicsWorld(mode.map, havok);
  const p = player('walk', 10, -3, 24.5);
  try {
    for (let i = 0; i < 85; i++) {
      stepMovement(p, { ...command, moveZ: 1 }, world, 0.05);
      mode.tick(p, mode.started + i * 50);
    }
    assert.ok(p.y > 1.98 && p.y < 2.05, `spawn height: ${p.y}`);
    assert.ok(p.z < 14.3 && p.z > 9);
    assert.equal(p.falls ?? 0, 0, 'walking on ground does not reset');
    for (let i = 0; i < 85; i++) {
      stepMovement(p, { ...command, moveZ: -1 }, world, 0.05);
      mode.tick(p, mode.started + 5000 + i * 50);
    }
    assert.ok(Math.abs(p.y + 3) < 0.05, 'can descend to the ground');
    assert.equal(p.falls ?? 0, 0, 'stair descent is not a fall');
  } finally {
    world.dispose();
  }
});

test('shield absorbs one direct rocket, then the next rocket knocks back', () => {
  const items = new ParkourItems({ size: 32, colliders: [] });
  const a = player('a'),
    b = { ...player('b', 10, 2, 6), shield: true };
  assert.ok(items.fire(a, 0, 0));
  for (let i = 0; i < 6; i++) items.tick([a, b], 0.05);
  assert.equal(b.shield, false);
  assert.equal(b.vy, 0);
  assert.ok(items.fire(a, 0, 1000));
  for (let i = 0; i < 6; i++) items.tick([a, b], 0.05);
  assert.equal(b.vy, 4.4);
});

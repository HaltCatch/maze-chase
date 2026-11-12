import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initPhysics } from '../src/engine/physics.ts';
import { MatchSession } from '../src/server/rooms/session.js';
import { maze, paths, MAZE_SIZE } from '../src/shared/world.js';
const havok = await initPhysics(
  await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))),
);
test('closed mazes retain reachable corridors and a limited number of loops', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const map = maze(MAZE_SIZE, seed),
      walkable = map
        .join('')
        .split('')
        .filter((c) => c !== '#').length;
    assert.equal(paths(map, [1, 1]).queue.length, walkable);
    assert.ok(walkable < MAZE_SIZE * MAZE_SIZE * 0.56, 'maze must not dissolve into open rooms');
  }
});
test('maze role actions: E catches only close, facing victims; runner can draw and release arrows', () => {
  const events = [];
  const session = new MatchSession(
    'qa',
    { mode: 'escape', maxPlayers: 2, aiCount: 0, allowClimb: false },
    havok,
    (p, m) => events.push({ id: p.id, ...m }),
    () => {},
  );
  const hunter = session.add('a', 'a', true),
    runner = session.add('b', 'b', true);
  try {
    session.start();
    const room = session.room;
    room.phase = 'hunt';
    for (const p of room.players) {
      p.sceneReady = true;
      p.spawnSafeUntil = 0;
      assert.equal(p.climbable, false);
    }
    assert.equal(hunter.monster, true);
    assert.equal(runner.monster, false);
    Object.assign(hunter, { x: 1.5, z: 1.5, y: 0, yaw: 0, grounded: true });
    Object.assign(runner, { x: 5.5, z: 5.5, y: 0, grounded: true });
    session.handle(hunter, { type: 'action' });
    assert.equal(hunter.swing, null);
    assert.ok(events.some((m) => m.type === 'hint' && m.message.includes('挥空')));
    const row = room.map.findIndex((r, z) => z > 0 && r.includes('...'));
    const x = room.map[row].indexOf('...') + 1.5;
    Object.assign(hunter, { x, z: row + 0.5, yaw: -Math.PI / 2, attack: 0 });
    Object.assign(runner, { x: x + 0.65, z: row + 0.5 });
    session.handle(hunter, { type: 'action' });
    assert.ok(hunter.swing);
    hunter.swing.at = Date.now() - 1;
    session.tick();
    assert.equal(runner.alive, false);
    runner.alive = true;
    room.caughtUntil = 0;
    runner.stunUntil = 0;
    session.handle(runner, { type: 'weapon-ready', weapon: 'bow' });
    // Charge and fire use the same commands as the real browser client.
    assert.ok(runner.bowSince !== null);
    runner.bowSince = Date.now() - 800;
    const ammo = runner.ammo.bow;
    session.handle(runner, { type: 'weapon-fire', weapon: 'bow', pitch: 0 });
    assert.equal(runner.ammo.bow, ammo - 1);
  } finally {
    session.dispose();
  }
});

test('parkour timer reports coin standings without treating trophy or height as victory', () => {
  const messages = [];
  const session = new MatchSession(
    'score',
    { mode: 'parkour', arena: 'ascent', maxPlayers: 2, aiCount: 0 },
    havok,
    (p, m) => messages.push({ player: p.id, ...m }),
    () => {},
  );
  const a = session.add('a', 'A', true),
    b = session.add('b', 'B', true);
  try {
    session.start();
    const r = session.room;
    r.phase = 'hunt';
    r.until = Date.now() - 1;
    a.collected = new Set(['one']);
    b.collected = new Set(['one', 'two']);
    a.highest = 100;
    r.parkour.trophyOwner = a.id;
    session.tick();
    const end = messages.find((m) => m.type === 'end' && m.player === 'a');
    assert.equal(end.result, 'parkour-ended');
    assert.equal(end.parkour.standings[0].id, 'b');
    assert.equal(end.parkour.coins, 1);
    assert.equal(end.parkour.trophyOwner, 'a');
  } finally {
    session.dispose();
  }
});

test('spring ability is individual, persistent between ticks, reset by falls; other maps keep room jumps', () => {
  for (const arena of ['ascent', 'skyline']) {
    const session = new MatchSession(
      'jump-' + arena,
      { mode: 'parkour', arena, maxPlayers: 2, aiCount: 0, doubleJump: true, airJumpHeight: 1.3 },
      havok,
      () => {},
      () => {},
    );
    const a = session.add('a', 'A', true),
      b = session.add('b', 'B', true);
    try {
      session.start();
      const room = session.room,
        course = room.parkour;
      room.phase = 'hunt';
      for (const p of room.players) p.sceneReady = true;
      assert.equal(a.maxJumps, arena === 'ascent' ? 1 : 2);
      if (arena !== 'ascent') {
        assert.equal(a.airJumpHeight, 1.3);
        continue;
      }
      const pickup = course.map.pickups.find((p) => p.kind === 'double-jump');
      Object.assign(a, { x: pickup.x, y: pickup.y - 0.65, z: pickup.z });
      session.tick();
      assert.equal(a.maxJumps, 2);
      session.tick();
      assert.equal(a.maxJumps, 2);
      assert.equal(a.airJumpHeight, 1);
      assert.equal(b.maxJumps, 1);
      a.collected.add('coin-2');
      b.collected.add('coin-2');
      a.y = -9;
      session.tick();
      assert.equal(a.maxJumps, 1);
      assert.equal(a.airJumpUnlocked, false);
      assert.equal(a.collected.size, 0);
      assert.equal(a.itemsTaken.size, 0);
      assert.equal(b.collected.size, 1);
      Object.assign(a, { x: pickup.x, y: pickup.y - 0.65, z: pickup.z });
      session.tick();
      assert.equal(a.maxJumps, 2, 'spring becomes collectable on the new attempt');
    } finally {
      session.dispose();
    }
  }
});

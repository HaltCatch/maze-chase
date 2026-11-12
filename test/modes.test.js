import assert from 'node:assert/strict';
import test from 'node:test';
import { startDuel, duelState } from '../src/server/duel.js';
import { startWaves, tickWaves, waveSpawn } from '../src/server/survival.js';
import { resetCombat, armPlayer, hurt, weaponInput, tickCombat } from '../src/server/combat.js';
import { deployment } from '../src/shared/arsenal.ts';
import { arenas, docksMap, docksSpawn, docksCores, docksDrops } from '../src/shared/docks.js';
import { cell, paths, move, stepJump, STEP, clearTravel } from '../src/shared/world.js';
import { driveBot } from '../src/server/bot.js';
const empty = { f: false, b: false, l: false, r: false, run: false, quiet: false };
const reset = (p, spawn) =>
  Object.assign(p, spawn, {
    alive: true,
    y: 0,
    vy: 0,
    vx: 0,
    vz: 0,
    input: empty,
    energy: 1,
    recovery: 0,
    exhausted: false,
    stunUntil: 0,
    spawnSafeUntil: 0,
    brain: null,
    mantle: null,
  });
function room(mode, arena = 'docks') {
  const room = {
    mode,
    arena,
    round: 0,
    difficulty: 'normal',
    players: [
      { id: 'one', kit: deployment(mode) },
      { id: 'two', kit: deployment(mode) },
    ],
  };
  startDuel(room, reset);
  resetCombat(room);
  return room;
}
const send = () => {};
test('gun game enforces the current rung, upgrades twice, and ends at six eliminations', () => {
  const r = room('gungame'),
    [a, b] = r.players;
  assert.deepEqual(Object.keys(a.ammo), ['pistol']);
  weaponInput(r, a, { type: 'weapon-fire', weapon: 'rifle', pitch: 0 }, 1000, send);
  assert.equal(r.shotId, 0);
  for (let score = 1; score <= 6; score++) {
    b.alive = true;
    b.health = 100;
    hurt(r, b, 100, score * 1000, send, a.currentWeapon, a);
    assert.equal(r.duel.scores[a.side], score);
    const expected = score < 2 ? 'pistol' : score < 4 ? 'rifle' : 'sniper';
    assert.equal(a.currentWeapon, expected);
    assert.deepEqual(Object.keys(a.ammo), [expected]);
    assert.equal(duelState(r, a, 0).core, undefined);
  }
  assert.equal(r.duel.eliminationWinner, a.side);
});
test('co-op protects teammates from bullets and grenades but enemies still take damage', () => {
  const r = room('survival'),
    [a, b] = r.players;
  assert.equal(a.side, b.side);
  a.x = 12.5;
  a.z = 5;
  a.yaw = 0;
  b.x = 12.5;
  b.z = 3;
  weaponInput(r, a, { type: 'weapon-fire', weapon: 'rifle', pitch: 0 }, 1000, send);
  assert.equal(b.health, 100);
  assert.equal(hurt(r, b, 100, 2000, send, 'frag', a), false);
  b.side = 1;
  weaponInput(r, a, { type: 'weapon-fire', weapon: 'rifle', pitch: 0 }, 2000, send);
  assert.ok(b.health < 100);
});
test('co-op has no opening delay, caps concurrent enemies and revives only after a cleared wave', () => {
  const r = room('survival'),
    [a, b] = r.players;
  startWaves(r, 1000);
  tickWaves(r, 1000, reset, armPlayer);
  assert.equal(r.wave.number, 1);
  assert.equal(r.wave.spawned, 1);
  b.alive = false;
  b.health = 0;
  tickWaves(r, 1500, reset, armPlayer);
  assert.equal(b.alive, false);
  for (let n = 0; n < 3; n++) {
    for (const p of r.players) if (p.enemy) p.alive = false;
    tickWaves(r, 3000 + n * 2000, reset, armPlayer);
  }
  assert.equal(r.wave.state, 'break');
  tickWaves(r, r.wave.nextAt, reset, armPlayer);
  assert.equal(r.wave.number, 2);
  assert.equal(b.alive, true);
  assert.equal(b.health, 100);
  for (let n = 0; n < 10; n++) tickWaves(r, 20000 + n * 2000, reset, armPlayer);
  assert.equal(r.players.filter((p) => p.enemy && p.alive).length, 4);
  a.alive = b.alive = false;
  assert.equal(tickWaves(r, 50000, reset, armPlayer), 'overrun');
});
test('five clear waves end in victory, sweep dead actors and preserve both human slots', () => {
  const r = room('survival');
  startWaves(r, 0);
  let result;
  for (let now = 0; now < 200000; now += 1300) {
    for (const p of r.players) if (p.enemy) p.alive = false;
    result = tickWaves(r, now, reset, armPlayer);
    assert.ok(r.players.length <= 13);
    if (result) break;
  }
  assert.equal(result, 'secured');
  assert.equal(r.wave.number, 5);
  assert.equal(r.players.filter((p) => !p.enemy).length, 2);
});
test('all arenas connect spawns, core sites, deliveries and ammo without spawning in cover', () => {
  for (const arena of Object.keys(arenas)) {
    const map = docksMap(arena),
      route = paths(map, [12, 2]);
    for (const p of [
      ...docksSpawn,
      ...docksCores,
      ...docksDrops,
      { x: 11.5, z: 2.5 },
      { x: 13.5, z: 2.5 },
    ]) {
      assert.equal(cell(map, p.x, p.z), '.', arena + ' walkable ' + JSON.stringify(p));
      assert.ok(route.steps.has(Math.floor(p.x) + ',' + Math.floor(p.z)), arena + ' connected');
    }
    const r = room('survival', arena);
    startWaves(r);
    const spawn = waveSpawn(r);
    assert.ok(spawn);
    assert.ok(r.players.every((p) => Math.hypot(p.x - spawn.x, p.z - spawn.z) >= 6));
  }
});
test('solo cooperative teammate engages hostile AI without damaging its human ally on every arena', (t) => {
  const random = Math.random;
  let seed = 4106;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  t.after(() => {
    Math.random = random;
  });
  for (const arena of Object.keys(arenas)) {
    const r = room('survival', arena);
    r.difficulty = 'hard';
    const ally = r.players[1];
    ally.bot = true;
    startWaves(r, 0);
    let confirmed = 0;
    for (let i = 0; i < 2400; i++) {
      const now = i * 50;
      tickWaves(r, now, reset, armPlayer);
      if (!r.players[0].alive) break;
      for (const p of r.players.filter((p) => p.bot && p.alive)) {
        driveBot(
          r,
          p,
          now,
          empty,
          () => {},
          (m) =>
            weaponInput(r, p, m, now, (target, event) => {
              if (target === ally && event.type === 'knockdown') confirmed++;
            }),
        );
        const before = { x: p.x, z: p.z };
        stepJump(p, STEP, r.map);
        move(r.map, p, STEP);
        assert.ok(
          clearTravel(r.map, before.x, before.z, p.x, p.z, p.y, false),
          arena + ' bot crossing wall',
        );
      }
      tickCombat(r, STEP, now, send);
      // Keep the test squad alive to inspect sustained navigation and engagements.
      for (const p of r.players.filter((p) => !p.enemy)) {
        p.health = 100;
        p.alive = true;
      }
      if (confirmed) break;
    }
    assert.ok(confirmed > 0, arena + ' AI teammate must defeat at least one hostile');
  }
});

test('scene-ready is idempotent and cannot renew spawn protection', async () => {
  const { MatchSession } = await import('../src/server/rooms/session.js');
  const session = new MatchSession(
    'test',
    { mode: 'skirmish', maxPlayers: 2, aiCount: 0 },
    null,
    () => {},
    () => {},
  );
  session.room.phase = 'hunt';
  const player = { sceneReady: false, spawnSafeUntil: 0 };
  session.handle(player, { type: 'scene-ready' });
  assert.equal(player.sceneReady, true);
  assert.ok(player.spawnSafeUntil > Date.now());
  player.spawnSafeUntil = 123;
  session.handle(player, { type: 'scene-ready' });
  assert.equal(player.spawnSafeUntil, 123);
  session.room.phase = 'lobby';
  player.sceneReady = false;
  session.handle(player, { type: 'scene-ready' });
  assert.equal(player.sceneReady, false);
});

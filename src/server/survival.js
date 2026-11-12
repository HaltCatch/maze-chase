// Adapted from Arena's startSurvival/tickWaves (Ben Darling, MIT):
// https://github.com/Hazzad123/fully-ai-arena-fps/blob/920b123/server/room.js
// Bounded staggered spawns, no enemy respawns, squad recovery between waves.
import { cell, sight } from '../shared/world.js';
import { deployment } from '../shared/arsenal.ts';

export function rescueTarget(room, helper, now) {
  if (
    room.mode !== 'survival' ||
    !room.wave ||
    !helper.alive ||
    helper.enemy ||
    helper.stunUntil > now
  )
    return;
  return room.players.find(
    (q) =>
      q !== helper &&
      !q.enemy &&
      !q.alive &&
      !q.rescuedThisWave &&
      Math.hypot(q.x - helper.x, q.z - helper.z) < 1.6 &&
      Math.abs((q.y ?? 0) - (helper.y ?? 0)) < 0.7 &&
      sight(room.map, helper, q),
  );
}
export function rescueAlly(room, helper, now) {
  const q = rescueTarget(room, helper, now);
  if (!q) return;
  // Preserve position, inventory and already-used charge; no teleport or ammo farming.
  Object.assign(q, {
    alive: true,
    health: 50,
    rescuedThisWave: true,
    downUntil: 0,
    stunUntil: 0,
    spawnSafeUntil: now + 1200,
    vx: 0,
    vy: 0,
    vz: 0,
    swing: null,
    reload: null,
    bowSince: null,
    firingUntil: 0,
    motionUntil: 0,
  });
  return q;
}

export function startWaves(room, now = Date.now()) {
  room.wave = {
    number: 0,
    state: 'break',
    nextAt: now,
    toSpawn: 0,
    spawned: 0,
    nextSpawnAt: now,
    serial: 0,
  };
}
export function waveSpawn(room) {
  const allies = room.players.filter((p) => !p.enemy && p.alive);
  const candidates = [];
  for (let z = 2; z < room.map.length - 2; z += 2)
    for (let x = 2; x < room.map[0].length - 2; x += 2) {
      const spot = { x: x + 0.5, z: z + 0.5 };
      if (cell(room.map, spot.x, spot.z) !== '.') continue;
      const range = Math.min(...allies.map((p) => Math.hypot(p.x - spot.x, p.z - spot.z)));
      if (
        range < 6 ||
        room.players.some((p) => p.alive && Math.hypot(p.x - spot.x, p.z - spot.z) < 1.4)
      )
        continue;
      candidates.push({
        ...spot,
        score: range + (!allies.some((p) => sight(room.map, p, spot)) ? 12 : 0),
      });
    }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[room.wave.serial % Math.min(4, candidates.length)];
}
export function tickWaves(room, now, resetPlayer, armPlayer) {
  const w = room.wave;
  if (!room.players.some((p) => !p.enemy && p.alive)) return 'overrun';
  if (w.state === 'break') {
    if (now < w.nextAt) return;
    room.players = room.players.filter((p) => !p.enemy);
    w.number++;
    w.toSpawn = 3 + (w.number - 1) * 2;
    w.spawned = 0;
    w.nextSpawnAt = now;
    w.state = 'active';
    for (const [i, p] of room.players.entries()) {
      if (!p.alive)
        resetPlayer(p, {
          x: 8.5 + (i % 8) * 1.05,
          z: 1.5 + Math.floor(i / 8) * 0.8,
          yaw: Math.PI,
          monster: false,
        });
      p.side = 0;
      p.rescuedThisWave = false;
      p.battery = 1;
      p.light = false;
      p.health = 100;
      p.hasDecoy = true;
      p.spawnSafeUntil = now + 1000;
      if (w.number > 1) armPlayer(room, p);
    }
  }
  if (
    w.spawned < w.toSpawn &&
    room.players.filter((p) => p.enemy && p.alive).length < 4 &&
    now >= w.nextSpawnAt
  ) {
    const spawn = waveSpawn(room);
    if (spawn) {
      const p = {
        id: 'enemy-' + ++w.serial,
        name: '突袭者',
        bot: true,
        enemy: true,
        side: 1,
        kit: deployment('survival', { primary: 'rifle', character: 'operator' }),
      };
      resetPlayer(p, { ...spawn, yaw: 0, monster: false });
      p.health = room.difficulty === 'easy' ? 60 : room.difficulty === 'hard' ? 100 : 80;
      p.seenArrows = new Set();
      p.hasDecoy = false;
      p.battery = 1;
      p.light = false;
      armPlayer(room, p);
      room.players.push(p);
      w.spawned++;
    }
    w.nextSpawnAt = now + 1200;
  }
  if (w.spawned >= w.toSpawn && !room.players.some((p) => p.enemy && p.alive)) {
    if (w.number === 5) return 'secured';
    room.players = room.players.filter((p) => !p.enemy);
    w.state = 'break';
    w.nextAt = now + 6000;
  }
}

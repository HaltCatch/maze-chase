import { docksMap, docksSpawn, docksCores, docksDrops } from '../shared/docks.js';
import { cell, sight } from '../shared/world.js';

// Gun ladder adapted from Hazzad123/fully-ai-arena-fps server/modes.js (MIT).
// See LICENSES/arena-fps.txt; two eliminations per rung for our three authored firearms.
export const gunLadder = ['pistol', 'rifle', 'sniper'];
export const ladderWeapon = (room, p) =>
  gunLadder[Math.min(2, Math.floor(room.duel.scores[p.side] / 2))];
const scoreLimit = 3;
const eliminationLimit = 8;
const duelTime = 180000;
export const overtimeTime = 45000;
// One Flag CTF rule reference: Quake III g_team.c (no C source copied).
// Push into the enemy half. Both lanes remain valid, but each side has its own goals.
const destinations = (room, side) => {
  const end = (side + room.round + 1) % 2;
  return [docksDrops[end], docksDrops[end + 2]];
};
export const coreReturnTime = 15000;
export function tickCore(room, now) {
  const d = room.duel;
  if (d?.looseCore && !d.carrier && now >= d.returnAt) {
    d.looseCore = undefined;
    d.returnAt = undefined;
  }
}

export function startDuel(room, resetPlayer) {
  room.map = docksMap(room.arena);
  room.round++;
  room.switches = [];
  room.exit = undefined;
  room.duel = {
    scores: [0, 0],
    carrier: null,
    lockedUntil: 0,
    core: 0,
    drop: 0,
    overtime: false,
    decoys: [],
    eliminationWinner: undefined,
  };
  for (const [i, p] of room.players.entries()) {
    const base =
      room.mode === 'survival'
        ? { x: 8.5 + (i % 8) * 1.05, z: 1.5 + Math.floor(i / 8) * 0.8, yaw: Math.PI }
        : docksSpawn[(i + room.round) % 2];
    resetPlayer(p, {
      ...base,
      x:
        base.x +
        (room.mode === 'survival'
          ? 0
          : [0, -0.7, 0.7, -1.4, 1.4, -2.1, 2.1, -2.8][Math.floor(i / 2) % 8]),
      monster: false,
    });
    p.side = room.mode === 'survival' ? 0 : i % 2;
    p.hasDecoy = true;
    p.light = false;
    p.battery = 1;
  }
  room.phase = 'hunt';
  room.until =
    Date.now() + (room.mode === 'survival' ? 600000 : room.mode === 'gungame' ? 300000 : duelTime);
}

export function duelObjectives(room, side = 0) {
  const { duel } = room;
  return {
    carrier: duel.carrier,
    core: duel.looseCore ?? docksCores[duel.core],
    drops: destinations(room, side),
    lockedUntil: duel.lockedUntil,
  };
}

export function duelState(room, p, now) {
  const duel = room.duel;
  return {
    scores: duel.scores,
    side: p.side,
    goal: room.mode === 'gungame' ? 6 : room.mode === 'skirmish' ? eliminationLimit : scoreLimit,
    gungame: room.mode === 'gungame',
    survival: room.mode === 'survival',
    ...(room.wave
      ? {
          wave: {
            number: room.wave.number,
            total: 5,
            remaining:
              room.wave.toSpawn -
              room.wave.spawned +
              room.players.filter((q) => q.enemy && q.alive).length,
            pause: room.wave.state === 'break',
            next: Math.max(0, Math.ceil((room.wave.nextAt - now) / 1000)),
            allies: room.players
              .filter((q) => !q.enemy)
              .map((q) => ({
                name: q.name || 'AI 队友',
                health: q.health,
                alive: q.alive,
                self: q === p,
                rescueAvailable: !q.alive && !q.rescuedThisWave,
              })),
          },
        }
      : {}),
    possession:
      duel.carrier === p
        ? 'self'
        : duel.carrier
          ? duel.carrier.side === p.side
            ? 'ally'
            : 'opponent'
          : 'ground',
    ...(['skirmish', 'gungame', 'survival'].includes(room.mode)
      ? { skirmish: true }
      : {
          core: duel.looseCore ?? docksCores[duel.core],
          drop: destinations(room, p.side)[0],
          alternate: destinations(room, p.side)[1],
          returnIn: duel.looseCore ? Math.max(0, Math.ceil((duel.returnAt - now) / 1000)) : 0,
        }),
    blackout: room.blackout,
    light: p.light,
    battery: p.battery,
    protected: duel.lockedUntil > now,
    overtime: duel.overtime,
    hasDecoy: p.hasDecoy,
    decoys: duel.decoys.filter((d) => sight(room.map, p, d)).map(({ x, z }) => ({ x, z })),
  };
}

export function duelAction(room, p, now) {
  const duel = room.duel;
  tickCore(room, now);
  const near = (q, range) =>
    Math.abs((p.y ?? 0) - (q.y ?? 0)) < 0.7 &&
    Math.hypot(p.x - q.x, p.z - q.z) < range &&
    sight(room.map, p, q);
  if (!duel.carrier && near(duel.looseCore ?? docksCores[duel.core], 0.9)) {
    duel.carrier = p;
    duel.looseCore = undefined;
    duel.returnAt = undefined;
    p.spawnSafeUntil = 0;
    duel.lockedUntil = now + 1100;
    return;
  }
  if (duel.carrier === p && destinations(room, p.side).some((drop) => near(drop, 1.05))) {
    duel.scores[p.side]++;
    duel.carrier = null;
    duel.looseCore = undefined;
    duel.core = (duel.core + 1) % docksCores.length;
    duel.drop = (duel.drop + 1) % docksDrops.length;
    return duel.overtime || duel.scores[p.side] === scoreLimit ? p.side : undefined;
  }
  if (
    duel.carrier &&
    duel.carrier.side !== p.side &&
    now >= duel.lockedUntil &&
    near(duel.carrier, 1.25)
  ) {
    const dx = duel.carrier.x - p.x,
      dz = duel.carrier.z - p.z;
    if (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz < 0.35 * Math.hypot(dx, dz)) return;
    duel.carrier = p;
    duel.lockedUntil = now + 1450;
    p.spawnSafeUntil = 0;
  }
}

export function dropCore(room, p, now = Date.now()) {
  const duel = room.duel;
  duel.carrier = null;
  duel.lockedUntil = 0;
  duel.returnAt = now + coreReturnTime;
  // Snap to a walkable tile, with the station as a fallback for narrow barriers.
  if (cell(room.map, p.x, p.z) === '.')
    duel.looseCore = { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 };
  else duel.looseCore = undefined;
}

export function elimination(room, attacker) {
  const duel = room.duel;
  if (duel.eliminationWinner !== undefined) return;
  if (
    ++duel.scores[attacker.side] >= (room.mode === 'gungame' ? 6 : eliminationLimit) ||
    duel.overtime
  )
    duel.eliminationWinner = attacker.side;
}

export function duelWinner(room) {
  const [a, b] = room.duel.scores;
  return a === b ? null : Number(b > a);
}

// The listener gets the same coarse audio packet as a real runner, without a position.
export function throwDecoy(room, p, now) {
  if (!p.hasDecoy) return false;
  let x = p.x,
    z = p.z;
  for (let i = 1; i <= 16; i++) {
    const nx = p.x - Math.sin(p.yaw) * i * 0.24,
      nz = p.z - Math.cos(p.yaw) * i * 0.24;
    if (cell(room.map, nx, nz) === '#') break;
    x = nx;
    z = nz;
  }
  if (Math.hypot(x - p.x, z - p.z) < 0.7) return false;
  p.hasDecoy = false;
  room.duel.decoys.push({ owner: p, x, z, left: 5, next: now + 300 });
  return true;
}

export function decoyPulses(room, now) {
  const pulses = [];
  room.duel.decoys = room.duel.decoys.filter((decoy) => {
    if (decoy.next > now) return true;
    pulses.push(decoy);
    decoy.next = now + 390;
    return --decoy.left > 0;
  });
  return pulses;
}

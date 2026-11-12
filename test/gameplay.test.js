import assert from 'node:assert/strict';
import test from 'node:test';
import { docksCores, docksMap } from '../src/shared/docks.js';
import {
  canCatch,
  characterSight,
  clearTravel,
  climbOrJump,
  jump,
  ledge,
  maze,
  move,
  paths,
  sight,
  stepJump,
  stepMantle,
  stepStamina,
  STEP,
  WALL_HEIGHT,
} from '../src/shared/world.js';
import {
  decoyPulses,
  duelAction,
  duelState,
  elimination,
  startDuel,
  throwDecoy,
} from '../src/server/duel.js';
import { deployment, harborBody } from '../src/shared/arsenal.ts';
import { driveBot } from '../src/server/bot.js';
import {
  pickupAmmo,
  resetCombat,
  smokeBlocks,
  tickCombat,
  visibleShots,
  weaponInput,
} from '../src/server/combat.js';

const forward = { f: true, b: false, l: false, r: false, run: false, quiet: false };

test('grounded movement stops at the rail hurdle but jumping crosses it', () => {
  const map = docksMap('rail');
  const player = {
    x: 12.5,
    z: 7.7,
    y: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI,
    energy: 1,
    input: forward,
  };
  for (let i = 0; i < 12; i++) move(map, player, STEP);
  assert.ok(player.z < 8.12);
  assert.equal(jump(player, map), true);
  for (let i = 0; i < 20; i++) {
    stepJump(player, STEP, map);
    move(map, player, STEP);
    if (i === 3) assert.equal(jump(player, map), false);
  }
  assert.ok(player.z > 9);
  assert.equal(player.y, 0);
});

test('sprint exhaustion blocks acceleration until the recovery threshold', () => {
  const player = { energy: 1 };
  for (let i = 0; i < 65; i++) stepStamina(player, STEP, true);
  assert.equal(player.energy, 0);
  assert.equal(player.exhausted, true);
  for (let i = 0; i < 13; i++) stepStamina(player, STEP, false);
  assert.equal(player.energy, 0);
  for (let i = 0; i < 30; i++) stepStamina(player, STEP, false);
  assert.equal(player.exhausted, true);
  for (let i = 0; i < 10; i++) stepStamina(player, STEP, false);
  assert.equal(player.exhausted, false);
});

function duel() {
  const room = { arena: 'docks', round: 0, players: [{}, {}] };
  startDuel(room, (p, spawn) => Object.assign(p, spawn));
  return room;
}

test('either delivery dock can decide a tied game in overtime', () => {
  const room = duel();
  const player = room.players[0];
  Object.assign(player, docksCores[0]);
  duelAction(room, player, 1000);
  Object.assign(player, duelState(room, player, 2000).alternate);
  room.duel.overtime = true;
  assert.equal(duelAction(room, player, 3000), 0);
  assert.deepEqual(room.duel.scores, [1, 0]);
});

test('a decoy cannot be thrown into a wall and a successful throw pulses only five times', () => {
  const room = duel();
  const player = room.players[0];
  Object.assign(player, { x: 12.5, z: 1.3, yaw: 0 });
  assert.equal(throwDecoy(room, player, 1000), false);
  assert.equal(player.hasDecoy, true);
  Object.assign(player, { x: 12.5, z: 9.5, yaw: Math.PI });
  assert.equal(throwDecoy(room, player, 2000), true);
  assert.equal(throwDecoy(room, player, 2001), false);
  assert.equal(decoyPulses(room, 2299).length, 0);
  for (let i = 0; i < 5; i++) assert.equal(decoyPulses(room, 2300 + 390 * i).length, 1);
  assert.equal(decoyPulses(room, 8000).length, 0);
});

const testMaze = ['#######', '#.....#', '#.###.#', '#.....#', '#######'];

test('maze mantle lifts before moving through the wall plane, then supports walking and dropping', () => {
  const p = {
    x: 3.5,
    z: 1.68,
    y: 0,
    vy: 0,
    yaw: Math.PI,
    climbable: true,
    energy: 1,
    input: forward,
  };
  assert.equal(climbOrJump(testMaze, p), true);
  assert.ok(p.mantle);
  for (let i = 0; i < 9; i++) stepMantle(p, STEP);
  assert.equal(p.z, 1.68);
  while (p.mantle) stepMantle(p, STEP);
  assert.equal(p.y, WALL_HEIGHT);
  assert.equal(p.z, 2.5);
  p.yaw = -Math.PI / 2;
  for (let i = 0; i < 4; i++) move(testMaze, p, STEP);
  assert.ok(p.x > 3.5);
  assert.equal(p.y, WALL_HEIGHT);
  p.yaw = Math.PI;
  for (let i = 0; i < 20; i++) {
    stepJump(p, STEP, testMaze);
    move(testMaze, p, STEP);
  }
  assert.ok(p.z > 3.3);
  assert.equal(p.y, 0);
});

test('perimeter and non-climbing arenas reject mantling', () => {
  const p = { x: 3.5, z: 1.23, y: 0, vy: 0, yaw: 0, climbable: true };
  assert.equal(ledge(testMaze, p), null);
  p.yaw = Math.PI;
  p.z = 1.68;
  p.climbable = false;
  assert.equal(climbOrJump(testMaze, p), true);
  assert.equal(p.mantle, undefined);
  assert.ok(p.vy > 0);
});

test('the maze uses wall height for sight while ground targets remain occluded', () => {
  const a = { x: 3.5, z: 1.5, y: 0 },
    b = { x: 3.5, z: 3.5, y: 0 };
  assert.equal(sight(testMaze, a, b, true), false);
  assert.equal(sight(testMaze, { ...a, y: WALL_HEIGHT }, { ...b, y: WALL_HEIGHT }, true), true);
});

test('larger mazes keep all ground corridors connected', () => {
  for (const size of [23, 29])
    for (const seed of [1, 53, 701, 19486]) {
      const map = maze(size, seed);
      assert.equal(map.length, size);
      assert.equal(paths(map, [1, 1]).queue.length, map.join('').replaceAll('#', '').length);
    }
});

function combatFixture(x, z, targetX, targetZ, yaw = Math.PI, kit, mode = kit ? 'duel' : 'escape') {
  const player = {
    x,
    z,
    y: 0,
    yaw,
    kit,
    side: 0,
    alive: true,
    stunUntil: 0,
    input: { quiet: false },
  };
  const target = { ...player, x: targetX, z: targetZ, yaw: yaw + Math.PI, side: 1 };
  const room = {
    mode,
    phase: 'hunt',
    duel: { scores: [0, 0] },
    arena: 'docks',
    map: docksMap('docks'),
    players: [player, target],
  };
  const events = [];
  const send = (to, message) => events.push({ to, ...message });
  resetCombat(room);
  return { room, player, target, events, send };
}

test('bows require a draw and server swept shots hit the other player', () => {
  const { room, player, target, events, send } = combatFixture(12.5, 3.5, 12.5, 7.5);
  const fire = { type: 'weapon-fire', weapon: 'bow', pitch: 0.06 };
  weaponInput(room, player, fire, 1000, send);
  assert.equal(player.ammo.bow, 8);
  weaponInput(room, player, { type: 'weapon-ready', weapon: 'bow' }, 1000, send);
  weaponInput(room, player, fire, 1720, send);
  assert.equal(player.ammo.bow, 7);
  assert.equal(visibleShots(room, target)[0].kind, 'bow');
  for (let i = 0; i < 12; i++) tickCombat(room, 0.025, 1745 + i * 25, send);
  assert.ok(events.some((e) => e.type === 'weapon-hit' && e.to === target));
  assert.ok(events.some((e) => e.type === 'weapon-confirm' && e.to === player));
  assert.equal(room.shots.length, 0);
});

test('cannon shells strike cover and the cover blocks their blast', () => {
  const { room, player, target, events, send } = combatFixture(
    10.5,
    12.5,
    12.3,
    12.5,
    -Math.PI / 2,
  );
  weaponInput(room, player, { type: 'weapon-fire', weapon: 'cannon', pitch: 0 }, 1000, send);
  for (let i = 0; i < 10; i++) tickCombat(room, 0.025, 1025 + i * 25, send);
  const burst = events.find((e) => e.to === player && e.effect === 'burst');
  assert.ok(burst.point.x > 10.8 && burst.point.x < 11);
  assert.equal(target.stunUntil, 0);
  assert.equal(player.ammo.cannon, 1);
  assert.ok(!events.some((e) => e.to === target && e.effect === 'burst' && e.point));
});

test('flash grenade travels, bounces, then detonates once and stuns an exposed player', () => {
  const { room, player, target, events, send } = combatFixture(12.5, 3.5, 12.5, 11.9);
  const fire = { type: 'weapon-fire', weapon: 'flash', pitch: 0.06 };
  weaponInput(room, player, fire, 1000, send);
  for (let i = 0; i < 24; i++) tickCombat(room, 0.025, 1025 + i * 25, send);
  const [flying] = visibleShots(room, target);
  assert.equal(flying.kind, 'flash');
  assert.ok(flying.z > 7 && flying.y > 0.08);
  assert.ok(flying.vy > 0, 'grenade bounces before the fuse burns down');
  assert.ok(events.some((e) => e.effect === 'bounce'));
  assert.ok(!events.some((e) => e.effect === 'burst' || e.type === 'flash'));
  for (let i = 24; i < 55; i++) tickCombat(room, 0.025, 1025 + i * 25, send);
  assert.equal(events.filter((e) => e.to === target && e.effect === 'burst').length, 1);
  assert.ok(
    events.some(
      (e) => e.to === target && e.type === 'flash' && e.strength === 1 && e.duration === 1500,
    ),
  );
  assert.equal(player.ammo.flash, 0);
  weaponInput(room, player, fire, 2700, send);
  assert.equal(room.shots.length, 0);
});

test('arrows report their floor contact and direction for the landed model', () => {
  const { room, player, events, send } = combatFixture(12.5, 3.5, 13.7, 8);
  weaponInput(room, player, { type: 'weapon-ready', weapon: 'bow' }, 1000, send);
  weaponInput(room, player, { type: 'weapon-fire', weapon: 'bow', pitch: -0.22 }, 1720, send);
  for (let i = 0; i < 12; i++) tickCombat(room, 0.025, 1745 + i * 25, send);
  const landed = events.find((e) => e.to === player && e.effect === 'land');
  assert.ok(landed.floor);
  assert.ok(landed.point.y >= 0.035 && landed.point.y < 0.038);
  assert.ok(landed.direction[1] < 0);
  assert.ok(Math.abs(Math.hypot(...landed.direction) - 1) < 0.0001);
});

test('a drawn arrow starts ahead of the eye and turns with yaw and pitch', () => {
  const { room, player, send } = combatFixture(12.5, 3.5, 12.5, 9, -Math.PI / 2);
  weaponInput(room, player, { type: 'weapon-ready', weapon: 'bow' }, 1000, send);
  weaponInput(room, player, { type: 'weapon-fire', weapon: 'bow', pitch: 0.18 }, 1720, send);
  const [shot] = visibleShots(room, player);
  assert.ok(shot.x > player.x + 0.65);
  assert.ok(shot.vx > 23 && shot.vy > 4);
  assert.ok(Math.abs(shot.vz) < 0.5);
});

test('the solo harbor opponent can finish a match from both spawns on either map', () => {
  const idle = { ...forward, f: false };
  for (const arena of ['docks', 'rail'])
    for (const round of [0, 1]) {
      const player = {},
        bot = { bot: true };
      const room = { mode: 'duel', players: [player, bot], arena, difficulty: 'normal', round };
      startDuel(room, (p, spawn) =>
        Object.assign(p, spawn, {
          alive: true,
          energy: 1,
          input: idle,
          y: 0,
          vx: 0,
          vz: 0,
          vy: 0,
          stunUntil: 0,
          attack: 0,
        }),
      );
      resetCombat(room);
      assert.equal(room.phase, 'hunt');
      let winner;
      for (let tick = 1; tick <= 1200 && winner === undefined; tick++) {
        const now = tick * STEP * 1000;
        stepJump(bot, STEP, room.map);
        driveBot(
          room,
          bot,
          now,
          idle,
          () => {
            if (bot.attack > now) return;
            bot.attack = now + 650;
            winner = duelAction(room, bot, now);
          },
          (message) => weaponInput(room, bot, message, now, () => {}),
        );
        bot.carrying = room.duel.carrier === bot;
        move(room.map, bot, STEP);
        tickCombat(room, STEP, now, () => {});
      }
      assert.equal(winner, 1, arena + ' from round ' + round);
    }
});

test('the maze opponent reacts sooner at higher difficulty and cannot grab through a wall', () => {
  const idle = { ...forward, f: false };
  const run = (difficulty, map, otherX) => {
    const bot = {
      bot: true,
      monster: true,
      alive: true,
      climbable: true,
      x: 1.5,
      z: 1.5,
      y: 0,
      yaw: -Math.PI / 2,
      energy: 1,
      input: idle,
    };
    const other = { alive: true, x: otherX, z: 1.5, y: 0, vx: 0, vz: 0, input: idle };
    const room = { mode: 'escape', difficulty, map, players: [bot, other] };
    for (let now = 50; now <= 1000; now += 50) {
      let grabbed = false;
      driveBot(
        room,
        bot,
        now,
        idle,
        () => {
          grabbed = true;
        },
        () => {},
      );
      if (grabbed) return now;
    }
    return Infinity;
  };
  const corridor = ['#####', '#...#', '#####'];
  assert.ok(run('hard', corridor, 2.2) < run('easy', corridor, 2.2));
  assert.equal(run('hard', ['#####', '#.#.#', '#####'], 2.4), Infinity);
  assert.equal(run('hard', corridor, 2.4), Infinity);
});

test('bullets hit players and respect port cover without creating moving projectiles', () => {
  const open = combatFixture(12.5, 3.5, 12.5, 10, Math.PI, { primary: 'sniper' });
  open.room.duel.carrier = open.target;
  const fire = {
    type: 'weapon-fire',
    weapon: 'sniper',
    pitch: Math.atan2(1.1 - harborBody.standing.eye, 6.5),
  };
  weaponInput(open.room, open.player, fire, 1000, open.send);
  assert.equal(open.target.health, 24);
  assert.ok(
    open.events.some(
      (e) =>
        e.type === 'weapon-hit' && e.damage === 76 && e.health === 24 && Number.isFinite(e.bearing),
    ),
  );
  weaponInput(open.room, open.player, fire, 1600, open.send);
  assert.equal(open.player.ammo.sniper, 4);
  weaponInput(open.room, open.player, fire, 2200, open.send);
  assert.equal(open.target.alive, false);
  assert.equal(open.target.downUntil, 5600);
  assert.equal(open.room.duel.carrier, null);
  assert.deepEqual(open.room.duel.scores, [0, 0]);
  assert.deepEqual(open.room.duel.looseCore, { x: 12.5, z: 10.5 });
  assert.equal(open.room.shots.length, 0);

  const covered = combatFixture(10.5, 12.5, 12.3, 12.5, -Math.PI / 2, { primary: 'sniper' });
  weaponInput(covered.room, covered.player, fire, 1000, covered.send);
  assert.equal(covered.target.health, 100);
  assert.ok(
    covered.events.some(
      (e) => e.effect === 'trace' && e.impact === 'surface' && e.point.x > 10.999 && e.point.x < 11,
    ),
  );
});

test('reloading transfers only available reserve, and switching interrupts the reload', () => {
  const { room, player, send } = combatFixture(12.5, 3.5, 12.5, 10, Math.PI, {});
  player.ammo.rifle = 19;
  player.reserve.rifle = 6;
  const load = { type: 'weapon-reload', weapon: 'rifle' };
  weaponInput(room, player, load, 1000, send);
  weaponInput(room, player, { type: 'weapon-fire', weapon: 'rifle', pitch: 0 }, 1600, send);
  assert.equal(player.ammo.rifle, 19);
  weaponInput(room, player, { type: 'weapon-select', weapon: 'pistol' }, 1800, send);
  tickCombat(room, 0.05, 3000, send);
  assert.equal(player.ammo.rifle, 19);
  assert.equal(player.reserve.rifle, 6);
  weaponInput(room, player, load, 3100, send);
  tickCombat(room, 0.05, 4900, send);
  assert.equal(player.ammo.rifle, 25);
  assert.equal(player.reserve.rifle, 0);
});

test('only a nearby live player can consume a crate and it refills after cooldown', () => {
  const { room, player, target } = combatFixture(5.5, 3.5, 12.5, 10, Math.PI, {});
  assert.equal(pickupAmmo(room, target, 1000), false);
  assert.equal(pickupAmmo(room, player, 1000), true);
  assert.equal(player.reserve.rifle, 165);
  assert.equal(player.ammo.rifle, 30);
  assert.equal(pickupAmmo(room, player, 1200), false);
  assert.equal(pickupAmmo(room, player, 19100), true);
  assert.equal(player.reserve.rifle, 180);
  assert.equal(pickupAmmo(room, player, 40000), false);
});

test('flash and fragmentation grenades respect cover and have distinct effects', () => {
  for (const kind of ['flash', 'frag']) {
    const covered = combatFixture(10.5, 12.5, 12.3, 12.5, -Math.PI / 2, { throwable: kind });
    const { room, player, target, send, events } = covered;
    room.shots.push({
      kind,
      owner: player,
      id: 1,
      x: 10.86,
      y: 0.4,
      z: 12.5,
      age: 1.6,
      vx: 0,
      vy: 0,
      vz: 0,
    });
    tickCombat(room, 0.05, 2000, send);
    assert.equal(target.health, 100);
    assert.equal(target.stunUntil, 0);
    assert.ok(!events.some((e) => e.to === target && e.type === 'flash'));
    assert.equal(player.health < 100, kind === 'frag');
  }

  const { room, player, target, send, events } = combatFixture(12.5, 3.5, 12.5, 8);
  target.yaw = Math.PI;
  room.shots.push({
    kind: 'flash',
    owner: player,
    id: 1,
    x: 12.5,
    y: 0.25,
    z: 7,
    age: 1.14,
    vx: 0,
    vy: 0,
    vz: 0,
  });
  tickCombat(room, 0.05, 2000, send);
  assert.ok(
    events.some(
      (e) => e.to === target && e.type === 'flash' && e.strength < 0.5 && e.duration < 800,
    ),
  );
  assert.equal(target.health, 100);
});

test('deployment validates character and choices; switching or firing an unequipped item fails', () => {
  assert.deepEqual(
    deployment('duel', { character: 'constructor', primary: 'frag', throwable: 'bow' }),
    { character: 'ranger', primary: 'rifle', throwable: 'flash' },
  );
  assert.deepEqual(deployment('escape', { character: 'knight', primary: 'sniper' }), {
    character: 'knight',
  });
  const { room, player, target, send } = combatFixture(12.5, 3.5, 12.5, 10, Math.PI, {
    primary: 'sniper',
    throwable: 'frag',
  });
  assert.deepEqual(Object.keys(player.ammo), ['sniper', 'pistol', 'frag']);
  assert.deepEqual(Object.keys(player.reserve), ['sniper', 'pistol']);
  for (const weapon of ['rifle', 'flash', 'bow'])
    weaponInput(room, player, { type: 'weapon-fire', weapon, pitch: 0 }, 1000, send);
  assert.equal(target.health, 100);
  assert.equal(room.shotId, 0);
});

test('skirmish awards an elimination for a knockout, with no core or delivery in the snapshot', () => {
  const { room, player, target, send, events } = combatFixture(
    12.5,
    3.5,
    12.5,
    10,
    Math.PI,
    { primary: 'sniper' },
    'skirmish',
  );
  room.duel.decoys = [];
  room.duel.scores[0] = 7;
  target.health = 60;
  weaponInput(room, player, { type: 'weapon-fire', weapon: 'sniper', pitch: 0 }, 1000, send);
  assert.deepEqual(room.duel.scores, [8, 0]);
  assert.equal(room.duel.eliminationWinner, 0);
  assert.ok(events.some((e) => e.type === 'knockdown' && e.to === player));
  const snapshot = duelState(room, player, 1000);
  assert.equal(snapshot.skirmish, true);
  assert.equal(snapshot.core, undefined);
  elimination(room, target);
  assert.deepEqual(room.duel.scores, [8, 0]);
});

test('a fatal self grenade does not award skirmish points', () => {
  const { room, player, target, send } = combatFixture(
    12.5,
    3.5,
    12.5,
    10,
    Math.PI,
    { throwable: 'frag' },
    'skirmish',
  );
  room.shots.push({
    kind: 'frag',
    owner: player,
    id: 1,
    x: player.x,
    y: 1.05,
    z: player.z,
    age: 1.56,
    vx: 0,
    vy: 0,
    vz: 0,
  });
  tickCombat(room, 0.05, 1000, send);
  assert.equal(player.alive, false);
  assert.equal(target.health, 100);
  assert.deepEqual(room.duel.scores, [0, 0]);
});

test('smoke grows at the landing point, blocks sight but not bullets, and expires', () => {
  const { room, player, target, send, events } = combatFixture(12.5, 3.5, 12.5, 10, Math.PI, {
    throwable: 'smoke',
  });
  room.shots.push({
    kind: 'smoke',
    owner: player,
    id: 1,
    x: 12.5,
    y: 0.1,
    z: 7,
    age: 1.34,
    vx: 0,
    vy: 0,
    vz: 0,
  });
  tickCombat(room, 0.05, 2000, send);
  assert.equal(room.smokes.length, 1);
  assert.equal(smokeBlocks(room, player, target, 2000), false);
  assert.equal(smokeBlocks(room, player, target, 3400), true);
  assert.equal(smokeBlocks(room, { ...player, x: 16 }, { ...target, x: 16 }, 3400), false);
  assert.ok(!events.some((e) => e.type === 'flash'));
  weaponInput(room, player, { type: 'weapon-fire', weapon: 'rifle', pitch: 0 }, 3400, send);
  assert.equal(target.health, 52);
  assert.equal(smokeBlocks(room, player, target, 17000), false);
  tickCombat(room, 0.05, 17000, send);
  assert.deepEqual(room.smokes, []);
});

test('catch requires a close target in front, with a clear path at the same height', () => {
  const arena = ['#####', '#...#', '#.#.#', '#...#', '#####'];
  const hunter = { x: 1.5, z: 1.5, y: 0, yaw: -Math.PI / 2 };
  assert.equal(canCatch(arena, hunter, { x: 2.2, z: 1.5, y: 0 }), true);
  assert.equal(canCatch(arena, hunter, { x: 2.38, z: 1.5, y: 0 }), false);
  assert.equal(canCatch(arena, hunter, { x: 1.25, z: 1.5, y: 0 }), false);
  assert.equal(canCatch(arena, hunter, { x: 2.2, z: 1.5, y: WALL_HEIGHT }), false);
  const corner = { x: 1.77, z: 2.24, y: 0, yaw: (-3 * Math.PI) / 4 };
  const across = { x: 2.24, z: 1.77, y: 0 };
  assert.equal(clearTravel(arena, corner.x, corner.z, across.x, across.z, 0, true), false);
  assert.equal(canCatch(arena, corner, across), false);
});

test('full draw launches faster and an arrow in a wall is revealed to a later observer', () => {
  const fire = (drawTime, yaw = Math.PI) => {
    const kit = combatFixture(1.5, 1.5, 3.5, 3.5, yaw);
    kit.room.map = ['#####', '#...#', '###.#', '#...#', '#####'];
    kit.room.duel = null;
    weaponInput(kit.room, kit.player, { type: 'weapon-ready', weapon: 'bow' }, 1000, kit.send);
    weaponInput(
      kit.room,
      kit.player,
      { type: 'weapon-fire', weapon: 'bow', pitch: 0 },
      1000 + drawTime,
      kit.send,
    );
    return kit;
  };
  const short = fire(150);
  const full = fire(720, 0);
  const speed = ({ vx, vy, vz }) => Math.hypot(vx, vy, vz);
  assert.ok(speed(full.room.shots[0]) > speed(short.room.shots[0]) * 1.4);
  const { room, player, target, events, send } = full;
  tickCombat(room, 0.05, 1770, send);
  const landed = events.find((e) => e.to === player && e.effect === 'land');
  assert.equal(landed.floor, false);
  assert.ok(landed.point.z >= 1 && landed.point.z < 1.002 && landed.depth > 0.04);
  assert.ok(!events.some((e) => e.to === target && e.effect === 'land'));
  for (let t = 1820; t < 12000; t += 50) tickCombat(room, 0.05, t, send);
  target.z = 1.5;
  tickCombat(room, 0.05, 12000, send);
  tickCombat(room, 0.05, 12050, send);
  const revealed = events.filter((e) => e.to === target && e.effect === 'land');
  assert.deepEqual(
    revealed.map((e) => e.id),
    [landed.id],
  );
});

test('visible characters remain available far away and when only a shoulder clears a corner', () => {
  const open = Array.from({ length: 45 }, () => Array(45).fill('.'));
  assert.equal(characterSight(open, { x: 1.5, z: 1.5 }, { x: 39.5, z: 1.5 }), true);
  const corner = Array.from({ length: 10 }, () => Array(10).fill('.'));
  corner[5][5] = '#';
  const viewer = { x: 4.5, z: 4.2 },
    exposed = { x: 5.2, z: 6.5 };
  assert.equal(sight(corner, viewer, exposed), false);
  assert.equal(characterSight(corner, viewer, exposed), true);
  assert.equal(characterSight(corner, { x: 4.5, z: 5.5 }, { x: 6.5, z: 5.5 }), false);
});

test('crouching heads follow each authored character height rather than a uniform cylinder', () => {
  for (const character of ['operator', 'knight', 'rogue']) {
    const { room, player, target, send } = combatFixture(12.5, 3.5, 12.5, 10, Math.PI, {
      primary: 'sniper',
    });
    target.kit = { ...target.kit, character };
    target.input = { quiet: true };
    weaponInput(
      room,
      player,
      {
        type: 'weapon-fire',
        weapon: 'sniper',
        pitch: Math.atan2(1.28 - harborBody.standing.eye, 6.5),
      },
      1000,
      send,
    );
    assert.equal(target.health < 100, character !== 'operator');
  }
});

test('the same rifle applies head/body/leg damage and reports the authoritative region', () => {
  for (const [height, region, damage] of [
    [1.61, 'head', 48],
    [1.1, 'body', 24],
    [0.3, 'legs', 18],
  ]) {
    const { room, player, target, send, events } = combatFixture(12.5, 3.5, 12.5, 10, Math.PI, {});
    const pitch = Math.atan2(height - harborBody.standing.eye, 6.5);
    weaponInput(room, player, { type: 'weapon-fire', weapon: 'rifle', pitch }, 1000, send);
    assert.equal(target.health, 100 - damage);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'weapon-confirm' && event.region === region && event.damage === damage,
      ),
    );
  }
});

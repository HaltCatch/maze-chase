import { randomInt } from 'node:crypto';
import { PhysicsWorld } from '../../engine/physics.ts';
import { defineMap } from '../../content/maps.ts';
import { stepMovement } from '../../network/movement.ts';
import { stairAt } from '../../shared/stairs.ts';
import { Parkour } from '../modes/parkour.ts';
import {
  STEP,
  MAZE_SIZE,
  canCatch,
  characterSight,
  maze,
  neighbors,
  paths,
  sight,
} from '../../shared/world.js';
import {
  startDuel,
  tickCore,
  dropCore,
  duelState,
  duelAction,
  duelWinner,
  overtimeTime,
  throwDecoy,
  decoyPulses,
} from '../duel.js';

import { botDifficulty, driveBot } from '../bot.js';
import { startWaves, tickWaves, rescueAlly } from '../survival.js';
import { combatRespawn } from '../modes/respawn.ts';
import { deployment, harborMode, weapons } from '../../shared/arsenal.ts';
import {
  ammoNearby,
  pickupAmmo,
  resetCombat,
  armPlayer,
  smokeBlocks,
  tickCombat,
  visibleShots,
  weaponInput,
} from '../combat.js';

const empty = readMovement({});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
import { readMovement } from '../../shared/protocol.ts';
export class MatchSession {
  constructor(id, options, physics, notify, changed) {
    this.room = {
      id,
      mode: options.mode,
      arena: options.arena,
      blackout: !!options.blackout,
      difficulty: botDifficulty(options.difficulty),
      players: /** @type {import('../../shared/player.ts').Player[]} */ ([]),
      phase: 'lobby',
      revision: 0,
      round: 0,
      maxPlayers: options.maxPlayers,
      aiCount: options.aiCount,
      allowClimb: options.allowClimb === true,
      doubleJump: options.doubleJump === true,
      airJumpHeight: options.airJumpHeight ?? 1,
    };
    this.physics = physics;
    this.notify = notify;
    this.changed = changed;
    this.customMap = options.customMap;
  }
  add(id, name, connection) {
    const p = { id, name, connection, input: empty, kit: deployment(this.room.mode) };
    this.room.players.push(p);
    this.invalidate();
    this.lobby();
    return p;
  }
  invalidate() {
    this.room.revision++;
    for (const p of this.room.players) p.ready = false;
  }
  lobby() {
    const room = this.room,
      members = room.players
        .filter((p) => !p.bot)
        .map((p) => ({ id: p.id, name: p.name, ready: p.ready, character: p.kit.character }));
    for (const p of room.players)
      this.send(p, {
        type: 'lobby',
        room: room.id,
        revision: room.revision,
        members,
        mode: room.mode,
        arena: room.arena,
        blackout: room.blackout,
        host: p === room.players[0],
        count: members.length,
        maxPlayers: room.maxPlayers,
        aiCount: room.aiCount,
        allowClimb: room.allowClimb,
        doubleJump: room.doubleJump,
        airJumpHeight: room.airJumpHeight,
        difficulty: room.difficulty,
        kit: p.kit,
        active: room.phase !== 'lobby',
      });
    this.changed();
  }
  send = (p, data) => {
    if (!p.bot && p.connection) this.notify(p, data);
  };
  remove(p) {
    if (this.room.duel?.carrier === p) dropCore(this.room, p);
    this.world?.release(p);
    this.room.players = this.room.players.filter((q) => q !== p);
    if (this.room.phase !== 'lobby' && !this.room.players.some((q) => !q.bot))
      this.room.phase = 'lobby';
    this.invalidate();
    this.lobby();
  }
  dispose() {
    this.world?.dispose();
  }
  handle(player, m) {
    const room = this.room,
      now = Date.now(),
      send = this.send;
    if (m.type === 'hello' && typeof m.name === 'string') {
      player.name =
        m.name
          .replace(/[\p{C}]/gu, '')
          .trim()
          .slice(0, 18) || player.name;
      this.lobby();
    }
    if (m.type === 'deployment' && room.phase === 'lobby') {
      const kit = deployment(room.mode, m);
      if (JSON.stringify(kit) !== JSON.stringify(player.kit)) {
        player.kit = kit;
        this.invalidate();
        this.lobby();
      }
      return;
    }
    if (m.type === 'assets-ready' && room.phase === 'lobby' && m.revision === room.revision) {
      player.ready = true;
      this.lobby();
      return;
    }
    if (m.type === 'start' && player === room.players[0] && room.phase === 'lobby') {
      if (room.players.some((p) => !p.ready))
        return send(player, { type: 'error', message: '队友正在加载场景，稍后即可开始' });
      if (room.players.length === 1 || room.mode === 'survival')
        room.difficulty = botDifficulty(m.difficulty ?? room.difficulty);
      this.start();
    }
    if (m.type === 'scene-ready') {
      if (room.phase === 'lobby' || player.sceneReady) return;
      player.sceneReady = true;
      if (room.phase === 'hunt') player.spawnSafeUntil = now + 1000;
      return;
    }
    if (m.type === 'input' && room.phase !== 'lobby' && Number.isFinite(m.yaw)) {
      player.yaw = m.yaw % (Math.PI * 2);

      player.lastInput = now;
      player.inputAck = Number.isSafeInteger(m.seq) ? m.seq : player.inputAck;
    }
    if (m.type === 'parkour-use' && room.parkour && room.phase === 'hunt') {
      if (room.parkour.items.fire(player, m.pitch, now)) {
        player.firingUntil = now + 300;
        player.shotSequence = (player.shotSequence ?? 0) + 1;
        this.send(player, { type: 'parkour-launch' });
      }
    }
    if (m.type === 'action') this.touch(player);
    if (
      m.type === 'weapon-ready' ||
      m.type === 'weapon-fire' ||
      m.type === 'weapon-cancel' ||
      m.type === 'weapon-reload' ||
      m.type === 'weapon-select'
    ) {
      if (room.mode !== 'parkour') weaponInput(room, player, m, now, send);
    }
    const canMove =
      player.alive && player.stunUntil <= now && room.phase === 'hunt' && !room.caughtUntil;
    if (
      m.type === 'light' &&
      room.blackout &&
      canMove &&
      (player.light || player.battery >= 0.18)
    ) {
      player.light = !player.light;
    }
    if (m.type === 'decoy' && canMove && room.duel && room.phase === 'hunt') {
      if (!throwDecoy(room, player, now) && player.hasDecoy)
        send(player, { type: 'hint', message: '前方太近，找空处投放' });
    }
  }
  start() {
    const room = this.room;
    const solo = room.players.length === 1;
    const count = room.aiCount >= 0 ? room.aiCount : solo ? 1 : 0;
    for (let i = 0; i < count; i++)
      room.players.push({
        id: 'bot-' + i,
        bot: true,
        name: 'AI ' + (i + 1),
        kit: deployment(room.mode, { character: 'rogue', throwable: 'frag' }),
      });
    room.caughtUntil = 0;
    room.seed = randomInt(1, 2 ** 32);
    room.duel = undefined;
    room.parkour = undefined;
    if (room.mode === 'parkour') {
      room.parkour = new Parkour(this.customMap, room.arena);
      room.map = room.parkour.map.grid;
      room.switches = [];
      room.exit = undefined;
      for (const [i, p] of room.players.entries()) {
        resetPlayer(p, {
          ...room.parkour.startingPosition(i),
          yaw: room.parkour.map.spawnYaw ?? -Math.PI / 2,
          monster: false,
        });
        p.checkpoint = 0;
        p.falls = 0;
        p.finishedAt = undefined;
        p.highest = 0;
        p.collected = new Set();
        p.itemsTaken = new Set();
        p.airJumpUnlocked = false;
        p.rockets = 0;
        p.falling = false;
      }
      room.phase = 'hunt';
      room.until = Date.now() + (room.parkour.map.id === 'ascent' ? 1200000 : 600000);
      return this.sendStart();
    }
    if (harborMode(room.mode)) {
      startDuel(room, resetPlayer);
      return this.sendStart();
    }
    room.map = maze(MAZE_SIZE, room.seed);
    const from = paths(room.map, [1, 1]);
    const far = [...from.queue].sort(
      (a, b) => from.steps.get(b.join(',')).distance - from.steps.get(a.join(',')).distance,
    );
    const refuge = far[0];
    const endpoints = paths(room.map, refuge);
    const away = endpoints.queue.slice(Math.floor(endpoints.queue.length * 0.4));
    const exits = away.filter((p) => room.map[p[1]][p[0]] === '.');
    room.exit = point(exits[randomInt(exits.length)]);
    room.switches = [0.3, 0.65].map((ratio, i) => ({
      ...point(endpoints.queue[Math.floor(endpoints.queue.length * ratio) + randomInt(4)]),
      i,
      on: false,
    }));
    const monster =
      room.players.length > 1
        ? room.players[(room.round + (solo ? 1 : 0)) % room.players.length]
        : undefined;
    room.round++;
    let runner = 0;
    for (const p of room.players) {
      p.monster = p === monster;
      const [x, z] = p.monster ? [1, 1] : far[Math.min(far.length - 1, runner++ * 3)];
      const [nx, nz] = neighbors(room.map, x, z)[0];
      resetPlayer(p, {
        ...point([x, z]),
        yaw: Math.atan2(x - nx, z - nz),
        monster: p.monster,
        climbable: room.allowClimb,
      });
    }
    room.phase = 'hunt';
    room.until = Date.now() + 300000;
    return this.sendStart();
  }
  sendStart() {
    const room = this.room,
      send = this.send;
    this.world?.dispose();
    this.world = new PhysicsWorld(
      room.parkour?.map ?? defineMap(room.map, room.arena),
      this.physics,
    );
    resetCombat(room);
    for (const p of room.players) {
      p.maxJumps = room.parkour?.usesJumpPickup
        ? p.airJumpUnlocked
          ? 2
          : 1
        : room.doubleJump
          ? 2
          : 1;
      p.airJumpHeight = room.parkour?.usesJumpPickup ? 1 : room.airJumpHeight;
    }
    if (room.mode === 'survival') startWaves(room);
    const now = Date.now();
    room.duration = room.until - now;
    room.phase = 'loading';
    room.loadingAt = now;
    for (const p of room.players)
      if (!p.bot) {
        p.sceneReady = false;
        this.resume(p);
      }
    this.changed();
    return true;
  }
  resume(p) {
    p.sceneReady = false;
    const room = this.room,
      now = Date.now();
    this.send(p, {
      type: 'start',
      mode: room.mode,
      arena: room.arena,
      map: room.map,
      seed: room.seed,
      solo: room.players.some((player) => player.bot),
      difficulty: room.difficulty,
      kit: p.kit,
      definition: this.world.map,
      remaining: Math.ceil((room.until - now) / 1000),
      switches: room.switches,
      exit: room.exit,
      duel: room.duel && duelState(room, p, now),
      parkour: room.parkour?.snapshot(room.players, p),
      self: {
        x: p.x,
        z: p.z,
        y: p.y,
        vy: p.vy,
        grounded: p.grounded,
        jumpAck: p.jumpAck,
        maxJumps: p.maxJumps,
        airJumpHeight: p.airJumpHeight,
        jumpsUsed: p.jumpsUsed,
        jumpBuffer: p.jumpBuffer,
        coyote: p.coyote,
        yaw: p.yaw,
        energy: p.energy,
        monster: p.monster,
        climbable: !!p.climbable,
        alive: p.alive,
        ammo: p.ammo,
        reserve: p.reserve,
        currentWeapon: p.currentWeapon,
        health: p.health,
      },
    });
  }
  finish(result, winner) {
    const room = this.room,
      send = this.send;
    room.phase = 'lobby';
    room.players = room.players.filter((p) => !p.bot);
    for (const p of room.players)
      send(p, {
        type: 'end',
        result,
        winner,
        side: p.side,
        scores: room.duel?.scores,
        parkour: room.parkour?.snapshot(room.players, p),
      });
    this.lobby();
  }
  touch(p, now = Date.now()) {
    const room = this.room,
      send = this.send;
    if (room.mode === 'parkour') return;
    if (
      room.caughtUntil ||
      !p.alive ||
      p.mantle ||
      room.phase !== 'hunt' ||
      p.attack > now ||
      p.stunUntil > now
    )
      return;
    p.attack = now + 650;
    if (room.duel) {
      if (room.mode === 'survival') {
        const ally = rescueAlly(room, p, now);
        if (ally) {
          send(p, { type: 'hint', message: '已救起 ' + (ally.name || '队友') + ' · 50 HP' });
          send(ally, { type: 'hint', message: '队友已救起你 · 本波救援已使用' });
          return;
        }
      }
      const winner = room.mode === 'duel' ? duelAction(room, p, now) : undefined;
      if (winner !== undefined) this.finish('duel', winner);
      else if (pickupAmmo(room, p, now)) send(p, { type: 'hint', message: '已补充备用弹药' });
      return;
    }
    if (p.monster) {
      p.motionUntil = now + 460;
      p.swingYaw = p.yaw;
      const target = room.players.find((q) => !q.monster && q.alive && canCatch(room.map, p, q));
      if (target) p.swing = { at: now + 180, yaw: p.yaw, target };
      send(p, { type: 'hint', message: target ? '挥爪 · 抓捕中' : '挥空 · 靠近并面向对手再抓捕' });
    } else {
      const lever = room.switches.find(
        (q) => !q.on && p.y < 0.7 && distance(p, q) < 0.85 && sight(room.map, p, q, true),
      );
      if (lever) lever.on = true;
      if (
        room.switches.every((q) => q.on) &&
        p.y < 0.7 &&
        distance(p, room.exit) < 0.85 &&
        sight(room.map, p, room.exit, true)
      )
        this.finish('escaped');
    }
  }
  tick(commands = new Map()) {
    const now = Date.now();
    const room = this.room,
      send = this.send;
    for (const current of [room]) {
      if (room.phase === 'lobby') continue;
      if (room.phase === 'loading') {
        if (room.players.filter((p) => !p.bot).every((p) => p.sceneReady)) {
          room.phase = 'hunt';
          room.until = now + room.duration;
          if (room.parkour) room.parkour.started = now;
          this.changed();
        } else if (now - room.loadingAt > 45000) this.finish('load-failed');
        continue;
      }
      if (room.caughtUntil) {
        if (now >= room.caughtUntil) this.finish('caught');
        continue;
      }
      if (room.mode === 'duel') tickCore(room, now);
      if (room.mode === 'survival') {
        const result = tickWaves(room, now, resetPlayer, armPlayer);
        if (result) {
          this.finish(result);
          continue;
        }
      }
      if (room.until <= now) {
        if (room.mode === 'survival') {
          this.finish('overrun');
          continue;
        }
        if (room.duel && !room.duel.overtime && duelWinner(room) === null) {
          room.duel.overtime = true;
          room.until = now + overtimeTime;
        } else {
          if (room.duel) this.finish('duel', duelWinner(room));
          else this.finish(room.mode === 'parkour' ? 'parkour-ended' : 'timeout');
          continue;
        }
      }
      for (const p of room.players) {
        if (!p.alive) {
          if (!room.duel || room.mode === 'survival' || p.downUntil > now) continue;
          const spawn = combatRespawn(room, p);
          resetPlayer(p, { ...spawn, monster: false });
          p.health = 100;
          armPlayer(room, p);
          p.spawnSafeUntil = now + 850;
        }
        if (room.blackout) {
          p.battery = Math.max(0, Math.min(1, p.battery + STEP * (p.light ? -0.082 : 0.115)));
          if (p.battery === 0) p.light = false;
        }
        if (p.bot) {
          driveBot(
            room,
            p,
            now,
            empty,
            () => this.touch(p, now),
            (message) => weaponInput(room, p, message, now, send),
          );
          p.input = { ...p.input, moveX: +p.input.r - +p.input.l, moveZ: +p.input.f - +p.input.b };
        }
        if (room.phase === 'lobby') break;
        if (!p.bot && now - p.lastInput > 350) p.input = empty;
        p.carrying = room.duel?.carrier === p;
        p.maxJumps = room.parkour?.usesJumpPickup
          ? p.airJumpUnlocked
            ? 2
            : 1
          : room.doubleJump
            ? 2
            : 1;
        p.airJumpHeight = room.parkour?.usesJumpPickup ? 1 : room.airJumpHeight;
        p.locked = !p.alive || p.stunUntil > now;
        const cmd = commands.get(p.id);
        if (p.bot) {
          stepMovement(p, { ...p.input, yaw: p.yaw, jump: p.jumpAck }, this.world, STEP);
        } else if (cmd) {
          p.lastInput = now;
          stepMovement(p, cmd, this.world, STEP);
        } else {
          stepMovement(
            p,
            { moveX: 0, moveZ: 0, quiet: p.input.quiet, run: false, yaw: p.yaw, jump: p.jumpAck },
            this.world,
            STEP,
          );
        }
        if (room.parkour) {
          const event = room.parkour.tick(p, now);
          if (event.fell) this.send(p, { type: 'parkour-fall' });
          if (event.hit) this.send(p, { type: 'parkour-bump' });
        }
      }
      if (room.phase === 'lobby') continue;
      if (room.parkour)
        for (const point of room.parkour.items.tick(room.players, STEP))
          for (const p of room.players) this.send(p, { type: 'parkour-impact', point });
      this.world.retain(room.players);
      tickCombat(room, STEP, now, send);
      if (room.duel?.eliminationWinner !== undefined) {
        this.finish('duel', room.duel.eliminationWinner);
        continue;
      }
      for (const hunter of room.players) {
        const swing = hunter.swing;
        if (!swing || now < swing.at) continue;
        hunter.swing = null;
        if (!hunter.alive || hunter.mantle || hunter.stunUntil > now) continue;
        const victim = swing.target;
        if (victim.alive && canCatch(room.map, hunter, victim, swing.yaw)) {
          victim.alive = false;
          if (!room.players.some((q) => !q.monster && q.alive)) room.caughtUntil = now + 900;
          send(victim, { type: 'caught' });
        }
      }
      const decoys = room.duel ? decoyPulses(room, now) : [];
      for (const p of room.players)
        if (!p.bot) {
          const visible = room.players.filter(
            (q) =>
              p !== q &&
              (q.alive || (room.mode === 'survival' && !q.enemy)) &&
              (room.parkour || characterSight(room.map, p, q, !room.duel)) &&
              !smokeBlocks(room, p, q, now),
          );
          const noises =
            room.phase === 'hunt' && Math.floor(now / 50) % 10 === 0
              ? room.players
                  .filter(
                    (q) =>
                      q !== p &&
                      q.alive &&
                      moving(q) &&
                      q.stunUntil <= now &&
                      (!q.input.quiet || q.monster || q.carrying) &&
                      distance(p, q) < (q.carrying ? 11 : Math.hypot(q.vx, q.vz) > 3.75 ? 6 : 3.2),
                  )
                  .map((q) => ({
                    bearing: Math.round(Math.atan2(p.x - q.x, p.z - q.z) / (Math.PI / 4)),
                    heavy: q.monster || q.carrying,
                    stairs: !!room.parkour && !!stairAt(room.parkour.map, q),
                    gain: distance(p, q) < 2 ? 1 : distance(p, q) < 5 ? 0.68 : 0.42,
                  }))
              : [];
          for (const decoy of decoys) {
            if (decoy.owner === p || distance(p, decoy) >= 8) continue;
            noises.push({
              bearing: Math.round(Math.atan2(p.x - decoy.x, p.z - decoy.z) / (Math.PI / 4)),
              heavy: true,
              gain: 0.68,
            });
          }
          send(p, {
            type: 'state',
            parkour: room.parkour?.snapshot(room.players, p),
            phase: room.caughtUntil ? 'caught' : room.phase,
            remaining: Math.ceil((room.until - now) / 1000),
            self: {
              inputAck: p.inputAck ?? 0,
              grounded: p.grounded,
              x: p.x,
              z: p.z,
              vx: p.vx,
              vz: p.vz,
              y: p.y,
              vy: p.vy,
              mantle: p.mantle,
              jumpAck: p.jumpAck,
              energy: p.energy,
              shield: !!p.shield,
              exhausted: p.exhausted,
              recovery: p.recovery,
              alive: p.alive,
              ammo: p.ammo,
              reserve: p.reserve,
              currentWeapon: p.currentWeapon,
              health: p.health,
              respawn: p.alive ? 0 : Math.max(0, p.downUntil - now),
              reload: p.reload && {
                name: p.reload.name,
                remaining: Math.max(0, p.reload.until - now),
                duration: weapons[p.reload.name].reload,
              },
              stunned: p.stunUntil > now,
            },
            switches: room.switches,
            duel: room.duel && duelState(room, p, now),
            shots: visibleShots(room, p),
            pickups: ammoNearby(room, p, now),
            smokes: room.smokes.map(({ id, x, z, started }) => ({ id, x, z, age: now - started })),
            players: visible.map((q) => ({
              id: q.id,
              bot: !!q.bot,
              character: q.kit?.character,
              weapon: !q.alive
                ? undefined
                : room.parkour
                  ? q.rockets > 0 || q.firingUntil > now
                    ? 'cannon'
                    : undefined
                  : q.heldWeapon,
              shotSequence: q.shotSequence ?? 0,
              throwing: q.alive && q.throwingUntil > now,
              reloading: q.alive && !!q.reload,
              firing: q.alive && q.firingUntil > now,
              friendly: !!room.duel && q.side === p.side,
              health: room.duel ? q.health : undefined,
              downed: !q.alive,
              rescueAvailable: !q.alive && !q.rescuedThisWave,
              x: q.x,
              z: q.z,
              y: q.y,
              yaw: q.monster && q.motionUntil > now ? q.swingYaw : q.yaw,
              monster: q.monster,
              carrying: q.carrying,
              light: q.light,
              motion: motion(q, now),
              stairs: room.parkour ? stairAt(room.parkour.map, q)?.id : undefined,
            })),
            noises,
          });
        }
    }
  }
}
function point([x, z]) {
  return { x: x + 0.5, z: z + 0.5 };
}
function resetPlayer(p, spawn) {
  Object.assign(p, spawn, {
    climbable: !!spawn.climbable,
    energy: 1,
    recovery: 0,
    exhausted: false,
    vy: 0,
    jumpAck: 0,
    jumpBuffer: 0,
    coyote: 0,
    jumpsUsed: 0,
    vx: 0,
    vz: 0,
    alive: true,
    input: empty,
    lastInput: 0,
    attack: 0,
    swing: null,
    stunUntil: 0,
    spawnSafeUntil: 0,
    landUntil: 0,
    mantle: null,
    brain: null,
    motionUntil: 0,
    firingUntil: 0,
    carrying: false,
    y: spawn.y ?? 0,
    grounded: false,
    boosted: false,
    airPeak: undefined,
    shield: false,
    rockets: 0,
    itemsTaken: new Set(),
    itemReady: 0,
  });
}

function moving(p) {
  return p.input.f || p.input.b || p.input.l || p.input.r;
}
function motion(p, now) {
  if (!p.alive) return 'hide';
  if (p.mantle) return 'mantle';
  if (p.stunUntil > now) return 'idle';
  if (p.motionUntil > now) return 'attack';
  if (p.vy > 1.15) return 'jump';
  if (p.vy) return 'air';
  if (p.landUntil > now) return 'land';
  const speed = Math.hypot(p.vx, p.vz);
  if (p.input.quiet && !p.monster) return speed > 0.15 ? 'crouch' : 'hide';
  if (speed < 0.15) return p.firingUntil > now ? p.firingPose : 'idle';
  return speed > 3.75 ? 'run' : 'walk';
}

import {
  canCatch,
  cell,
  climbOrJump,
  ledge,
  neighbors,
  paths,
  sight,
  WALL_HEIGHT,
} from '../shared/world.js';
import { weapons } from '../shared/arsenal.ts';
import { smokeBlocks } from './combat.js';
import { duelObjectives } from './duel.js';

// Separate perception and execution so difficulty can vary without changing the rules.
const levels = {
  easy: {
    reaction: 520,
    interval: 220,
    vision: 8,
    fov: 0.12,
    hearing: 0.72,
    memory: 2300,
    spread: 0.16,
    shotInterval: 650,
    sprint: 1.01,
  },
  normal: {
    reaction: 300,
    interval: 150,
    vision: 11,
    fov: -0.12,
    hearing: 1,
    memory: 4100,
    spread: 0.08,
    shotInterval: 450,
    sprint: 0.52,
  },
  hard: {
    reaction: 150,
    interval: 100,
    vision: 14,
    fov: -0.3,
    hearing: 1.25,
    memory: 6000,
    spread: 0.035,
    shotInterval: 295,
    sprint: 0.24,
  },
};
export const botDifficulty = (value) =>
  typeof value === 'string' && Object.hasOwn(levels, value) ? value : 'normal';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const tile = (p) => [Math.floor(p.x), Math.floor(p.z)];
const center = ([x, z]) => ({ x: x + 0.5, z: z + 0.5 });
const bearing = (a, b) => Math.atan2(a.x - b.x, a.z - b.z);

function observe(room, bot, other, brain, skill, now) {
  if (now < brain.observeAt) return;
  brain.observeAt = now + skill.interval;
  const range = distance(bot, other);
  const canSee =
    other.alive &&
    range < skill.vision * (room.blackout && !bot.light ? 0.52 : 1) &&
    (range < 2 || Math.cos(bot.yaw - bearing(bot, other)) >= skill.fov) &&
    sight(room.map, bot, other, bot.climbable) &&
    !smokeBlocks(room, bot, other, now);
  if (canSee) {
    if (!brain.visible) brain.reactAt = now + skill.reaction;
    brain.trail = { x: other.x, y: other.y, z: other.z, until: now + skill.memory };
  } else if (
    other.alive &&
    (!other.input.quiet || other.carrying || other.monster) &&
    Math.hypot(other.vx, other.vz) > 0.4 &&
    range < skill.hearing * (other.input.run ? 5.5 : 2.6)
  ) {
    brain.trail = { ...center(tile(other)), until: now + skill.memory };
  }
  brain.visible = canSee;
  if (brain.trail?.until < now) brain.trail = null;
}

function routeTo(room, bot, brain, goal) {
  const from = tile(bot);
  const key = from.join(',');
  if (brain.routeKey !== key) {
    brain.routeKey = key;
    brain.route = paths(room.map, from);
  }
  if (!goal) {
    if (!brain.patrol || distance(bot, brain.patrol) < 0.3) {
      const { queue } = brain.route;
      brain.patrol = center(queue[Math.floor(queue.length * (0.5 + Math.random() * 0.5))]);
    }
    goal = brain.patrol;
  }
  let step = brain.route.steps.get(tile(goal).join(','));
  if (!step && bot.y < WALL_HEIGHT) {
    const nearest = neighbors(room.map, ...tile(goal))
      .map((location) => ({ location, step: brain.route.steps.get(location.join(',')) }))
      .filter((candidate) => candidate.step)
      .sort((a, b) => a.step.distance - b.step.distance)[0];
    if (nearest) {
      goal = center(nearest.location);
      step = nearest.step;
    }
  }
  if (bot.y >= WALL_HEIGHT && bot.climbable) {
    if (step) return goal;
    const open = brain.route.queue.find(([x, z]) => room.map[z][x] !== '#');
    return open ? center(open) : null;
  }
  if (!step) return null;
  if (!step.distance) return goal;
  // Centre inside the current lane before rounding a corner.
  const midpoint = center(from);
  const next = center(step.next);
  const offLane =
    next.x !== midpoint.x ? Math.abs(bot.z - midpoint.z) : Math.abs(bot.x - midpoint.x);
  return offLane > 0.15 ? midpoint : next;
}

function shoot(room, bot, brain, other, skill, now, sendWeapon) {
  const range = distance(bot, other);
  if (
    !other.alive ||
    range < 0.35 ||
    range > 9 ||
    !brain.visible ||
    now < brain.reactAt ||
    !sight(room.map, bot, other) ||
    smokeBlocks(room, bot, other, now) ||
    bot.weaponReady > now ||
    bot.reload
  )
    return false;
  const preferred = bot.currentWeapon || (room.difficulty === 'easy' ? 'pistol' : 'rifle');
  const primary = [preferred, 'pistol', 'rifle'].find(
    (name) => bot.ammo[name] || bot.reserve[name],
  );
  if (!primary) return false;
  if (!bot.ammo[primary]) {
    sendWeapon({ type: 'weapon-reload', weapon: primary });
    return false;
  }
  if (now < (brain.nextShot ?? 0)) return false;
  const aim = brain.trail;
  bot.yaw = bearing(bot, aim) + (Math.random() - 0.5) * skill.spread;
  brain.nextShot = now + skill.shotInterval;
  const pitch = Math.atan2((aim.y ?? 0) - bot.y - 0.2, range);
  sendWeapon({ type: 'weapon-fire', weapon: primary, pitch });
  return true;
}

export function driveBot(room, bot, now, empty, touch, sendWeapon) {
  if (bot.monster && bot.swing) {
    bot.input = empty;
    return;
  }
  const other = room.players
    .filter((p) => p !== bot && (room.duel ? p.side !== bot.side : !!p.monster !== !!bot.monster))
    .sort((a, b) => Number(b.alive) - Number(a.alive) || distance(bot, a) - distance(bot, b))[0];
  if (!other) {
    bot.input = empty;
    return;
  }
  const skill = levels[room.difficulty];
  const brain = (bot.brain ??= { observeAt: 0, reactAt: 0 });
  if (brain.targetId !== other.id) {
    brain.targetId = other.id;
    brain.visible = false;
    brain.trail = null;
    brain.observeAt = 0;
  }
  observe(room, bot, other, brain, skill, now);
  const ready = other.alive && brain.visible && now >= brain.reactAt;
  const range = distance(bot, other);
  const sprint = skill.sprint <= bot.energy;
  let goal,
    action = false,
    run = false;
  if (room.duel) {
    if (room.blackout) bot.light = bot.battery > (bot.light ? 0.08 : 0.65);
    const { carrier, core, drops, lockedUntil } = duelObjectives(room, bot.side);
    if (room.mode !== 'duel') {
      goal = brain.trail || (room.mode === 'survival' ? other : null);
      if (!ready && goal && distance(bot, goal) < 0.35) goal = brain.trail = null;
      run = sprint;
    } else if (carrier === bot) {
      routeTo(room, bot, brain, null);
      goal = drops.reduce((a, b) =>
        (brain.route.steps.get(tile(a).join(','))?.distance ?? Infinity) <=
        (brain.route.steps.get(tile(b).join(','))?.distance ?? Infinity)
          ? a
          : b,
      );
      action = distance(bot, goal) < 1;
    } else if (!carrier) {
      goal = core;
      action = distance(bot, goal) < 0.85;
      run = sprint;
    } else {
      goal = brain.trail || duelObjectives(room, carrier.side).drops[0];
      action = ready && range < 1.2 && now >= lockedUntil;
      run = sprint;
    }
    if (
      !carrier &&
      !Object.entries(bot.ammo).some(
        ([name, count]) => weapons[name].projectile === 'bullet' && count,
      ) &&
      !Object.values(bot.reserve).some(Boolean)
    ) {
      const box = (room.pickups ?? [])
        .filter((item) => item.availableAt <= now)
        .sort((a, b) => distance(bot, a) - distance(bot, b))[0];
      if (box) {
        goal = box;
        action = distance(bot, box) < 0.85;
      }
    }
    if (!action && carrier !== bot && shoot(room, bot, brain, other, skill, now, sendWeapon)) {
      bot.input = empty;
      return;
    }
    // Arena server/ai.js (MIT): keep a weapon-dependent engagement distance,
    // retreat when crowded and strafe between shots instead of running into the target.
    if (
      ready &&
      carrier !== bot &&
      range < 9 &&
      sight(room.map, bot, other) &&
      !smokeBlocks(room, bot, other, now)
    ) {
      if (now >= (brain.strafeUntil ?? 0)) {
        brain.strafeDir = Math.random() < 0.5 ? -1 : 1;
        brain.strafeUntil = now + 900 + Math.random() * 1700;
      }
      const preferred = bot.currentWeapon === 'sniper' ? 7 : 4;
      bot.yaw = bearing(bot, other);
      bot.input = {
        ...empty,
        f: range > preferred * 1.18,
        b: range < preferred * 0.68,
        l: brain.strafeDir < 0,
        r: brain.strafeDir > 0,
      };
      return;
    }
  } else if (bot.monster) {
    goal = brain.trail;
    if (goal && !brain.visible && distance(bot, goal) < 0.26) goal = brain.trail = null;
    run = ready && sprint && range > 1.6;
    action = ready && canCatch(room.map, bot, other, bearing(bot, other));
    if (ready && brain.trail.y >= WALL_HEIGHT && range < 2.4) {
      bot.yaw = bearing(bot, brain.trail);
      if (ledge(room.map, bot)) climbOrJump(room.map, bot);
    }
  } else {
    goal = room.switches.find((lever) => !lever.on) || room.exit;
    action = distance(bot, goal) < 0.8;
    run = ready && sprint;
  }

  const target = routeTo(room, bot, brain, goal);
  if (action) {
    if (bot.monster || room.duel?.carrier === other) bot.yaw = bearing(bot, other);
    touch(room, bot);
    if (bot.swing) {
      bot.input = empty;
      return;
    }
  }
  if (target && distance(bot, target) > 0.145) {
    bot.yaw = bearing(bot, target);
    // The existing movement and jump code applies to both humans and bots.
    if (
      room.duel &&
      !bot.vy &&
      cell(room.map, bot.x - Math.sin(bot.yaw) * 0.68, bot.z - Math.cos(bot.yaw) * 0.68) === '+'
    ) {
      climbOrJump(room.map, bot);
    }
    bot.input = { ...empty, f: true, run };
  } else {
    bot.input = empty;
    if (!brain.visible && !goal) bot.yaw += 0.12;
  }
}

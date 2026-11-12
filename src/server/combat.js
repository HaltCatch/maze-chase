import { defineMap, obstructed } from '../content/maps.ts';
import { bulletRegion, damageMultiplier } from '../shared/hit-regions.ts';
import { advanceGrenade } from '../shared/grenade.js';
import {
  arrowLength,
  bowLine,
  bowMinDraw,
  deployment,
  characterPosture,
  harborBody,
  harborMode,
  maxEmbeddedArrows,
  smokeDuration,
  smokeShape,
  weapons,
} from '../shared/arsenal.ts';
import { arenas, DOCKS_SIZE } from '../shared/docks.js';
import { dropCore, elimination, ladderWeapon } from './duel.js';
import { cell, wallHeightAt, HURDLE_DEPTH, HURDLE_HEIGHT } from '../shared/world.js';

export function resetCombat(room) {
  room.shots = [];
  room.shotId = 0;
  room.smokes = [];
  room.embedded = [];
  room.pickups = room.duel
    ? [
        [5.5, 3.5],
        [19.5, 21.5],
        [5.5, 21.5],
        [19.5, 3.5],
      ]
        .filter(([x, z]) => cell(room.map, x, z) === '.')
        .map(([x, z], id) => ({ id, x, z, availableAt: 0 }))
    : [];
  for (const player of room.players) {
    armPlayer(room, player);
    player.health = 100;
    player.downUntil = 0;
    player.seenArrows = new Set();
  }
}

export function armPlayer(room, player) {
  const kit = deployment(room.mode, player.kit);
  const allowed =
    room.mode === 'parkour'
      ? []
      : room.mode === 'gungame'
        ? [ladderWeapon(room, player)]
        : kit.primary
          ? [kit.primary, 'pistol', kit.throwable]
          : ['bow', 'cannon', 'flash'];
  player.ammo = player.monster
    ? {}
    : Object.fromEntries(allowed.map((name) => [name, weapons[name].ammo]));
  player.reserve = room.duel
    ? Object.fromEntries(
        allowed.filter((name) => weapons[name].reload).map((name) => [name, weapons[name].reserve]),
      )
    : {};
  player.currentWeapon = room.mode === 'gungame' ? allowed[0] : undefined;
  player.heldWeapon = player.monster ? null : allowed[0];
  player.reload = null;
  player.weaponReady = 0;
  player.bowSince = null;
}

const canFire = (room, player, now) =>
  room.phase === 'hunt' &&
  player.alive &&
  !player.monster &&
  !player.mantle &&
  player.stunUntil <= now;
const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const posture = (player) => characterPosture(player.kit?.character, !!player.input?.quiet);
const eye = (room, p) => ({
  x: p.x,
  y: (p.y ?? 0) + (p.monster ? 1.62 : posture(p).eye),
  z: p.z,
});

function obstacle(room, x, y, z) {
  if (y <= 0.035) return true;
  return obstructed(defineMap(room.map, room.arena), x, y, z);
}

function exposed(room, from, to) {
  const steps = Math.ceil(length(from, to) * 10);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (
      obstacle(
        room,
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        from.z + (to.z - from.z) * t,
      )
    )
      return false;
  }
  return true;
}

export function smokeBlocks(room, a, b, now) {
  if (!room.smokes?.length) return false;
  const dx = b.x - a.x,
    dz = b.z - a.z,
    lengthSq = dx * dx + dz * dz;
  return room.smokes.some((cloud) => {
    const { radius, density } = smokeShape(now - cloud.started);
    if (density < 0.32) return false;
    const t =
      lengthSq > 0.001
        ? Math.min(1, Math.max(0, ((cloud.x - a.x) * dx + (cloud.z - a.z) * dz) / lengthSq))
        : 0;
    const fromHeight = eye(room, a).y;
    const toHeight = eye(room, b).y;
    const y = fromHeight + (toHeight - fromHeight) * t - 0.95;
    return (
      (a.x + dx * t - cloud.x) ** 2 + (a.z + dz * t - cloud.z) ** 2 + (y * 1.55) ** 2 <
      (radius * 0.82) ** 2
    );
  });
}

function event(room, send, shot, effect, details) {
  const point = { x: shot.x, y: shot.y, z: shot.z };
  for (const p of room.players) {
    if (p !== shot.owner && (!p.alive || length(eye(room, p), point) > 18)) continue;
    // Geometry and light are only revealed to clients with line of sight.
    const seen = exposed(room, eye(room, p), point);
    send(p, {
      type: 'weapon-effect',
      weapon: shot.kind,
      effect,
      own: p === shot.owner,
      ...(seen ? { ...details, point } : {}),
    });
  }
}

export function ammoNearby(room, p, now) {
  return room.pickups?.filter(
    (item) =>
      item.availableAt <= now &&
      Math.hypot(p.x - item.x, p.z - item.z) < 17 &&
      exposed(room, eye(room, p), { x: item.x, y: 0.24, z: item.z }),
  );
}

export function pickupAmmo(room, p, now) {
  if (!room.duel || !canFire(room, p, now) || p.y > 0.65) return false;
  const item = ammoNearby(room, p, now)?.find((box) => Math.hypot(p.x - box.x, p.z - box.z) < 0.95);
  if (!item) return false;
  let added = 0;
  for (const name of Object.keys(p.reserve)) {
    const spec = weapons[name];
    const count = Math.min(spec.pickup, spec.maxReserve - p.reserve[name]);
    p.reserve[name] += count;
    added += count;
  }
  if (added) item.availableAt = now + 18000;
  return added > 0;
}

function resolveReload(p, now) {
  if (!p.reload || now < p.reload.until) return;
  const { name } = p.reload;
  const rounds = Math.min(p.reserve[name], weapons[name].ammo - p.ammo[name]);
  p.ammo[name] += rounds;
  p.reserve[name] -= rounds;
  p.reload = null;
}

export function hurt(room, p, damage, now, send, kind, owner, region) {
  if (!p.alive || p.spawnSafeUntil > now || (room.duel && owner !== p && owner.side === p.side))
    return false;
  const lost = Math.min(p.health, damage);
  p.health -= lost;
  const bearing = owner === p ? undefined : Math.atan2(p.x - owner.x, p.z - owner.z);
  send(p, { type: 'weapon-hit', weapon: kind, damage: lost, health: p.health, bearing, region });
  if (p.health > 0) return true;
  p.alive = false;
  p.downUntil = now + 3400;
  p.reload = null;
  p.bowSince = null;
  if (room.duel.carrier === p) dropCore(room, p, now);
  if (owner !== p && ['skirmish', 'gungame'].includes(room.mode)) elimination(room, owner);
  if (room.mode === 'gungame' && owner !== p)
    for (const teammate of room.players)
      if (
        teammate.side === owner.side &&
        teammate.alive &&
        teammate.currentWeapon !== ladderWeapon(room, teammate)
      )
        armPlayer(room, teammate);
  if (owner !== p) send(owner, { type: 'knockdown', weapon: kind, region, damage: lost });
  return true;
}

function surfaceContact(room, from, x, y, z) {
  let outside = 0,
    inside = 1;
  for (let i = 0; i < 7; i++) {
    const t = (outside + inside) / 2;
    if (
      obstacle(
        room,
        from.x + (x - from.x) * t,
        from.y + (y - from.y) * t,
        from.z + (z - from.z) * t,
      )
    )
      inside = t;
    else outside = t;
  }
  return {
    x: from.x + (x - from.x) * outside,
    y: from.y + (y - from.y) * outside,
    z: from.z + (z - from.z) * outside,
  };
}

function fireBullet(room, shot, spec, aim, now, send) {
  const from = { x: shot.x, y: shot.y, z: shot.z };
  let impact;
  for (let d = 0.09; d <= spec.range; d += 0.09) {
    const x = from.x + aim.x * d,
      y = from.y + aim.y * d,
      z = from.z + aim.z * d;
    if (obstacle(room, x, y, z)) {
      Object.assign(shot, surfaceContact(room, shot, x, y, z));
      impact = 'surface';
      break;
    }
    Object.assign(shot, { x, y, z });
    let region;
    const hit = room.players.find(
      (p) => targetable(room, shot, p) && (region = bulletRegion(p, x, y, z)),
    );
    if (!hit) continue;
    const damage = Math.round(spec.damage * damageMultiplier[region]);
    if (hurt(room, hit, damage, now, send, shot.kind, shot.owner, region)) {
      impact = 'target';
      if (hit.alive)
        send(shot.owner, { type: 'weapon-confirm', weapon: shot.kind, region, damage });
    }
    break;
  }
  for (const p of room.players) {
    if (
      p === shot.owner ||
      (p.alive &&
        length(eye(room, p), shot) < 16 &&
        exposed(room, eye(room, p), from) &&
        exposed(room, eye(room, p), shot))
    ) {
      send(p, {
        type: 'weapon-effect',
        weapon: shot.kind,
        effect: 'trace',
        from,
        impact,
        point: { x: shot.x, y: shot.y, z: shot.z },
      });
    }
  }
}

function rememberArrow(room, shot, floor, now) {
  const speed = Math.hypot(shot.vx, shot.vy, shot.vz);
  room.embedded.push({
    id: shot.id,
    owner: shot.owner,
    point: { x: shot.x, y: shot.y, z: shot.z },
    direction: [shot.vx / speed, shot.vy / speed, shot.vz / speed],
    floor,
    landedAt: now,
    depth: Math.min(0.11, 0.025 + speed * 0.0024),
  });
  if (room.embedded.length > maxEmbeddedArrows) {
    const removed = room.embedded.shift();
    for (const p of room.players) p.seenArrows.delete(removed.id);
  }
}

function sendLandedArrows(room, now, send) {
  if (!room.embedded.length) return;
  for (const p of room.players) {
    if (!p.alive || p.bot) continue;
    const viewer = eye(room, p);
    for (const arrow of room.embedded) {
      if (
        p.seenArrows.has(arrow.id) ||
        length(viewer, arrow.point) > 24 ||
        !exposed(room, viewer, arrow.point)
      )
        continue;
      p.seenArrows.add(arrow.id);
      const { id, point, direction, floor, depth } = arrow;
      send(p, {
        type: 'weapon-effect',
        weapon: 'bow',
        effect: 'land',
        id,
        point,
        direction,
        floor,
        depth,
        own: arrow.owner === p,
        silent: now - arrow.landedAt > 100,
      });
    }
  }
}

export function weaponInput(room, p, message, now, send) {
  if (message.type === 'weapon-cancel') {
    p.bowSince = null;
    return;
  }
  const name = message.weapon;
  if (
    typeof name !== 'string' ||
    !Object.hasOwn(weapons, name) ||
    !Object.hasOwn(p.ammo ?? {}, name)
  )
    return;
  const spec = weapons[name];
  resolveReload(p, now);
  if (message.type === 'weapon-select') {
    if (room.phase !== 'hunt' || !p.alive || p.monster) return;
    p.heldWeapon = name;
    if (p.reload && p.reload.name !== name) p.reload = null;
    return;
  }
  if (message.type === 'weapon-reload') {
    if (
      spec.reload &&
      canFire(room, p, now) &&
      !p.reload &&
      p.ammo[name] < spec.ammo &&
      p.reserve[name] > 0
    ) {
      p.heldWeapon = name;
      p.reload = { name, until: now + spec.reload };
      p.bowSince = null;
      send(p, { type: 'weapon-reload', weapon: name, duration: spec.reload });
    }
    return;
  }
  if (p.reload) return;
  const bowSince = p.bowSince;
  if (message.type === 'weapon-ready') {
    if (
      spec.charge &&
      canFire(room, p, now) &&
      p.ammo[name] > 0 &&
      p.weaponReady <= now &&
      bowSince === null
    )
      p.bowSince = now;
    return;
  }
  p.bowSince = null;
  if (!canFire(room, p, now) || p.weaponReady > now || !(p.ammo[name] > 0)) return;
  if (
    !Number.isFinite(message.pitch) ||
    (spec.charge && (bowSince === null || now - bowSince < bowMinDraw))
  )
    return;
  const pitch = Math.max(-1.42, Math.min(1.42, message.pitch));
  const drawn = spec.charge ? Math.min(1, (now - bowSince) / spec.charge) : 1;
  const speed = spec.speed * (spec.charge ? 0.29 + 0.71 * Math.sqrt(drawn) : 1);
  const sinYaw = Math.sin(p.yaw),
    cosYaw = Math.cos(p.yaw);
  const sinPitch = Math.sin(pitch),
    cosPitch = Math.cos(pitch);
  const origin = eye(room, p);
  if (room.duel && spec.projectile === 'grenade') origin.y = p.y + (p.input.quiet ? 0.78 : 1.1);
  let aim = { x: -sinYaw * cosPitch, y: sinPitch, z: -cosYaw * cosPitch };
  if (spec.projectile === 'arrow') {
    const line = bowLine(drawn);
    const world = ([x, y, z]) => ({
      x: x * cosYaw + y * sinYaw * sinPitch + z * sinYaw * cosPitch,
      y: y * cosPitch - z * sinPitch,
      z: -x * sinYaw + y * cosYaw * sinPitch + z * cosYaw * cosPitch,
    });
    aim = world(line.aim);
    const tip = world(line.nock.map((coordinate, i) => coordinate + line.aim[i] * arrowLength));
    const launch = { x: origin.x + tip.x, y: origin.y + tip.y, z: origin.z + tip.z };
    if (!obstacle(room, launch.x, launch.y, launch.z) && exposed(room, origin, launch))
      Object.assign(origin, launch);
  }
  const shot = {
    id: ++room.shotId,
    kind: name,
    owner: p,
    age: 0,
    drawn,
    ...origin,
    vx: aim.x * speed,
    vy: aim.y * speed + (spec.projectile === 'grenade' ? 1.1 : 0),
    vz: aim.z * speed,
  };
  p.heldWeapon = name;
  p.shotSequence = (p.shotSequence ?? 0) + 1;
  p.ammo[name]--;
  p.weaponReady = now + spec.cooldown;
  event(room, send, shot, 'launch');
  if (spec.projectile === 'bullet') {
    p.firingUntil = now + 230;
    p.firingPose = name === 'pistol' ? 'fire-pistol' : 'fire-long';
    fireBullet(room, shot, spec, aim, now, send);
  } else {
    if (spec.projectile === 'grenade') p.throwingUntil = now + 650;
    room.shots.push(shot);
  }
}

function targetable(room, shot, p) {
  return (
    p.alive &&
    p !== shot.owner &&
    (room.duel || p.monster) &&
    (!room.duel || p.side !== shot.owner.side)
  );
}

function stagger(p, now, ms) {
  p.stunUntil = Math.max(p.stunUntil, now + ms);
  p.vx = p.vz = 0;
  p.bowSince = null;
}

function explode(room, shot, now, send) {
  const spec = weapons[shot.kind];
  event(room, send, shot, 'burst');
  for (const p of room.players) {
    if (
      !targetable(room, shot, p) &&
      !(spec.projectile === 'grenade' && p === shot.owner && p.alive)
    )
      continue;
    const target = eye(room, p);
    const distance = length(shot, target);
    if (distance > spec.radius || !exposed(room, shot, target)) continue;
    if (shot.kind === 'flash') {
      const toward = -(shot.x - p.x) * Math.sin(p.yaw) - (shot.z - p.z) * Math.cos(p.yaw);
      const facing = toward >= 0.18 * Math.hypot(shot.x - p.x, shot.z - p.z);
      const duration = facing ? spec.stun : 420;
      stagger(p, now, duration);
      send(p, { type: 'flash', strength: facing ? 1 : 0.42, duration: facing ? 1500 : 580 });
    } else if (spec.damage) {
      if (
        !hurt(
          room,
          p,
          Math.max(8, Math.round(spec.damage * (1 - distance / (spec.radius * 1.12)))),
          now,
          send,
          shot.kind,
          shot.owner,
        )
      )
        continue;
    } else {
      stagger(p, now, spec.stun);
      send(p, { type: 'weapon-hit', weapon: shot.kind });
    }
    if (p !== shot.owner && p.alive)
      send(shot.owner, { type: 'weapon-confirm', weapon: shot.kind });
  }
}

function advance(room, shot, dt, now, send) {
  const spec = weapons[shot.kind];
  shot.age += dt;
  if (spec.projectile === 'grenade') {
    const impact = advanceGrenade(shot, dt, spec.gravity, (x, y, z) => obstacle(room, x, y, z));
    if (impact > 1.2 && shot.age > (shot.nextBounce ?? 0)) {
      event(room, send, shot, 'bounce');
      shot.nextBounce = shot.age + 0.11;
    }
    if (shot.age < spec.life) return true;
    if (shot.kind === 'smoke') {
      room.smokes.push({ id: shot.id, x: shot.x, z: shot.z, started: now });
      event(room, send, shot, 'deploy');
    } else explode(room, shot, now, send);
    return false;
  }
  const substeps = Math.max(1, Math.ceil((Math.hypot(shot.vx, shot.vy, shot.vz) * dt) / 0.11));
  const step = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    shot.vy -= spec.gravity * step;
    const x = shot.x + shot.vx * step,
      y = shot.y + shot.vy * step,
      z = shot.z + shot.vz * step;
    if (obstacle(room, x, y, z)) {
      if (spec.projectile === 'shell') {
        explode(room, shot, now, send);
        return false;
      }
      Object.assign(shot, surfaceContact(room, shot, x, y, z));
      rememberArrow(room, shot, y <= 0.035, now);
      return false;
    }
    Object.assign(shot, { x, y, z });
    const target = room.players.find(
      (p) =>
        targetable(room, shot, p) &&
        y > p.y + 0.1 &&
        y < p.y + (p.monster ? 1.82 : posture(p).height) &&
        Math.hypot(x - p.x, z - p.z) < 0.29,
    );
    if (!target) continue;
    if (spec.projectile === 'shell') explode(room, shot, now, send);
    else {
      stagger(target, now, spec.stun * (0.55 + 0.45 * (shot.drawn ?? 1)));
      send(target, { type: 'weapon-hit', weapon: shot.kind });
      send(shot.owner, { type: 'weapon-confirm', weapon: shot.kind });
      event(room, send, shot, 'impact');
    }
    return false;
  }
  if (shot.age < spec.life) return true;
  if (spec.projectile === 'shell') explode(room, shot, now, send);
  return false;
}

export function tickCombat(room, dt, now, send) {
  for (const p of room.players) resolveReload(p, now);
  room.shots = room.shots.filter((shot) => advance(room, shot, dt, now, send));
  sendLandedArrows(room, now, send);
  if (room.smokes.length)
    room.smokes = room.smokes.filter((cloud) => now - cloud.started < smokeDuration);
}

export function visibleShots(room, p) {
  if (!room.shots.length) return [];
  const viewer = eye(room, p);
  return room.shots
    .filter((shot) => length(viewer, shot) < 24 && exposed(room, viewer, shot))
    .map(({ id, kind, x, y, z, vx, vy, vz }) => ({ id, kind, x, y, z, vx, vy, vz }));
}

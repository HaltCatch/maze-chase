export const STEP = 0.05;
export const RADIUS = 0.22;
export const SPRINT_RESTART = 0.42;
const GRAVITY = 13;
export const HURDLE_HEIGHT = 0.23;
export const HURDLE_DEPTH = 0.32;
export const WALL_HEIGHT = 2.05;
export const PERIMETER_HEIGHT = 3.4;
export const MANTLE_TIME = 0.82;
export const MAZE_SIZE = 29;
export const CATCH_REACH = 0.82;

export function wallHeightAt(map, x, z) {
  const col = Math.floor(x),
    row = Math.floor(z);
  if (cell(map, col, row) !== '#') return 0;
  return col < 1 || row < 1 || col >= map[0].length - 1 || row >= map.length - 1
    ? PERIMETER_HEIGHT
    : WALL_HEIGHT;
}

export function floorAt(map, x, z, climbable = false) {
  if (climbable) {
    for (const dx of [-RADIUS, RADIUS])
      for (const dz of [-RADIUS, RADIUS]) {
        if (wallHeightAt(map, x + dx, z + dz) === WALL_HEIGHT) return WALL_HEIGHT;
      }
    return 0;
  }
  for (const dx of [-RADIUS, RADIUS]) {
    for (let row = Math.floor(z - RADIUS); row <= Math.floor(z + RADIUS); row++) {
      if (Math.abs(z - row - 0.5) <= HURDLE_DEPTH / 2 + RADIUS && cell(map, x + dx, row) === '+')
        return HURDLE_HEIGHT;
    }
  }
  return 0;
}

export function jump(p, map) {
  if (
    p.mantle ||
    (p.grounded !== undefined
      ? !p.grounded || p.vy > 0
      : p.vy || p.y > floorAt(map, p.x, p.z, p.climbable) + 0.03)
  )
    return false;
  p.vy = 5.2;
  if (p.grounded !== undefined) p.grounded = false;
  return true;
}

export function stepJump(p, dt, map) {
  const floor = floorAt(map, p.x, p.z, p.climbable);
  const height = p.y || 0;
  if (!p.vy && height <= floor) return;
  const next = height + (p.vy || 0) * dt - (GRAVITY * dt * dt) / 2;
  p.y = Math.max(floor, next);
  p.vy = next > floor ? (p.vy || 0) - GRAVITY * dt : 0;
}

export function ledge(map, p) {
  if (!p.climbable || p.mantle || p.vy || p.y > 0.02) return null;
  const forwardX = -Math.sin(p.yaw),
    forwardZ = -Math.cos(p.yaw);
  const alongX = Math.abs(forwardX) > Math.abs(forwardZ);
  const facing = alongX ? forwardX : forwardZ;
  if (Math.abs(facing) < 0.76) return null;
  const dx = alongX ? Math.sign(facing) : 0;
  const dz = alongX ? 0 : Math.sign(facing);
  for (let reach = 0.24; reach <= 0.64; reach += 0.08) {
    const x = Math.floor(p.x + dx * reach),
      z = Math.floor(p.z + dz * reach);
    const height = wallHeightAt(map, x, z);
    if (!height) continue;
    if (height !== WALL_HEIGHT) return null;
    // Keep the approach straight when possible, with enough room to plant both feet.
    const inside = (position, cell) => Math.max(cell + 0.28, Math.min(cell + 0.72, position));
    return { x: dx ? x + 0.5 : inside(p.x, x), z: dz ? z + 0.5 : inside(p.z, z) };
  }
  return null;
}

export function climbOrJump(map, p) {
  const target = ledge(map, p);
  if (!target) return jump(p, map);
  p.mantle = { ...target, fromX: p.x, fromZ: p.z, fromY: p.y || 0, elapsed: 0 };
  p.vx = p.vy = p.vz = 0;
  return true;
}

function smoothstep(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

export function stepMantle(p, dt) {
  const action = p.mantle;
  if (!action) return false;
  action.elapsed = Math.min(MANTLE_TIME, action.elapsed + dt);
  const progress = action.elapsed / MANTLE_TIME;
  const lift = smoothstep(progress / 0.64);
  const over = smoothstep((progress - 0.64) / 0.36);
  p.x = action.fromX + (action.x - action.fromX) * over;
  p.z = action.fromZ + (action.z - action.fromZ) * over;
  p.y = action.fromY + (WALL_HEIGHT + 0.1 - action.fromY) * lift - 0.1 * over;
  if (progress === 1) {
    p.y = WALL_HEIGHT;
    p.mantle = null;
  }
  return true;
}

export function stepStamina(p, dt, sprinting) {
  if (sprinting) {
    p.energy = Math.max(0, p.energy - 0.31 * dt);
    p.recovery = 0.7;
    if (p.energy === 0) p.exhausted = true;
  } else {
    p.recovery = Math.max(0, (p.recovery || 0) - dt);
    if (!p.recovery) p.energy = Math.min(1, p.energy + 0.23 * dt);
    if (p.energy >= SPRINT_RESTART) p.exhausted = false;
  }
}
export function cell(map, x, z) {
  return map[Math.floor(z)]?.[Math.floor(x)] ?? '#';
}
function clear(map, x, z, y, climbable) {
  if (y + 0.001 < floorAt(map, x, z, climbable)) return false;
  return [-RADIUS, RADIUS].every((dx) =>
    [-RADIUS, RADIUS].every((dz) =>
      climbable
        ? wallHeightAt(map, x + dx, z + dz) < PERIMETER_HEIGHT
        : cell(map, x + dx, z + dz) !== '#',
    ),
  );
}
export function clearTravel(map, x, z, toX, toZ, y, climbable) {
  const steps = Math.max(1, Math.ceil(Math.hypot(toX - x, toZ - z) / 0.12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!clear(map, x + (toX - x) * t, z + (toZ - z) * t, y, climbable)) return false;
  }
  return true;
}

export function move(map, p, dt) {
  const forward = Number(p.input.f) - Number(p.input.b);
  const side = Number(p.input.r) - Number(p.input.l);
  const norm = Math.max(1, Math.hypot(forward, side));
  const sprint = p.input.run && !p.input.quiet && p.energy > 0 && !p.exhausted && !p.carrying;
  const speed = p.input.quiet ? 1.8 : sprint ? 4.8 : p.carrying ? 2.72 : p.monster ? 3.55 : 3.25;
  const targetX = ((-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * side) * speed) / norm;
  const targetZ = ((-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * side) * speed) / norm;
  const response = p.bot ? 0 : forward || side ? 0.085 : 0.055;
  const decay = response ? Math.exp(-dt / response) : 0;
  const dx = targetX * dt + ((p.vx || 0) - targetX) * response * (1 - decay);
  const dz = targetZ * dt + ((p.vz || 0) - targetZ) * response * (1 - decay);
  if (!dx || clearTravel(map, p.x, p.z, p.x + dx, p.z, p.y || 0, p.climbable)) {
    p.x += dx;
    p.vx = targetX + ((p.vx || 0) - targetX) * decay;
  } else p.vx = 0;
  if (!dz || clearTravel(map, p.x, p.z, p.x, p.z + dz, p.y || 0, p.climbable)) {
    p.z += dz;
    p.vz = targetZ + ((p.vz || 0) - targetZ) * decay;
  } else p.vz = 0;
  stepStamina(p, dt, sprint && Boolean(forward || side));
}
export function sight(map, a, b, climbable = false, eyeHeight = 1.1) {
  const n = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) * 10);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t,
      z = a.z + (b.z - a.z) * t;
    if (climbable) {
      const eye = (a.y || 0) + eyeHeight + ((b.y || 0) - (a.y || 0)) * t;
      if (wallHeightAt(map, x, z) >= eye) return false;
    } else if (cell(map, x, z) === '#') return false;
  }
  return true;
}
export function characterSight(map, viewer, target, climbable = false) {
  if (sight(map, viewer, target, climbable)) return true;
  const range = Math.hypot(target.x - viewer.x, target.z - viewer.z);
  if (!range) return false;
  const dx = ((target.z - viewer.z) / range) * RADIUS * 0.85;
  const dz = ((viewer.x - target.x) / range) * RADIUS * 0.85;
  return (
    sight(map, viewer, { ...target, x: target.x + dx, z: target.z + dz }, climbable) ||
    sight(map, viewer, { ...target, x: target.x - dx, z: target.z - dz }, climbable)
  );
}
export function canCatch(map, hunter, target, yaw = hunter.yaw) {
  const dx = target.x - hunter.x,
    dz = target.z - hunter.z;
  const range = Math.hypot(dx, dz);
  if (range > CATCH_REACH || Math.abs((hunter.y ?? 0) - (target.y ?? 0)) > 0.45) return false;
  if (range > 0.05 && -Math.sin(yaw) * dx - Math.cos(yaw) * dz < range * 0.6) return false;
  return (
    clearTravel(
      map,
      hunter.x,
      hunter.z,
      target.x,
      target.z,
      Math.min(hunter.y ?? 0, target.y ?? 0),
      true,
    ) && sight(map, hunter, target, true, 0.78)
  );
}

export function neighbors(map, x, z) {
  return [
    [x + 1, z],
    [x - 1, z],
    [x, z + 1],
    [x, z - 1],
  ].filter(([a, b]) => cell(map, a, b) !== '#');
}
export function paths(map, from) {
  const queue = [from],
    steps = new Map([[from.join(','), { distance: 0, next: from }]]);
  for (const current of queue) {
    const { distance, next } = steps.get(current.join(','));
    for (const position of neighbors(map, ...current)) {
      const key = position.join(',');
      if (!steps.has(key)) {
        steps.set(key, { distance: distance + 1, next: distance === 0 ? position : next });
        queue.push(position);
      }
    }
  }
  return { queue, steps };
}
export function maze(size, seed) {
  function random() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }
  const map = Array.from({ length: size }, () => Array(size).fill('#'));
  const stack = [[1, 1]];
  map[1][1] = '.';
  while (stack.length) {
    const [x, z] = stack.at(-1);
    const options = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ].filter(
      ([dx, dz]) =>
        x + dx > 0 &&
        x + dx < size - 1 &&
        z + dz > 0 &&
        z + dz < size - 1 &&
        map[z + dz][x + dx] === '#',
    );
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dx, dz] = options[Math.floor(random() * options.length)];
    map[z + dz / 2][x + dx / 2] = '.';
    map[z + dz][x + dx] = '.';
    stack.push([x + dx, z + dz]);
  }
  for (let z = 1; z < size - 1; z++)
    for (let x = 1; x < size - 1; x++) {
      if (map[z][x] === '#' && random() < 0.055 && neighbors(map, x, z).length >= 2)
        map[z][x] = '.';
    }
  for (let i = 0; i < 2; i++) {
    const x = 1 + 2 * Math.floor(random() * ((size - 3) / 2));
    const z = 1 + 2 * Math.floor(random() * ((size - 3) / 2));
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) map[z + dz][x + dx] = '.';
  }
  return map.map((row) => row.join(''));
}

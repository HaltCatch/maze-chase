import { schema, t } from '@colyseus/schema';
import { climbOrJump, stepMantle, stepStamina } from '../shared/world.js';
import { readMovement } from '../shared/protocol.ts';
import type { BodyState, PhysicsWorld } from '../engine/physics.ts';
export const MoveInput = schema(
  {
    moveX: t.float32(),
    moveZ: t.float32(),
    yaw: t.float32(),
    run: t.boolean(),
    quiet: t.boolean(),
    jump: t.uint32(),
  },
  'MoveInput',
);
export type MoveCommand = Pick<
  InstanceType<typeof MoveInput>,
  'moveX' | 'moveZ' | 'yaw' | 'run' | 'quiet' | 'jump'
>;
export const Pose = schema(
  {
    x: t.float64(),
    y: t.float64(),
    z: t.float64(),
    vx: t.float64(),
    vy: t.float64(),
    vz: t.float64(),
    yaw: t.float64(),
    energy: t.float64(),
    recovery: t.float64(),
    exhausted: t.boolean(),
    grounded: t.boolean(),
    boosted: t.boolean(),
    shield: t.boolean(),
    carrying: t.boolean(),
    monster: t.boolean(),
    climbable: t.boolean(),
    locked: t.boolean(),
    jumpAck: t.uint32(),
    jumpBuffer: t.float64(),
    coyote: t.float64(),
    jumpsUsed: t.uint8(),
    maxJumps: t.uint8().default(1),
    airJumpHeight: t.float64().default(1),
    climbing: t.boolean(),
    climbX: t.float64(),
    climbZ: t.float64(),
    fromX: t.float64(),
    fromY: t.float64(),
    fromZ: t.float64(),
    elapsed: t.float64(),
  },
  'Pose',
);
export interface Locomotion extends BodyState {
  climbable?: boolean;
  locked?: boolean;
  jumpAck: number;
  jumpBuffer?: number;
  coyote?: number;
  jumpsUsed?: number;
  maxJumps?: number;
  airJumpHeight?: number;
  mantle?: {
    x: number;
    z: number;
    fromX: number;
    fromY: number;
    fromZ: number;
    elapsed: number;
  } | null;
}
const fields = [
  'x',
  'y',
  'z',
  'vx',
  'vy',
  'vz',
  'yaw',
  'energy',
  'recovery',
  'exhausted',
  'grounded',
  'boosted',
  'shield',
  'carrying',
  'monster',
  'climbable',
  'locked',
  'jumpAck',
  'jumpBuffer',
  'coyote',
  'jumpsUsed',
  'maxJumps',
  'airJumpHeight',
] as const;
export function writePose(target: InstanceType<typeof Pose>, p: Locomotion) {
  Object.assign(
    target,
    Object.fromEntries(
      fields.map((key) => [key, p[key] ?? (typeof target[key] === 'boolean' ? false : 0)]),
    ),
    {
      climbing: !!p.mantle,
      climbX: p.mantle?.x ?? 0,
      climbZ: p.mantle?.z ?? 0,
      fromX: p.mantle?.fromX ?? 0,
      fromY: p.mantle?.fromY ?? 0,
      fromZ: p.mantle?.fromZ ?? 0,
      elapsed: p.mantle?.elapsed ?? 0,
    },
  );
}
export function readPose(p: Locomotion, source: InstanceType<typeof Pose>) {
  Object.assign(p, Object.fromEntries(fields.map((key) => [key, source[key]])));
  p.mantle = source.climbing
    ? {
        x: source.climbX,
        z: source.climbZ,
        fromX: source.fromX,
        fromY: source.fromY,
        fromZ: source.fromZ,
        elapsed: source.elapsed,
      }
    : null;
}
/** The same fixed-step command is used by the authoritative room and the SDK's replay. */
export function stepMovement(p: Locomotion, cmd: MoveCommand, world: PhysicsWorld, dt: number) {
  p.yaw = Number.isFinite(cmd.yaw) ? cmd.yaw % (Math.PI * 2) : p.yaw;
  p.input = readMovement(
    p.locked ? {} : { moveX: cmd.moveX, moveZ: cmd.moveZ, run: cmd.run, quiet: cmd.quiet },
  );
  if (cmd.jump > p.jumpAck) {
    p.jumpAck = cmd.jump;
    if (!p.locked) p.jumpBuffer = 0.14;
  }
  p.landing = undefined;
  if (p.locked) p.jumpBuffer = 0;
  // The network stays at 20 Hz. Both authority and prediction integrate the same
  // three 60 Hz Havok substeps for floor contacts, jump buffering and gravity.
  const steps = Math.max(1, Math.ceil(dt / (1 / 60) - 1e-8)),
    h = dt / steps;
  for (let i = 0; i < steps; i++) {
    if (p.grounded) {
      p.coyote = 0.1;
      p.jumpsUsed = 0;
    }
    consumeJump(p, world);
    if (stepMantle(p, h)) {
      p.jumpBuffer = p.coyote = 0;
      stepStamina(p, h, false);
      continue;
    }
    world.step(p, h);
    if (p.grounded) {
      const spring = world.map.colliders.find(
        (c) =>
          c.bounce &&
          Math.abs(p.x - c.x) < c.width / 2 + 0.22 &&
          Math.abs(p.z - c.z) < c.depth / 2 + 0.22 &&
          p.y > c.y &&
          p.y < c.y + c.height / 2 + 0.12,
      );
      if (spring) {
        p.vy = spring.bounce!;
        p.grounded = false;
        p.boosted = true;
        p.energy = Math.min(1, p.energy + 0.45);
        p.exhausted = false;
        p.jumpsUsed = 1;
        p.coyote = p.jumpBuffer = 0;
      } else p.boosted = false;
    }
    if (p.grounded) {
      p.coyote = 0.1;
      p.jumpsUsed = 0;
      consumeJump(p, world);
    } else p.coyote = Math.max(0, (p.coyote ?? 0) - h);
    p.jumpBuffer = Math.max(0, (p.jumpBuffer ?? 0) - h);
  }
}

function consumeJump(p: Locomotion, world: PhysicsWorld) {
  if (!p.jumpBuffer || p.mantle || p.locked) return;
  const groundJump = p.grounded || ((p.coyote ?? 0) > 0 && !p.jumpsUsed);
  if (groundJump) {
    if (p.grounded) climbOrJump(world.map.grid, p);
    else p.vy = 5.2;
    p.grounded = false;
    p.jumpsUsed = 1;
  } else {
    // Walking off an edge consumes the ground jump after coyote time expires.
    const used = Math.max(1, p.jumpsUsed ?? 0);
    if (used >= (p.maxJumps ?? 1)) return;
    p.vy = 5.2 * Math.sqrt(p.airJumpHeight ?? 1);
    p.jumpsUsed = used + 1;
  }
  p.jumpBuffer = p.coyote = 0;
}

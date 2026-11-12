import { characterPosture } from '../shared/arsenal.ts';
import HavokPhysics from '@babylonjs/havok';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { rampGeometry } from '../content/collider-geometry.ts';
import {
  PhysicsShapeBox,
  PhysicsShapeSphere,
  PhysicsShapeConvexHull,
} from '@babylonjs/core/Physics/v2/physicsShape.js';
import { ShapeCastResult } from '@babylonjs/core/Physics/shapeCastResult.js';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import {
  PhysicsCharacterController,
  CharacterSupportedState,
  type CharacterSurfaceInfo,
} from '@babylonjs/core/Physics/v2/characterController.js';
import '@babylonjs/core/Physics/v2/physicsEngineComponent.js';
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent.js';
import type { MapDefinition } from '../content/maps.ts';

let initialized: ReturnType<typeof HavokPhysics> | undefined;
export function initPhysics(wasmBinary?: Uint8Array) {
  return (initialized ??= HavokPhysics(
    wasmBinary
      ? { wasmBinary: new Uint8Array(wasmBinary).buffer }
      : { locateFile: () => '/engine/havok.wasm' },
  ));
}
export interface BodyState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  energy: number;
  exhausted: boolean;
  recovery: number;
  kit?: { character?: string };
  carrying?: boolean;
  monster?: boolean;
  grounded?: boolean;
  boosted?: boolean;
  shield?: boolean;
  /** Contact occurred during this command, including a buffered landing jump. */
  landing?: { x: number; y: number; z: number };
  input: {
    f: boolean;
    b: boolean;
    l: boolean;
    r: boolean;
    run: boolean;
    quiet: boolean;
    moveX?: number;
    moveZ?: number;
  };
}
const down = new Vector3(0, -1, 0),
  up = new Vector3(0, 1, 0),
  forward = new Vector3(0, 0, -1),
  gravity = new Vector3(0, -13, 0);
/** A separate, headless Havok scene: renderer frame rate never advances simulation. */
export class PhysicsWorld {
  readonly engine = new NullEngine({
    renderWidth: 1,
    renderHeight: 1,
    textureSize: 1,
    deterministicLockstep: true,
    lockstepMaxSteps: 4,
  });
  readonly scene = new Scene(this.engine);
  private bodies = new Map<object, { controller: PhysicsCharacterController; height: number }>();
  private readonly plugin: HavokPlugin;
  private readonly floorCast = new ShapeCastResult();
  private readonly shapeCast = new ShapeCastResult();
  private readonly castEnd = new Vector3();
  private readonly rotation = Quaternion.Identity();
  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private readonly desired = new Vector3();
  private readonly support: CharacterSurfaceInfo = {
    isSurfaceDynamic: false,
    supportedState: CharacterSupportedState.UNSUPPORTED,
    averageSurfaceNormal: new Vector3(),
    averageSurfaceVelocity: new Vector3(),
    averageAngularSurfaceVelocity: new Vector3(),
  };
  readonly map: MapDefinition;
  constructor(map: MapDefinition, havok: Awaited<ReturnType<typeof HavokPhysics>>) {
    this.map = map;
    this.scene.useRightHandedSystem = true;
    this.plugin = new HavokPlugin(false, havok);
    this.scene.enablePhysics(gravity, this.plugin);
    const boxes = [
      ...map.colliders,
      ...(map.ground === false
        ? []
        : [
            {
              id: 'ground',
              x: map.size / 2,
              y: (map.groundY ?? 0) - 0.25,
              z: map.size / 2,
              width: map.size,
              height: 0.5,
              depth: map.size,
            },
          ]),
    ];
    for (const c of boxes) {
      const node = new TransformNode(c.id, this.scene);
      node.position.set(c.x, c.y, c.z);
      const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
      if ('shape' in c && c.shape === 'sphere')
        body.shape = new PhysicsShapeSphere(Vector3.Zero(), c.width / 2, this.scene);
      else if ('ramp' in c && c.ramp) {
        const mesh = new Mesh(c.id + '-hull', this.scene);
        const geometry = rampGeometry(c);
        mesh.setVerticesData('position', geometry.positions);
        mesh.setIndices(geometry.indices);
        body.shape = new PhysicsShapeConvexHull(mesh, this.scene);
        mesh.dispose();
      } else
        body.shape = new PhysicsShapeBox(
          Vector3.Zero(),
          Quaternion.Identity(),
          new Vector3(c.width, c.height, c.depth),
          this.scene,
        );
      body.shape.filterMembershipMask = 1;
      body.shape.filterCollideMask = 2;
      body.shape.material = { friction: 0.2, restitution: 0 };
    }
  }
  private body(p: BodyState) {
    const height = p.monster ? 1.82 : characterPosture(p.kit?.character, p.input.quiet).height;
    let body = this.bodies.get(p);
    if (!body) {
      const controller = new PhysicsCharacterController(
        new Vector3(p.x, p.y + height / 2, p.z),
        { capsuleHeight: height, capsuleRadius: 0.22 },
        this.scene,
      );
      controller.shape.filterMembershipMask = 2;
      controller.shape.filterCollideMask = 1;
      controller.keepDistance = 0.015;
      controller.keepContactTolerance = 0.02;
      controller.maxStepHeight = 0.26;
      controller.maxSlopeCosine = Math.cos(Math.PI / 4);
      // Ground acceleration is set per substep below; the native helper owns
      // projection and acceleration in the actual support plane.
      controller.acceleration = 1;
      controller.maxAcceleration = 1000;
      body = { controller, height };
      this.bodies.set(p, body);
    }
    // Stay crouched when the standing capsule would intersect a ceiling.
    const blocked =
      height > body.height &&
      this.map.colliders.some(
        (c) =>
          Math.abs(c.x - p.x) < c.width / 2 + 0.22 &&
          Math.abs(c.z - p.z) < c.depth / 2 + 0.22 &&
          c.y - c.height / 2 > p.y + 0.2 &&
          c.y - c.height / 2 < p.y + height,
      );
    if (body.height !== height && !blocked) {
      body.controller.setShapeOptions({ capsuleHeight: height, capsuleRadius: 0.22 });
      body.controller.shape.filterMembershipMask = 2;
      body.controller.shape.filterCollideMask = 1;
      body.height = height;
    }
    if (blocked) p.input.quiet = true;
    return body;
  }
  step(p: BodyState, dt: number) {
    const { controller, height } = this.body(p);
    // Position may have changed through respawn, reconciliation or a validated mantle.
    controller.setPosition(this.position.set(p.x, p.y + height / 2, p.z));
    const support = this.support;
    controller.checkSupportToRef(dt, down, support);
    // Reconciliation restores the last authoritative contact state. checkSupport
    // reads a cached manifold, which may still describe the end of a later replay.
    const grounded = !!p.grounded && p.vy <= 0;
    if (!grounded) support.supportedState = CharacterSupportedState.UNSUPPORTED;
    const f = p.input.moveZ ?? +p.input.f - +p.input.b,
      s = p.input.moveX ?? +p.input.r - +p.input.l,
      n = Math.max(1, Math.hypot(f, s));
    const run = p.input.run && !p.input.quiet && !p.exhausted && p.energy > 0 && !p.carrying;
    const speed = p.input.quiet
      ? 1.8
      : p.boosted
        ? run
          ? 6.2
          : 4.2
        : run
          ? 4.8
          : p.carrying
            ? 2.72
            : p.monster
              ? 3.55
              : 3.25;
    const tx = ((-Math.sin(p.yaw) * f + Math.cos(p.yaw) * s) * speed) / n,
      tz = ((-Math.cos(p.yaw) * f - Math.sin(p.yaw) * s) * speed) / n;
    // Ground friction must never brake a released stick/key in mid-air. Air steering
    // has a bounded acceleration, so reversing input cannot instantly reverse momentum.
    const blend = grounded
      ? 1 - Math.exp(-dt / (f || s ? 0.085 : 0.055))
      : f || s
        ? Math.min(
            1,
            ((p.boosted ? 10 : 3) * dt) / Math.max(0.001, Math.hypot(tx - p.vx, tz - p.vz)),
          )
        : p.boosted
          ? 1 - Math.exp(-dt / 0.28)
          : 0;
    const onSlope = grounded && support.averageSurfaceNormal.y >= controller.maxSlopeCosine;
    if (onSlope) {
      // Preserve the full tangent velocity before asking the native controller to
      // accelerate in its surface frame. Re-projecting only X/Z each substep
      // repeatedly loses uphill speed and can turn a landing into a slide.
      const n = support.averageSurfaceNormal;
      this.velocity.set(p.vx, -(p.vx * n.x + p.vz * n.z) / n.y, p.vz);
      controller.acceleration = blend;
      controller.calculateMovementToRef(
        dt,
        forward,
        n,
        this.velocity,
        support.averageSurfaceVelocity,
        this.desired.set(tx, 0, tz),
        up,
        this.velocity,
      );
      p.vy = 0;
    } else {
      p.vx += (tx - p.vx) * blend;
      p.vz += (tz - p.vz) * blend;
      if (grounded) p.vy = 0;
      else p.vy -= 13 * dt;
      this.velocity.set(p.vx, p.vy, p.vz);
    }
    controller.setVelocity(this.velocity);
    const fallingVelocity = p.vy;
    controller.integrate(dt, support, gravity);
    const pos = controller.getPosition(),
      vel = controller.getVelocity();
    // A swept contact can report support before the capsule reaches the floor.
    // Resolve that small separation with Havok's public capsule cast, using the
    // same collision mask and slope limit. Never snap a rising jump or a wall.
    let landed =
      grounded &&
      controller.checkSupport(dt, down).supportedState === CharacterSupportedState.SUPPORTED;
    if (
      !grounded &&
      fallingVelocity <= 0 &&
      (Math.abs(vel.y) < 0.001 ||
        controller.checkSupport(dt, down).supportedState === CharacterSupportedState.SUPPORTED)
    ) {
      const reach = Math.min(0.12, Math.abs(fallingVelocity) * dt + 0.035);
      this.castEnd.copyFrom(pos);
      this.castEnd.y -= reach;
      this.plugin.shapeCast(
        {
          shape: controller.shape,
          rotation: this.rotation,
          startPosition: pos,
          endPosition: this.castEnd,
          shouldHitTriggers: false,
        },
        this.shapeCast,
        this.floorCast,
      );
      landed = this.floorCast.hasHit && this.floorCast.hitNormal.y >= controller.maxSlopeCosine;
      if (landed) {
        pos.y -= Math.max(0, this.floorCast.hitFraction * reach - controller.keepDistance);
        controller.setPosition(pos);
      }
    }
    p.x = pos.x;
    p.y = pos.y - height / 2;
    p.z = pos.z;
    p.vx = vel.x;
    p.vz = vel.z;
    if (!p.grounded && landed) p.landing = { x: p.x, y: p.y, z: p.z };
    p.grounded = landed;
    p.vy = landed ? 0 : vel.y;
    if (run && (f || s)) {
      p.energy = Math.max(0, p.energy - 0.31 * dt);
      p.recovery = 0.7;
      if (!p.energy) p.exhausted = true;
    } else {
      p.recovery = Math.max(0, p.recovery - dt);
      if (!p.recovery) p.energy = Math.min(1, p.energy + 0.23 * dt);
      if (p.energy >= 0.42) p.exhausted = false;
    }
  }
  release(p: object) {
    this.bodies.get(p)?.controller.dispose();
    this.bodies.delete(p);
  }
  retain(players: object[]) {
    for (const p of this.bodies.keys()) if (!players.includes(p)) this.release(p);
  }
  dispose() {
    for (const p of this.bodies.keys()) this.release(p);
    this.scene.dispose();
    this.engine.dispose();
  }
}

import { Ray } from '@babylonjs/core/Culling/ray.core.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { pendulumPose } from '../../shared/obstacles.ts';
import { characterPosture } from '../../shared/arsenal.ts';
import type { MapDefinition } from '../../content/maps.ts';
import type { Runner } from './parkour.ts';
/** Babylon's swept ray/segment distance tests the moving ball against the player's
 * capsule, in relative coordinates. Three sweeps per server tick avoid tunnelling. */
export class ParkourObstacles {
  private previous = new WeakMap<
    Runner,
    { x: number; y: number; z: number; time: number; until: number }
  >();
  private map: MapDefinition;
  constructor(map: MapDefinition) {
    this.map = map;
  }
  reset(p: Runner) {
    this.previous.delete(p);
  }
  tick(p: Runner, time: number) {
    const old = this.previous.get(p) ?? { x: p.x, y: p.y, z: p.z, time: time - 0.05, until: 0 };
    this.previous.set(p, { x: p.x, y: p.y, z: p.z, time, until: old.until });
    if (time < old.until) return false;
    const height = characterPosture(p.kit?.character, p.input.quiet).height;
    const bottom = new Vector3(0, 0.22, 0),
      top = new Vector3(0, height - 0.22, 0);
    for (const obstacle of this.map.obstacles ?? []) {
      for (let i = 0; i < 3; i++) {
        const a = i / 3,
          b = (i + 1) / 3,
          duration = Math.min(0.05, Math.max(0, time - old.time));
        const first = pendulumPose(obstacle, time - duration * (1 - a)),
          last = pendulumPose(obstacle, time - duration * (1 - b));
        const from = new Vector3(
          first.x - (old.x + (p.x - old.x) * a),
          first.y - (old.y + (p.y - old.y) * a),
          first.z - (old.z + (p.z - old.z) * a),
        );
        const to = new Vector3(
          last.x - (old.x + (p.x - old.x) * b),
          last.y - (old.y + (p.y - old.y) * b),
          last.z - (old.z + (p.z - old.z) * b),
        );
        const delta = to.subtract(from),
          length = delta.length();
        const ray = new Ray(
          from,
          length > 1e-8 ? delta.scale(1 / length) : new Vector3(1, 0, 0),
          Math.max(length, 1e-8),
        );
        const radius = obstacle.radius + 0.22;
        const capsuleDistance = (v: Vector3) =>
          Math.hypot(v.x, v.z, v.y - Math.max(bottom.y, Math.min(top.y, v.y)));
        const distance = ray.intersectionSegment(bottom, top, radius);
        // Babylon's helper uses a long ray internally: explicitly clip the swept
        // segment, and include its endpoints (including stationary overlap).
        if (
          capsuleDistance(from) > radius &&
          capsuleDistance(to) > radius &&
          !(distance >= 0 && distance <= length)
        )
          continue;
        if (p.shield) {
          p.shield = false;
          this.previous.get(p)!.until = time + 0.7;
          return true;
        }
        const sign = Math.sign(last[obstacle.axis] - first[obstacle.axis]) || 1;
        p.vx = obstacle.axis === 'x' ? sign * 6 : p.vx;
        p.vz = obstacle.axis === 'z' ? sign * 6 : p.vz;
        p.vy = 3;
        p.grounded = false;
        p.landing = undefined;
        Object.assign(p, { coyote: 0, jumpBuffer: 0, jumpsUsed: 1 });
        this.previous.get(p)!.until = time + 0.7;
        return true;
      }
    }
    return false;
  }
}

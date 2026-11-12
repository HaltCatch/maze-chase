import { rayBox, type MapDefinition } from '../../content/maps.ts';
import { bulletRegion } from '../../shared/hit-regions.ts';
import type { Runner } from './parkour.ts';
export interface CourseShot {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: string;
  age: number;
}
export class ParkourItems {
  readonly shots: CourseShot[] = [];
  private id = 0;
  private map: MapDefinition;
  constructor(map: MapDefinition) {
    this.map = map;
  }
  collect(p: Runner) {
    p.itemsTaken ??= new Set();
    for (const item of this.map.pickups ?? []) {
      if (
        p.itemsTaken.has(item.id) ||
        Math.hypot(p.x - item.x, p.z - item.z) > 0.8 ||
        Math.abs(p.y + 0.65 - item.y) > 0.8
      )
        continue;
      p.itemsTaken.add(item.id);
      if (item.kind === 'rocket') p.rockets = Math.min(3, (p.rockets ?? 0) + (item.ammo ?? 1));
      else if (item.kind === 'double-jump') {
        p.airJumpUnlocked = true;
        p.maxJumps = 2;
        p.airJumpHeight = 1;
      } else if (item.kind === 'shield') p.shield = true;
      else {
        p.energy = 1;
        p.exhausted = false;
        p.recovery = 0;
      }
    }
  }
  fire(p: Runner, pitch: unknown, now: number) {
    if (
      !p.rockets ||
      now < (p.itemReady ?? 0) ||
      typeof pitch !== 'number' ||
      !Number.isFinite(pitch) ||
      Math.abs(pitch) > 1.45 ||
      this.shots.length >= 24
    )
      return false;
    const c = Math.cos(pitch),
      vx = -Math.sin(p.yaw) * c * 18,
      vy = Math.sin(pitch) * 18,
      vz = -Math.cos(p.yaw) * c * 18;
    this.shots.push({
      id: ++this.id,
      owner: p.id,
      x: p.x,
      y: p.y + (p.input.quiet ? 0.85 : 1.3),
      z: p.z,
      vx,
      vy,
      vz,
      age: 0,
    });
    p.rockets!--;
    p.itemReady = now + 900;
    return true;
  }
  tick(players: Runner[], dt: number) {
    const impacts: { x: number; y: number; z: number }[] = [];
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.age += dt;
      let hit = false;
      // Reuse the FPS's authored body proxies; short steps prevent small projectiles tunnelling.
      const steps = Math.ceil((dt * 18) / 0.08);
      for (let j = 0; j < steps && !hit; j++) {
        const next = {
          x: shot.x + (shot.vx * dt) / steps,
          y: shot.y + (shot.vy * dt) / steps,
          z: shot.z + (shot.vz * dt) / steps,
        };
        if (this.map.colliders.some((c) => rayBox(shot, next, c) !== null)) {
          hit = true;
          break;
        }
        Object.assign(shot, next);
        const target = players.find(
          (p) => p.id !== shot.owner && bulletRegion(p, shot.x, shot.y, shot.z),
        );
        if (target) {
          const speed = Math.hypot(shot.vx, shot.vz) || 1;
          if (target.shield) target.shield = false;
          else
            Object.assign(target, {
              vx: (shot.vx / speed) * 7,
              vz: (shot.vz / speed) * 7,
              vy: 4.4,
              grounded: false,
              landing: undefined,
              coyote: 0,
              jumpBuffer: 0,
              jumpsUsed: 1,
            });
          hit = true;
        }
      }
      if (hit) {
        impacts.push({ x: shot.x, y: shot.y, z: shot.z });
        this.shots.splice(i, 1);
      } else if (
        shot.age > 2.5 ||
        shot.y < -5 ||
        shot.x < 0 ||
        shot.z < 0 ||
        shot.x > this.map.size ||
        shot.z > this.map.size
      )
        this.shots.splice(i, 1);
    }
    return impacts;
  }
}

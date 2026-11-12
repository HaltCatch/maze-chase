import { mapFromDocument, parkourMaps } from '../../content/map-document.ts';
import { registerMap, type MapDefinition, type Point } from '../../content/maps.ts';
import { ParkourItems } from './parkour-items.ts';
import { ParkourObstacles } from './parkour-obstacles.ts';
import type { Locomotion } from '../../network/movement.ts';

export interface Runner extends Locomotion {
  id: string;
  name: string;
  checkpoint?: number;
  falls?: number;
  finishedAt?: number;
  highest?: number;
  collected?: Set<string>;
  itemsTaken?: Set<string>;
  rockets?: number;
  itemReady?: number;
  airJumpUnlocked?: boolean;
}
export class Parkour {
  readonly map: MapDefinition;
  started = Date.now();
  trophyOwner?: string;
  private lastSupport = new WeakMap<Runner, number>();
  private obstacles: ParkourObstacles;
  readonly items: ParkourItems;
  constructor(document: unknown, arena: string) {
    this.map = registerMap(mapFromDocument(document ?? parkourMaps[arena] ?? parkourMaps.ascent));
    this.obstacles = new ParkourObstacles(this.map);
    this.items = new ParkourItems(this.map);
  }
  get usesJumpPickup() {
    return !!this.map.pickups?.some((p) => p.kind === 'double-jump');
  }
  startingPosition(index: number): Point {
    const spawn = this.map.spawn!;
    const floor = this.map.colliders.find(
      (c) =>
        !c.ramp &&
        c.shape !== 'sphere' &&
        Math.abs(c.y + c.height / 2 - spawn.y) < 0.08 &&
        Math.abs(c.x - spawn.x) < c.width / 2 &&
        Math.abs(c.z - spawn.z) < c.depth / 2,
    );
    if (!floor) return spawn;
    return {
      ...spawn,
      x: Math.max(
        floor.x - floor.width / 2 + 0.3,
        Math.min(floor.x + floor.width / 2 - 0.3, spawn.x + ((index % 3) - 1) * 0.65),
      ),
      z: Math.max(
        floor.z - floor.depth / 2 + 0.3,
        Math.min(floor.z + floor.depth / 2 - 0.3, spawn.z + (Math.floor(index / 3) - 1) * 0.65),
      ),
    };
  }
  spawn(p: Runner): Point {
    return this.map.spawn!;
  }
  tick(p: Runner, now: number) {
    const hit = this.obstacles.tick(p, (now - this.started) / 1000);
    this.items.collect(p);
    p.highest = Math.max(p.highest ?? 0, p.y - this.map.spawn!.y);
    p.collected ??= new Set();
    const landedSpring =
      p.landing &&
      this.map.colliders.find(
        (c) =>
          c.bounce &&
          Math.abs(p.landing!.y - c.y - c.height / 2) < 0.1 &&
          Math.abs(p.landing!.x - c.x) < c.width / 2 + 0.22 &&
          Math.abs(p.landing!.z - c.z) < c.depth / 2 + 0.22,
      );
    for (const item of this.map.collectibles ?? [])
      if (
        [p, p.landing].some(
          (at) =>
            at &&
            Math.hypot(at.x - item.x, at.z - item.z) < 1.3 &&
            Math.abs(at.y + 0.65 - item.y) < 1.2,
        ) ||
        (landedSpring &&
          Math.hypot(item.x - landedSpring.x, item.z - landedSpring.z) < 0.3 &&
          Math.abs(item.y - landedSpring.y - landedSpring.height / 2 - 0.65) < 0.2)
      )
        p.collected.add(item.id);
    // A descending jump is not a failed run. Only the actual out-of-course reset
    // emits the cute fall cue; double jumps and balloon arcs remain silent.
    const outside =
      p.y < (this.map.killY ?? -1) ||
      p.x < 0 ||
      p.z < 0 ||
      p.x > this.map.size ||
      p.z > this.map.size;
    const feet = p.landing ?? p;
    const onGround =
      this.map.ground !== false &&
      !!(p.grounded || p.landing) &&
      Math.abs(feet.y - (this.map.groundY ?? 0)) < 0.12;
    // Walking down the stairs or jumping from the ground is legal. A base landing
    // after leaving elevated support ends the attempt, including buffered jumps.
    const fell = outside || (onGround && (this.lastSupport.get(p) ?? feet.y) > feet.y + 0.6);
    if (p.grounded || p.landing) this.lastSupport.set(p, feet.y);
    if (fell) {
      Object.assign(p, this.spawn(p), {
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: false,
        landing: undefined,
        jumpBuffer: 0,
        coyote: 0,
        jumpsUsed: 0,
        boosted: false,
        shield: false,
        energy: 1,
        exhausted: false,
        recovery: 0,
      });
      this.lastSupport.set(p, p.y);
      Object.assign(p, { shield: false, rockets: 0, itemReady: 0, checkpoint: 0 });
      p.itemsTaken?.clear();
      p.collected.clear();
      p.airJumpUnlocked = false;
      if (this.usesJumpPickup) p.maxJumps = 1;
      this.obstacles.reset(p);
      p.falls = (p.falls ?? 0) + 1;
      return { fell, hit };
    }
    const checkpoints = this.map.checkpoints!,
      next = checkpoints[p.checkpoint ?? 0];
    if (
      next &&
      (p.grounded || p.landing) &&
      Math.hypot(feet.x - next.x, feet.z - next.z) < 1.1 &&
      Math.abs(feet.y - next.y) < 0.15
    ) {
      p.checkpoint = (p.checkpoint ?? 0) + 1;
    }
    const finish = checkpoints.at(-1)!;
    if (
      (p.grounded || p.landing) &&
      Math.hypot(feet.x - finish.x, feet.z - finish.z) < 1.4 &&
      Math.abs(feet.y - finish.y) < 0.3 &&
      (this.map.collectibles ?? []).every((coin) => p.collected!.has(coin.id))
    ) {
      p.finishedAt ??= Math.max(1, now - this.started);
      this.trophyOwner ??= p.id;
      p.checkpoint = checkpoints.length;
    }
    return { fell, hit };
  }
  snapshot(players: Runner[], self: Runner) {
    return {
      elapsed: (Date.now() - this.started) / 1000,
      checkpoint: self.checkpoint ?? 0,
      total: this.map.checkpoints!.length,
      falls: self.falls ?? 0,
      finishedAt: self.finishedAt,
      height: Math.max(0, self.y - this.map.spawn!.y),
      highest: self.highest ?? 0,
      goalHeight: this.map.checkpoints!.at(-1)!.y - this.map.spawn!.y,
      coins: self.collected?.size ?? 0,
      coinTotal: this.map.collectibles?.length ?? 0,
      collected: [...(self.collected ?? [])],
      itemsTaken: [...(self.itemsTaken ?? [])],
      rockets: self.rockets ?? 0,
      jumpPickup: this.usesJumpPickup,
      airJumpUnlocked: !!self.airJumpUnlocked,
      trophyOwner: this.trophyOwner,
      shield: !!self.shield,
      shots: this.items.shots.map(({ owner, age, ...s }) => s),
      next: this.map.checkpoints![self.checkpoint ?? 0],
      standings: players
        .map((p) => ({
          id: p.id,
          name: p.name,
          checkpoint: p.checkpoint ?? 0,
          finishedAt: p.finishedAt,
          height: Math.max(0, p.y - this.map.spawn!.y),
          highest: p.highest ?? 0,
          coins: p.collected?.size ?? 0,
        }))
        .sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name)),
    };
  }
}

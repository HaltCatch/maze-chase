import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { PhysicsWorld, initPhysics } from '../src/engine/physics.ts';
import { createPrediction } from '../src/client/controllers/prediction.ts';
import { startTestServer } from './support/server.js';
import { parkourMaps } from '../src/content/map-document.ts';
const floor = {
  version: 1,
  id: 'qa-floor',
  name: 'Prediction floor',
  size: 32,
  ground: false,
  spawn: { x: 5, y: 2, z: 5 },
  checkpoints: [
    { x: 25, y: 2, z: 25 },
    { x: 26, y: 2, z: 25 },
  ],
  colliders: [
    {
      id: 'floor',
      x: 16,
      y: 1.8,
      z: 16,
      width: 30,
      height: 0.4,
      depth: 30,
      surface: 'concrete',
      climbable: false,
    },
    {
      id: 'crate',
      x: 28,
      y: 3,
      z: 28,
      width: 2,
      height: 2,
      depth: 2,
      surface: 'steel',
      climbable: false,
    },
  ],
};
test(
  'real client prediction lands on stairs and continues uphill without sliding',
  { timeout: 12000 },
  async (t) => {
    const { root } = await startTestServer(t);
    const map = structuredClone(parkourMaps.ascent);
    const startPad = map.colliders.find((c) => c.id === 'route-6');
    map.spawn = { x: startPad.x, y: startPad.y + startPad.height / 2, z: startPad.z };
    map.spawnYaw = 0;
    map.obstacles = [];
    const room = await new Client(root, { headers: { Origin: root } }).create('match', {
      mode: 'parkour',
      customMap: map,
    });
    let start,
      playing = false,
      prediction,
      physics;
    room.onMessage('game', (m) => {
      if (m.type === 'lobby' && !m.members[0]?.ready)
        room.send('command', { type: 'assets-ready', revision: m.revision });
      else if (m.type === 'lobby' && m.members[0]?.ready) room.send('command', { type: 'start' });
      if (m.type === 'start') start = m;
      if (m.type === 'state' && m.phase === 'hunt') playing = true;
    });
    room.send('command', { type: 'hello', name: 'stair-regression' });
    try {
      for (let i = 0; i < 300 && !start; i++) await delay(10);
      assert.ok(start);
      const havok = await initPhysics(
        await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))),
      );
      const body = {
        ...start.self,
        kit: start.kit,
        input: {},
        vx: 0,
        vz: 0,
        recovery: 0,
        exhausted: false,
      };
      physics = new PhysicsWorld(start.definition, havok);
      prediction = createPrediction(room, body, physics);
      room.send('command', { type: 'scene-ready' });
      for (let i = 0; i < 300 && !playing; i++) await delay(10);
      const begin = performance.now(),
        rows = [];
      while (performance.now() - begin < 3500) {
        const now = performance.now(),
          t = now - begin;
        const p = prediction.frame(
          now,
          { moveX: 0, moveZ: t < 2100 ? 1 : 0, quiet: false, run: false },
          0,
          t > 500 ? 1 : 0,
        );
        rows.push({ t, y: p.y, z: p.z });
        await delay(16);
      }
      const settled = rows.filter((r) => r.t > 3000);
      assert.ok(settled.length > 4);
      assert.ok(
        settled.every((r) => Math.abs(r.y - 6.87) < 0.06),
        'must reach upper landing after the jump',
      );
      assert.ok(
        Math.max(...settled.map((r) => r.y)) - Math.min(...settled.map((r) => r.y)) < 0.01,
        'no landing jitter',
      );
      assert.ok(body.grounded);
    } finally {
      prediction?.dispose();
      physics?.dispose();
      await room.leave();
    }
  },
);
test(
  'native prediction stays smooth through airborne release and landing at 30/60/144 render Hz',
  { timeout: 25000 },
  async (t) => {
    const { root } = await startTestServer(t);
    const havok = await initPhysics(
      await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))),
    );
    for (const fps of [30, 60, 144]) {
      const doubleJump = fps === 60;
      const room = await new Client(root, { headers: { Origin: root } }).create('match', {
        mode: 'parkour',
        customMap: floor,
        doubleJump,
        airJumpHeight: 1.3,
      });
      const messages = [];
      room.onMessage('game', (m) => messages.push(m));
      const receive = async (predicate) => {
        for (let i = 0; i < 400; i++) {
          const at = messages.findIndex(predicate);
          if (at >= 0) return messages.splice(at, 1)[0];
          await delay(10);
        }
        assert.fail('Missing room message');
      };
      let physics, prediction;
      try {
        const lobby = await receive((m) => m.type === 'lobby');
        room.send('command', { type: 'assets-ready', revision: lobby.revision });
        await receive((m) => m.type === 'lobby' && m.members.every((p) => p.ready));
        room.send('command', { type: 'start' });
        const start = await receive((m) => m.type === 'start');
        const body = {
          ...start.self,
          kit: start.kit,
          input: {},
          vx: 0,
          vz: 0,
          recovery: 0,
          exhausted: false,
        };
        physics = new PhysicsWorld(start.definition, havok);
        prediction = createPrediction(room, body, physics);
        room.send('command', { type: 'scene-ready' });
        await receive((m) => m.type === 'state' && m.phase === 'hunt');
        const rows = [],
          begin = performance.now();
        while (performance.now() - begin < 3100) {
          const now = performance.now(),
            elapsed = now - begin;
          const jump = doubleJump && elapsed > 1150 ? 2 : elapsed > 800 ? 1 : 0;
          const pose = prediction.frame(
            now,
            { moveX: 0, moveZ: elapsed > 400 && elapsed < 1000 ? 1 : 0, run: true, quiet: false },
            start.self.yaw,
            jump,
          );
          rows.push({
            t: elapsed,
            x: pose.x,
            y: pose.y,
            vx: body.vx,
            vy: body.vy,
            ground: body.grounded,
          });
          await delay(1000 / fps);
        }
        const peak = Math.max(...rows.map((r) => r.y)),
          peakAt = rows.findIndex((r) => r.y === peak);
        assert.ok(peak > 2.9 && peak < (doubleJump ? 4.5 : 3.1), `${fps} Hz peak ${peak}`);
        if (doubleJump) assert.ok(peak > 3.8, 'second jump increases height');
        const falling = rows.slice(peakAt);
        for (let i = 1; i < falling.length; i++)
          assert.ok(falling[i].y - falling[i - 1].y < 0.02, `${fps} Hz landing bounce`);
        const airborne = rows.filter((r) => r.t > 1050 && r.t < 1400 && !r.ground);
        assert.ok(airborne.length > 2);
        assert.ok(
          airborne.every((r) => r.vx > 1) &&
            Math.max(...airborne.map((r) => r.vx)) - Math.min(...airborne.map((r) => r.vx)) < 0.15,
          `${fps} Hz air momentum lost: ${JSON.stringify(airborne)}`,
        );
        const settled = rows.filter((r) => r.t > 2700);
        assert.ok(settled.length > 3);
        assert.ok(
          Math.max(...settled.map((r) => r.y)) - Math.min(...settled.map((r) => r.y)) < 0.002,
          `${fps} Hz idle landing jitter`,
        );
        assert.ok(Math.abs(settled[0].y - 2) < 0.025);
        assert.equal(room.state.poses.get(room.sessionId).maxJumps, doubleJump ? 2 : 1);
      } finally {
        prediction?.dispose();
        physics?.dispose();
        await room.leave();
      }
    }
  },
);

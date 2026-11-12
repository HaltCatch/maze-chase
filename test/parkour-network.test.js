import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { startTestServer } from './support/server.js';
test(
  'two actual clients share course projectile impacts and authoritative knockback without damage',
  { timeout: 15000 },
  async (t) => {
    const { root } = await startTestServer(t);
    const sdk = () => new Client(root, { headers: { Origin: root } });
    const floor = {
      version: 1,
      id: 'items-qa',
      name: 'items',
      size: 32,
      ground: false,
      spawn: { x: 10, y: 2, z: 10 },
      checkpoints: [
        { x: 25, y: 2, z: 25 },
        { x: 26, y: 2, z: 25 },
      ],
      pickups: [{ id: 'rocket', kind: 'rocket', x: 10, y: 2.65, z: 9.35 }],
      colliders: [
        {
          id: 'floor',
          x: 16,
          y: 1.8,
          z: 16,
          width: 30,
          depth: 30,
          height: 0.4,
          surface: 'wood',
          climbable: false,
        },
        {
          id: 'box',
          x: 28,
          y: 3,
          z: 28,
          width: 1,
          depth: 1,
          height: 2,
          surface: 'wood',
          climbable: false,
        },
      ],
    };
    const a = await sdk().create('match', { mode: 'parkour', customMap: floor, maxPlayers: 2 });
    const b = await sdk().joinById(a.roomId);
    const rooms = [a, b],
      messages = new Map(rooms.map((r) => [r, []]));
    t.after(async () => {
      await Promise.allSettled(rooms.map((r) => r.leave()));
    });
    for (const r of rooms) {
      r.onMessage('game', (m) => {
        messages.get(r).push(m);
        if (m.type === 'lobby' && !m.members.find((p) => p.id === r.sessionId)?.ready)
          r.send('command', { type: 'assets-ready', revision: m.revision });
        if (m.type === 'start') r.send('command', { type: 'scene-ready' });
      });
      r.send('command', { type: 'hello', name: r === a ? 'a' : 'b' });
    }
    const wait = async (r, f) => {
      for (let i = 0; i < 600; i++) {
        const match = messages.get(r).find(f);
        if (match) return match;
        await delay(10);
      }
      assert.fail('missing ' + f);
    };
    await wait(a, (m) => m.type === 'lobby' && m.count === 2 && m.members.every((p) => p.ready));
    a.send('command', { type: 'start' });
    await wait(a, (m) => m.type === 'state' && m.parkour?.rockets === 1);
    await wait(b, (m) => m.type === 'state' && m.parkour?.rockets === 1);
    a.send('command', { type: 'input', yaw: -Math.PI / 2 });
    a.send('command', { type: 'parkour-use', pitch: 0 });
    for (const r of rooms) await wait(r, (m) => m.type === 'parkour-impact');
    await wait(b, (m) => m.type === 'state' && m.self.vy > 2);
    const hit = messages.get(b).find((m) => m.type === 'state' && m.self.vy > 2);
    await wait(b, (m) => m.type === 'state' && m.self.x > 10.2 && m.self.vy > 0);
    assert.equal(hit.self.alive, true);
    await wait(a, (m) => m.type === 'state' && m.parkour?.rockets === 0);
    assert.equal(a.state.poses.size, 1);
    assert.equal(b.state.poses.size, 1);
  },
);

test(
  'two clients independently collect coins, consume finite summit ammo and respawn after a fall',
  { timeout: 15000 },
  async (t) => {
    const { root } = await startTestServer(t);
    const sdk = () => new Client(root, { headers: { Origin: root } });
    const customMap = {
      version: 1,
      id: 'coin-qa',
      name: '金币复测',
      size: 32,
      ground: true,
      groundY: -3,
      spawn: { x: 10, y: 2, z: 10 },
      checkpoints: [
        { x: 9, y: 2, z: 11 },
        { x: 11, y: 2, z: 10 },
      ],
      collectibles: [{ id: 'coin', x: 9.7, y: 2.65, z: 8.65 }],
      pickups: [
        { id: 'summit-launcher', kind: 'rocket', ammo: 3, x: 10, y: 2.65, z: 9.35 },
        { id: 'jump', kind: 'double-jump', x: 11.6, y: 2.65, z: 9.35 },
      ],
      colliders: [
        {
          id: 'start',
          x: 10,
          y: 1.8,
          z: 10,
          width: 5,
          depth: 5,
          height: 0.4,
          surface: 'wood',
          climbable: false,
        },
        {
          id: 'return',
          x: 10,
          y: -0.5,
          z: 15,
          width: 2,
          depth: 5,
          height: 5,
          surface: 'wood',
          climbable: false,
          ramp: 'negative-z',
        },
      ],
    };
    const a = await sdk().create('match', {
      mode: 'parkour',
      customMap,
      maxPlayers: 2,
      doubleJump: true,
      airJumpHeight: 1.3,
    });
    const b = await sdk().joinById(a.roomId);
    const rooms = [a, b],
      latest = new Map(),
      events = new Map(rooms.map((r) => [r, []]));
    t.after(() => Promise.allSettled(rooms.map((r) => r.leave())));
    for (const r of rooms) {
      r.onMessage('game', (m) => {
        events.get(r).push(m);
        if (m.type === 'state') latest.set(r, m);
        if (m.type === 'lobby' && !m.members.find((p) => p.id === r.sessionId)?.ready)
          r.send('command', { type: 'assets-ready', revision: m.revision });
        if (m.type === 'start') r.send('command', { type: 'scene-ready' });
      });
      r.send('command', { type: 'hello', name: r === a ? 'a' : 'b' });
    }
    const wait = async (f) => {
      for (let i = 0; i < 600; i++) {
        if (f()) return;
        await delay(10);
      }
      assert.fail('missing ' + f);
    };
    await wait(() =>
      events
        .get(a)
        .some((m) => m.type === 'lobby' && m.count === 2 && m.members.every((p) => p.ready)),
    );
    a.send('command', { type: 'start' });
    await wait(() => latest.get(a)?.parkour?.coins === 1 && latest.get(b)?.parkour?.coins === 1);
    assert.equal(latest.get(b).parkour.rockets, 3);
    assert.equal(
      b.state.poses.get(b.sessionId).maxJumps,
      1,
      'creation options cannot bypass pickup',
    );
    for (let i = 0; i < 4; i++) {
      b.send('command', { type: 'parkour-use', pitch: 0.3 });
      await delay(950);
    }
    assert.equal(events.get(b).filter((m) => m.type === 'parkour-launch').length, 3);
    assert.equal(latest.get(b).parkour.rockets, 0);
    assert.equal(latest.get(a).parkour.trophyOwner, b.sessionId);
    const { MoveInput } = await import('../src/network/movement.ts');
    const input = b.input({ type: MoveInput, mode: 'reliable' });
    Object.assign(input.data, { moveX: 1, moveZ: 0, yaw: 0, run: false, quiet: false, jump: 0 });
    const timer = setInterval(() => input.send(), 50);
    t.after(() => clearInterval(timer));
    await wait(() => latest.get(b)?.parkour?.falls === 1);
    clearInterval(timer);
    Object.assign(input.data, { moveX: 0 });
    input.send();
    await delay(150);
    const landed = latest.get(b);
    assert.ok(Math.abs(landed.self.y - 2) < 0.05);
    assert.ok(Math.abs(landed.self.x - 10) < 1);
    assert.equal(landed.parkour.coins, 0);
    assert.equal(landed.parkour.airJumpUnlocked, false);
    assert.equal(b.state.poses.get(b.sessionId).maxJumps, 1);
    assert.ok(events.get(b).some((m) => m.parkour?.airJumpUnlocked));
    assert.equal(latest.get(a).parkour.coins, 1);
    assert.equal(latest.get(a).parkour.airJumpUnlocked, false);
    assert.equal(landed.parkour.trophyOwner, b.sessionId);
  },
);

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client } from '@colyseus/sdk';
import { startTestServer } from './support/server.js';
import { MoveInput } from '../src/network/movement.ts';

test(
  'native Colyseus directory, eight-player rooms, private poses, input, AI counts and map validation',
  { timeout: 40000 },
  async (t) => {
    const { server, root, logs } = await startTestServer(t);
    const sdk = () => new Client(root, { headers: { Origin: root } });
    const rooms = [];
    t.after(async () => {
      await Promise.allSettled(rooms.map((r) => r.leave()));
    });
    async function wrapped(room) {
      rooms.push(room);
      const messages = [];
      room.onMessage('game', (m) => messages.push(m));
      room.send('command', { type: 'hello', name: '测试玩家' });
      return {
        room,
        send: (m) => room.send('command', m),
        async receive(predicate) {
          for (let i = 0; i < 400; i++) {
            const at = messages.findIndex(predicate);
            if (at !== -1) return messages.splice(at, 1)[0];
            await delay(10);
          }
          assert.fail('Missing ' + predicate + '\n' + logs());
        },
      };
    }
    const lobby = await sdk().joinOrCreate('lobby', { filter: { name: 'match' } });
    rooms.push(lobby);
    const directory = [];
    lobby.onMessage('*', (type, m) => directory.push({ type, m }));
    const host = await wrapped(
      await sdk().create('match', {
        mode: 'parkour',
        arena: 'skyline',
        maxPlayers: 8,
        aiCount: 8,
        doubleJump: true,
        airJumpHeight: 1.3,
      }),
    );
    const guests = [];
    for (let i = 0; i < 7; i++) guests.push(await wrapped(await sdk().joinById(host.room.roomId)));
    const full = await host.receive((m) => m.type === 'lobby' && m.count === 8);
    assert.equal(full.aiCount, 0, 'parkour is a human race, no combat bots');
    assert.equal(full.doubleJump, true);
    assert.equal(full.airJumpHeight, 1.3);
    await assert.rejects(() => sdk().joinById(host.room.roomId));
    const all = [host, ...guests];
    for (const c of all) c.send({ type: 'assets-ready', revision: full.revision });
    await host.receive((m) => m.type === 'lobby' && m.members.every((p) => p.ready));
    host.send({ type: 'start' });
    for (const c of all) {
      const start = await c.receive((m) => m.type === 'start');
      assert.equal(start.mode, 'parkour');
      assert.equal(start.definition.checkpoints.length, 3);
      assert.deepEqual(start.self.ammo, {});
      assert.equal(start.self.maxJumps, 2);
      assert.equal(start.self.airJumpHeight, 1.3);
      c.send({ type: 'scene-ready' });
    }
    await delay(120);
    for (const c of all) {
      assert.equal(c.room.state.poses.size, 1, 'private state must not leak hidden players');
      assert.ok(c.room.state.poses.has(c.room.sessionId));
    }
    const input = host.room.input({ type: MoveInput, mode: 'reliable' });
    Object.assign(input.data, {
      moveX: 0,
      moveZ: 1,
      yaw: -Math.PI / 2,
      run: false,
      quiet: false,
      jump: 0,
    });
    const initial = host.room.state.poses.get(host.room.sessionId).x;
    for (let i = 0; i < 8; i++) {
      input.send();
      await delay(50);
    }
    assert.ok(
      host.room.state.poses.get(host.room.sessionId).x > initial + 0.5,
      JSON.stringify({
        initial,
        pose: host.room.state.poses.get(host.room.sessionId).toJSON(),
        ack: input.lastProcessed,
        sent: input.sentCount,
        stderr: logs(),
      }),
    );
    assert.ok(input.lastProcessed > 0);
    const reconnected = new Promise((resolve) => host.room.onReconnect(resolve)),
      oldId = host.room.sessionId;
    host.room.reconnection.minUptime = 0;
    host.room.connection.close(4010, 'test reconnect');
    await reconnected;
    assert.equal(host.room.sessionId, oldId);
    const resumed = await host.receive((m) => m.type === 'start');
    assert.equal(resumed.mode, 'parkour');
    assert.equal(resumed.self.maxJumps, 2);
    assert.equal(resumed.self.airJumpHeight, 1.3);
    host.send({ type: 'scene-ready' });
    await delay(120);
    assert.equal(host.room.state.poses.size, 1);
    assert.ok(host.room.state.poses.has(oldId));
    for (const c of all) await c.room.leave();
    for (const mode of ['escape', 'duel', 'skirmish', 'gungame', 'survival']) {
      const c = await wrapped(
        await sdk().create('match', { mode, arena: 'warehouse', maxPlayers: 4, aiCount: 2 }),
      );
      const l = await c.receive((m) => m.type === 'lobby');
      assert.equal(l.aiCount, 2);
      c.send({ type: 'assets-ready', revision: l.revision });
      await c.receive((m) => m.type === 'lobby' && m.members.every((p) => p.ready));
      c.send({ type: 'start' });
      const start = await c.receive((m) => m.type === 'start');
      assert.equal(start.solo, true);
      assert.equal(start.self.maxJumps, 1);
      assert.equal(start.self.airJumpHeight, 1);
      c.send({ type: 'scene-ready' });
      const state = await c.receive((m) => m.type === 'state');
      assert.equal(state.self.alive, true);
      assert.ok(Number.isFinite(state.self.x));
      await c.room.leave();
    }
    for (const mode of ['escape']) {
      const c = await wrapped(await sdk().create('match', { mode, aiCount: 0 }));
      const lobby = await c.receive((m) => m.type === 'lobby');
      c.send({ type: 'assets-ready', revision: lobby.revision });
      await c.receive((m) => m.type === 'lobby' && m.members.every((p) => p.ready));
      c.send({ type: 'start' });
      const start = await c.receive((m) => m.type === 'start');
      assert.equal(start.self.monster, false, 'solo practice must have a runner objective');
      c.send({ type: 'scene-ready' });
      await c.receive((m) => m.type === 'state' && m.phase === 'hunt');
      await c.room.leave();
    }
    await assert.rejects(() =>
      sdk().create('match', { mode: 'parkour', customMap: { version: 1 } }),
    );
    await assert.rejects(() =>
      new Client(root, { headers: { Origin: 'https://foreign.invalid' } }).create('match', {
        mode: 'parkour',
      }),
    );
    assert.equal(server.exitCode, null);
    assert.ok(directory.some((e) => e.type === '+' || e.type === 'rooms'));
  },
);

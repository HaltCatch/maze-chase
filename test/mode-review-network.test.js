import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { Client } from '@colyseus/sdk';
import { startTestServer } from './support/server.js';
import { initPhysics } from '../src/engine/physics.ts';
import { MatchSession } from '../src/server/rooms/session.js';
import { hurt } from '../src/server/combat.js';

test(
  'all five actions plus the gun ladder start with two real clients and no automatic extra bot',
  { timeout: 25000 },
  async (t) => {
    const { root } = await startTestServer(t),
      sdk = () => new Client(root, { headers: { Origin: root } }),
      rooms = [];
    t.after(() => Promise.allSettled(rooms.map((r) => r.leave())));
    async function client(r) {
      rooms.push(r);
      const ms = [];
      r.onMessage('game', (m) => ms.push(m));
      return {
        r,
        send: (m) => r.send('command', m),
        async next(fn) {
          for (let i = 0; i < 300; i++) {
            const at = ms.findIndex(fn);
            if (at >= 0) return ms.splice(at, 1)[0];
            await delay(10);
          }
          assert.fail('missing ' + fn);
        },
      };
    }
    await assert.rejects(() => sdk().create('match', { mode: 'hide' }));
    for (const mode of ['parkour', 'duel', 'skirmish', 'gungame', 'survival', 'escape']) {
      const a = await client(await sdk().create('match', { mode })),
        b = await client(await sdk().joinById(a.r.roomId));
      const lobby = await a.next((m) => m.type === 'lobby' && m.count === 2);
      assert.equal(lobby.aiCount, mode === 'parkour' ? 0 : -1);
      for (const c of [a, b]) c.send({ type: 'assets-ready', revision: lobby.revision });
      await a.next((m) => m.type === 'lobby' && m.members.every((p) => p.ready));
      a.send({ type: 'start' });
      const starts = await Promise.all([a, b].map((c) => c.next((m) => m.type === 'start')));
      assert.ok(
        starts.every((m) => m.solo === false),
        mode + ' no auto bots in a human duo',
      );
      if (mode === 'duel') assert.notDeepEqual(starts[0].duel.drop, starts[1].duel.drop);
      if (mode === 'gungame')
        for (const m of starts) assert.deepEqual(Object.keys(m.self.ammo), ['pistol']);
      for (const c of [a, b]) c.send({ type: 'scene-ready' });
      await Promise.all([a, b].map((c) => c.next((m) => m.type === 'state' && m.phase === 'hunt')));
      await Promise.all([a.r.leave(), b.r.leave()]);
    }
    const solo = await client(await sdk().create('match', { mode: 'escape' })),
      l = await solo.next((m) => m.type === 'lobby');
    solo.send({ type: 'assets-ready', revision: l.revision });
    await solo.next((m) => m.type === 'lobby' && m.members.every((p) => p.ready));
    solo.send({ type: 'start' });
    const s = await solo.next((m) => m.type === 'start');
    assert.equal(s.solo, true);
    assert.equal(s.self.monster, false);
  },
);

test('real Havok session exposes a downed ally, E revives once, next wave restores rescue, and maze rematch swaps roles', async () => {
  const havok = await initPhysics(
    await readFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))),
  );
  const messages = [];
  const session = new MatchSession(
    'rescue',
    { mode: 'survival', arena: 'docks', maxPlayers: 2, aiCount: 0 },
    havok,
    (p, m) => messages.push({ id: p.id, ...m }),
    () => {},
  );
  const a = session.add('a', 'A', true),
    b = session.add('b', 'B', true);
  try {
    session.start();
    a.sceneReady = b.sceneReady = true;
    session.tick();
    session.tick();
    const r = session.room;
    for (const p of [a, b]) session.world.release(p);
    Object.assign(a, { x: 12.5, z: 2.5, y: 0, attack: 0, spawnSafeUntil: 0 });
    Object.assign(b, { x: 12.5, z: 3.5, y: 0, spawnSafeUntil: 0 });
    hurt(r, b, 100, Date.now(), session.send, 'rifle', { x: 12.5, z: 8, side: 1 });
    b.ammo.rifle = 9;
    session.tick();
    const snap = messages.findLast((m) => m.type === 'state' && m.id === 'a');
    const ally = snap.players.find((p) => p.id === 'b');
    assert.equal(ally.downed, true);
    assert.equal(ally.motion, 'hide');
    assert.equal(ally.weapon, undefined);
    session.handle(a, { type: 'action' });
    assert.equal(b.alive, true);
    assert.equal(b.health, 50);
    assert.equal(b.ammo.rifle, 9);
    b.spawnSafeUntil = 0;
    hurt(r, b, 100, Date.now(), session.send, 'rifle', { x: 12.5, z: 8, side: 1 });
    a.attack = 0;
    session.handle(a, { type: 'action' });
    assert.equal(b.alive, false);
    r.wave.state = 'break';
    r.wave.nextAt = 0;
    session.tick();
    assert.equal(b.alive, true);
    assert.equal(b.rescuedThisWave, false);
  } finally {
    session.dispose();
  }
  const maze = new MatchSession(
    'swap',
    { mode: 'escape', maxPlayers: 2, aiCount: 0 },
    havok,
    () => {},
    () => {},
  );
  try {
    const a = maze.add('a', 'A', true),
      b = maze.add('b', 'B', true);
    maze.start();
    assert.equal(a.monster, true);
    maze.finish('timeout');
    maze.start();
    assert.equal(b.monster, true);
    assert.equal(a.monster, false);
  } finally {
    maze.dispose();
  }
});

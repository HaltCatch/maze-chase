import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { MoveInput } from '../src/network/movement.ts';
import { startTestServer } from './support/server.js';
test(
  'crouched players can fire, reload and switch weapons without losing their session',
  { timeout: 15000 },
  async (t) => {
    const { root } = await startTestServer(t);
    const room = await new Client(root, { headers: { Origin: root } }).create('match', {
      mode: 'skirmish',
      aiCount: 0,
      maxPlayers: 2,
    });
    let state,
      start,
      closed = false,
      ready = false;
    room.onLeave(() => {
      closed = true;
    });
    room.onMessage('game', (m) => {
      if (m.type === 'lobby' && !ready) {
        if (!m.members[0].ready)
          room.send('command', { type: 'assets-ready', revision: m.revision });
        else {
          ready = true;
          room.send('command', { type: 'start' });
        }
      }
      if (m.type === 'start') {
        start = m;
        room.send('command', { type: 'scene-ready' });
      }
      if (m.type === 'state') state = m;
    });
    room.send('command', { type: 'hello', name: 'crouch-fire' });
    const wait = async (fn) => {
      for (let i = 0; i < 300; i++) {
        if (fn()) return;
        await delay(15);
      }
      assert.fail('missing combat state');
    };
    let timer;
    try {
      await wait(() => start && state?.phase === 'hunt');
      const input = room.input({ type: MoveInput, mode: 'reliable' });
      Object.assign(input.data, { quiet: true, run: false, moveX: 0, moveZ: 0, yaw: 0, jump: 0 });
      timer = setInterval(() => input.send(), 50);
      await delay(200);
      for (let shot = 0; shot < 8; shot++) {
        room.send('command', { type: 'weapon-fire', weapon: 'rifle', pitch: -0.4 });
        await delay(160);
      }
      await wait(() => state?.self.ammo.rifle === 22);
      assert.equal(state.self.alive, true);
      room.send('command', { type: 'weapon-reload', weapon: 'rifle' });
      await wait(() => state?.self.reload?.name === 'rifle');
      await wait(() => state?.self.ammo.rifle === 30 && !state.self.reload);
      room.send('command', { type: 'weapon-select', weapon: 'pistol' });
      await delay(300);
      room.send('command', { type: 'weapon-fire', weapon: 'pistol', pitch: -0.4 });
      await wait(() => state?.self.ammo.pistol === 6);
      input.data.quiet = false;
      await delay(150);
      assert.equal(closed, false);
      assert.ok(input.lastProcessed > 30);
      assert.ok([state.self.x, state.self.y, state.self.z].every(Number.isFinite));
    } finally {
      clearInterval(timer);
      await room.leave();
    }
  },
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../src/server/rooms/game-room.ts';

test('native disconnect logs distinguish normal going-away from abnormal and unknown codes', async () => {
  const savedInfo = console.info;
  const savedWarn = console.warn;
  const records = [];
  console.info = (line) => records.push({ stream: 'info', ...JSON.parse(line) });
  console.warn = (line) => records.push({ stream: 'warn', ...JSON.parse(line) });
  try {
    for (const code of [1000, 1001, 1006, 4010, undefined]) {
      const player = { id: 'session', connection: {}, input: { f: true } };
      const calls = [];
      const room = {
        roomId: 'isolated-room',
        session: { room: { players: [player] } },
        allowReconnection: async (...args) => calls.push(args),
      };
      const client = { sessionId: 'session' };
      await GameRoom.prototype.onDrop.call(room, client, code);
      const record = records.at(-1);
      assert.equal(record.level, code === 1000 || code === 1001 ? 'info' : 'warn');
      assert.equal(record.stream, record.level);
      assert.equal(record.event, 'player-disconnected');
      assert.equal(record.code, code);
      assert.equal(record.session, 'session');
      assert.equal(record.room, 'isolated-room');
      assert.equal(player.connection, null);
      assert.equal(player.input.f, false);
      assert.deepEqual(calls, [[client, 20]], 'reconnection behavior stays intact');
    }
  } finally {
    console.info = savedInfo;
    console.warn = savedWarn;
  }
});

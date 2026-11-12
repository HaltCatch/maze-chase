import test from 'node:test';
import assert from 'node:assert/strict';
import { GameConnection } from '../src/network/client.ts';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function room() {
  const callbacks = {};
  const leave = deferred();
  return {
    callbacks,
    reconnection: { enabled: true },
    sent: [],
    left: 0,
    onDrop(f) {
      callbacks.drop = f;
    },
    onReconnect(f) {
      callbacks.reconnect = f;
    },
    onMessage(t, f) {
      callbacks[t] = f;
    },
    onLeave(f) {
      callbacks.leave = f;
    },
    onError(f) {
      callbacks.error = f;
    },
    send(t, m) {
      this.sent.push(m);
    },
    leave() {
      this.left++;
      return leave.promise;
    },
    ack() {
      leave.resolve();
    },
  };
}
test('leaving while joining cancels the late room without blocking another join', async () => {
  const first = deferred(),
    second = deferred(),
    packets = [];
  let count = 0;
  const connection = new GameConnection(
    (m) => packets.push(m),
    () => {},
    { create: () => (++count === 1 ? first : second).promise },
  );
  const pending = connection.send({ type: 'create' });
  await connection.send({ type: 'leave' });
  assert.equal(packets.at(-1).type, 'left');
  const next = connection.send({ type: 'create' }),
    a = room(),
    b = room();
  second.resolve(b);
  await next;
  assert.equal(connection.activeRoom, b);
  first.resolve(a);
  await Promise.resolve();
  assert.equal(a.left, 1);
  a.ack();
  await pending;
  assert.equal(connection.activeRoom, b);
  b.callbacks.game({ type: 'lobby', room: 'new' });
  assert.equal(packets.at(-1).room, 'new');
  b.ack();
  await connection.close();
});
test('old callbacks and delayed leave acknowledgments cannot resurrect a departed room', async () => {
  const a = room(),
    b = room(),
    packets = [];
  let count = 0;
  const connection = new GameConnection(
    (m) => packets.push(m),
    () => {},
    { create: async () => (++count === 1 ? a : b) },
  );
  await connection.send({ type: 'create' });
  a.callbacks.drop();
  assert.equal(packets.at(-1).type, 'connection-lost');
  a.callbacks.reconnect();
  assert.equal(packets.at(-1).type, 'connection-restored');
  const leaving = connection.send({ type: 'leave' });
  assert.equal(connection.activeRoom, undefined);
  assert.equal(a.reconnection.enabled, false);
  await connection.send({ type: 'create' });
  const before = packets.length;
  a.callbacks.game({ type: 'start' });
  a.callbacks.leave(1000);
  a.callbacks.drop();
  a.callbacks.error(1, 'old');
  a.ack();
  await leaving;
  assert.equal(packets.length, before);
  assert.equal(connection.activeRoom, b);
  b.ack();
  await connection.close();
});

test('cancelled engine readiness releases a scene even if its underlying promise never settles', async () => {
  const { abortable } = await import('../src/client/controllers/scene-loading.ts');
  const controller = new AbortController();
  const pending = abortable(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(
    await abortable(Promise.resolve('new scene'), new AbortController().signal),
    'new scene',
  );
  const failed = new Error('shader failure');
  await assert.rejects(abortable(Promise.reject(failed), new AbortController().signal), failed);
});

test('loading paint yield completes even when backgrounding suspends animation frames', async () => {
  const { nextPaint } = await import('../src/client/controllers/scene-loading.ts');
  const keys = ['document', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  let callback, cancelled;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  globalThis.requestAnimationFrame = (fn) => {
    callback = fn;
    return 7;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelled = id;
  };
  try {
    const pending = nextPaint();
    callback(); // First frame painted, then Chrome backgrounds the tab.
    document.hidden = true;
    await pending; // Second frame never fires; timeout must release asset loading.
    assert.equal(cancelled, 7);
    callback = undefined;
    await nextPaint();
    assert.equal(callback, undefined, 'already-hidden tabs never depend on rAF');
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
});

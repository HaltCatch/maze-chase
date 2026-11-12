import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { staticHandler } from '../src/server/static.js';
import { decodeClientPacket, isGameMode, readMovement } from '../src/shared/protocol.ts';

test('room packets reject unknown envelopes and only accept literal movement flags', () => {
  for (const value of ['oops', 'null', '[]', '{"type":"constructor"}', '{"type":42}']) {
    assert.equal(decodeClientPacket(value), null);
  }
  const packet = decodeClientPacket('{"type":"input","yaw":0,"f":true,"run":"true","l":1}');
  assert.deepEqual(readMovement(packet), {
    f: true,
    b: false,
    l: false,
    r: false,
    run: false,
    quiet: false,
    moveX: 0,
    moveZ: 1,
  });
  assert.equal(isGameMode('skirmish'), true);
  assert.equal(isGameMode('constructor'), false);
});

test('HTML revalidates and points to immutable gzip build files while asset URLs stay stable', async (t) => {
  const server = createServer(staticHandler()).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = 'http://127.0.0.1:' + server.address().port;
  const home = await fetch(root);
  assert.match(home.headers.get('cache-control'), /no-store/);
  const html = await home.text();
  for (const pattern of [
    /src="(\/game-[a-zA-Z0-9]{8,16}\.js)"/,
    /href="(\/style-[a-zA-Z0-9]{8,16}\.css)"/,
  ]) {
    const [, path] = html.match(pattern);
    const response = await fetch(root + path, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.ok((await response.text()).length > 1000);
  }
  const asset = await fetch(root + '/assets/smoke.glb', { method: 'HEAD' });
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(await asset.text(), '');
  assert.equal((await fetch(root + '/healthz', { method: 'HEAD' })).status, 200);
});

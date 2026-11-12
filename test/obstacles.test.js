import test from 'node:test';
import assert from 'node:assert/strict';
import { ParkourObstacles } from '../src/server/modes/parkour-obstacles.ts';
import { pendulumPose } from '../src/shared/obstacles.ts';
import { parkourMaps, mapDocumentSchema } from '../src/content/map-document.ts';
const obstacle = {
  id: 'test',
  x: 10,
  y: 4.2,
  z: 10,
  length: 3.35,
  radius: 0.58,
  axis: 'x',
  period: 4,
  phase: 0,
};
const player = (x = 10, z = 10) => ({
  x,
  y: 0,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  grounded: true,
  input: { quiet: false },
});
test('pendulum hits only the swept capsule, launches once and shares deterministic phase', () => {
  const o = new ParkourObstacles({ obstacles: [obstacle] });
  const p = player();
  assert.equal(o.tick(p, 0), true);
  assert.ok(p.vx > 0 && p.vy > 0 && !p.grounded);
  assert.equal(o.tick(p, 0.05), false, 'one impulse per contact window');
  for (const [x, z] of [
    [12, 10],
    [10, 12],
    [11, 11],
    [30, 10],
  ]) {
    assert.equal(
      new ParkourObstacles({ obstacles: [obstacle] }).tick(player(x, z), 0),
      false,
      `no remote hit ${x},${z}`,
    );
  }
  const far = player();
  far.y = 8;
  assert.equal(new ParkourObstacles({ obstacles: [obstacle] }).tick(far, 0), false);
  assert.deepEqual(pendulumPose(obstacle, 1), pendulumPose(obstacle, 5));
});
test('default obstacle course survives editor JSON round trip, has flat narrow traverses and bounded objects', () => {
  const map = mapDocumentSchema.parse(JSON.parse(JSON.stringify(parkourMaps.ascent)));
  assert.equal(map.obstacles.length, 10);
  assert.equal(map.checkpoints.length, 10);
  assert.ok(map.colliders.some((c) => c.width < 1));
  assert.ok(map.colliders.some((c) => c.depth < 1));
  assert.ok(map.colliders.some((c) => c.model === 'ascent-bridge'));
  assert.ok(map.collectibles.length >= 20);
  assert.ok(JSON.stringify(map).length < 65536);
  const invalid = structuredClone(map);
  invalid.obstacles[1].id = invalid.obstacles[0].id;
  assert.equal(mapDocumentSchema.safeParse(invalid).success, false);
});

test('bridge decks butt against landing pads without coplanar overlap', () => {
  const map = parkourMaps.ascent;
  for (const deck of map.colliders.filter((c) => c.id.startsWith('walkway-'))) {
    for (const pad of map.colliders.filter((c) => c.id.startsWith('route-'))) {
      if (Math.abs(pad.y - deck.y) > 0.01) continue;
      const x =
        Math.min(deck.x + deck.width / 2, pad.x + pad.width / 2) -
        Math.max(deck.x - deck.width / 2, pad.x - pad.width / 2);
      const z =
        Math.min(deck.z + deck.depth / 2, pad.z + pad.depth / 2) -
        Math.max(deck.z - deck.depth / 2, pad.z - pad.depth / 2);
      assert.ok(x < 1e-6 || z < 1e-6, `${deck.id}/${pad.id} overlap`);
    }
  }
});

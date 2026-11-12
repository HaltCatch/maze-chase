import assert from 'node:assert/strict';
import test from 'node:test';
import { bulletRegion, damageMultiplier } from '../src/shared/hit-regions.ts';
import { renderRatio } from '../src/client/render-quality.ts';

test('head, torso and legs have distinct server damage multipliers, excluding empty air', () => {
  const target = { x: 5, y: 0, z: 5, yaw: 0, kit: { character: 'operator' } };
  assert.equal(bulletRegion(target, 5, 1.61, 4.98), 'head');
  assert.equal(bulletRegion(target, 5, 1.1, 5), 'body');
  assert.equal(bulletRegion(target, 5, 0.3, 5), 'legs');
  assert.equal(bulletRegion(target, 5.24, 1.68, 5), null, 'space beside the head must miss');
  assert.equal(bulletRegion(target, 5, 2, 5), null);
  assert.equal(bulletRegion({ ...target, y: 2 }, 5, 3.61, 4.98), 'head');
  assert.deepEqual(damageMultiplier, { head: 2, body: 1, legs: 0.75 });
});

test('authored big heads and crouching poses use their own bounded regions', () => {
  for (const character of ['knight', 'rogue', 'mage', 'barbarian', 'ranger']) {
    const target = { x: 5, y: 0, z: 5, yaw: Math.PI / 2, kit: { character } };
    assert.equal(bulletRegion(target, 5, 1.3, 5), 'head');
    target.input = { quiet: true };
    assert.equal(bulletRegion(target, 4.75, 1.2, 5), 'head');
    assert.equal(bulletRegion(target, 5, 1.9, 5), null);
  }
  const human = { x: 5, y: 0, z: 5, yaw: 0, input: { quiet: true } };
  assert.equal(bulletRegion(human, 5, 1.02, 4.81), 'head');
  assert.equal(bulletRegion(human, 5, 1.5, 5), null);
});

test('adaptive rendering preserves native CSS-pixel clarity and caps supersampling', () => {
  for (const device of [1, 1.25, 2, 3])
    for (const quality of ['fast', 'balanced', 'detailed']) {
      for (const scale of [0.1, 0.7, 0.9, 1, 2]) {
        const ratio = renderRatio(device, quality, scale);
        assert.ok(ratio >= 1 && ratio <= 1.8);
      }
    }
  assert.equal(renderRatio(2, 'detailed', 1), 1.8);
  assert.equal(renderRatio(1, 'balanced', 0.7), 1);
});

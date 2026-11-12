import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { forestBounds } from '../src/content/forest-bounds.ts';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const read = (name) =>
  io.read(fileURLToPath(new URL('../public/assets/models/' + name + '.glb', import.meta.url)));
test('shipped forest geometry agrees with placement bounds and preserves route mesh dimensions', async () => {
  for (const [name, expected] of Object.entries(forestBounds)) {
    const document = await read(name);
    assert.deepEqual(getBounds(document.getRoot().listScenes()[0]), expected, name);
  }
  for (const [before, after] of [
    ['ascent-stairs', 'forest-stairs'],
    ['ascent-bridge', 'forest-bridge'],
    ['ascent-platform', 'forest-platform'],
    ['lobby-pallet', 'forest-pallet'],
  ]) {
    const a = getBounds((await read(before)).getRoot().listScenes()[0]);
    const b = getBounds((await read(after)).getRoot().listScenes()[0]);
    for (const edge of ['min', 'max'])
      for (let axis = 0; axis < 3; axis++)
        assert.ok(
          Math.abs(a[edge][axis] - b[edge][axis]) < 1e-5,
          after + ': visual geometry moved away from its collider',
        );
  }
});
test('foliage keeps masked alpha and architecture keeps a separate surface UV set', async () => {
  for (const name of ['forest-pine', 'forest-fir', 'forest-fern']) {
    const root = (await read(name)).getRoot();
    assert.ok(
      root.listMaterials().some((m) => m.getAlphaMode() === 'MASK' && m.getBaseColorTexture()),
      name,
    );
    assert.ok(
      root.listTextures().every((t) => t.getMimeType() === 'image/webp'),
      name,
    );
  }
  for (const name of ['forest-house', 'forest-house-alt', 'forest-tower']) {
    for (const mesh of (await read(name)).getRoot().listMeshes())
      for (const p of mesh.listPrimitives()) {
        assert.ok(p.getAttribute('TEXCOORD_0'), name + ': authored palette lost');
        assert.ok(p.getAttribute('TEXCOORD_1'), name + ': detail normal lacks tiled UVs');
      }
  }
});

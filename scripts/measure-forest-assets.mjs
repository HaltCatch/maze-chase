import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { writeFile } from 'node:fs/promises';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const bounds = {};
for (const name of [
  'forest-pine',
  'forest-fir',
  'forest-fern',
  'forest-stump',
  'forest-rock',
  'forest-house',
  'forest-house-alt',
  'forest-tower',
]) {
  const doc = await io.read(
    new URL('../public/assets/models/' + name + '.glb', import.meta.url).pathname,
  );
  bounds[name] = getBounds(doc.getRoot().listScenes()[0]);
}
await writeFile(
  new URL('../src/content/forest-bounds.ts', import.meta.url),
  '// Generated from shipped author meshes by scripts/measure-forest-assets.mjs.\nexport const forestBounds = ' +
    JSON.stringify(bounds, null, 2) +
    ' as const;\n',
);

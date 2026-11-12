// Assemble Kenney's modular rocket pieces, retaining authored geometry/materials.
// Pass the directory containing the three original GLBs; see LICENSES/weapon-assets.txt.
import { Document, NodeIO } from '@gltf-transform/core';
import { mergeDocuments, dedup, prune, unpartition } from '@gltf-transform/functions';
const io = new NodeIO(),
  out = new Document(),
  scene = out.createScene('course-rocket');
let y = 0;
for (const part of ['rocket-finsa', 'rocket-fuela', 'rocket-topa']) {
  const source = await io.read(process.argv[2] + '/' + part + '.glb');
  let min = Infinity,
    max = -Infinity;
  for (const mesh of source.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const positions = p.getAttribute('POSITION').getArray();
      for (let i = 1; i < positions.length; i += 3) {
        min = Math.min(min, positions[i]);
        max = Math.max(max, positions[i]);
      }
    }
  const mapping = mergeDocuments(out, source);
  for (const s of source.getRoot().listScenes()) {
    const copy = mapping.get(s),
      group = out.createNode(part).setTranslation([0, y - min, 0]);
    for (const node of copy.listChildren()) group.addChild(node);
    scene.addChild(group);
    copy.dispose();
  }
  y += max - min;
}
out.getRoot().setDefaultScene(scene);
await out.transform(dedup(), prune(), unpartition());
await io.write(new URL('../public/assets/models/ascent-rocket.glb', import.meta.url).pathname, out);

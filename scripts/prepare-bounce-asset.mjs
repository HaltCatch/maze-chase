// Extract the authored inflatable body, removing its dangling string and knot.
// Source and license: LICENSES/weapon-assets.txt. No geometry is generated.
import { NodeIO } from '@gltf-transform/core';
import { compactPrimitive, prune } from '@gltf-transform/functions';
const io = new NodeIO(),
  doc = await io.read(process.argv[2]);
const primitive = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const positions = primitive.getAttribute('POSITION').getArray(),
  indices = primitive.getIndices().getArray();
const kept = [];
for (let i = 0; i < indices.length; i += 3)
  if ([indices[i], indices[i + 1], indices[i + 2]].every((v) => positions[v * 3 + 1] > -0.164))
    kept.push(indices[i], indices[i + 1], indices[i + 2]);
primitive.setIndices(
  doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array(kept))
    .setBuffer(doc.getRoot().listBuffers()[0]),
);
compactPrimitive(primitive);
await doc.transform(prune());
await io.write(new URL('../public/assets/models/ascent-bounce.glb', import.meta.url).pathname, doc);

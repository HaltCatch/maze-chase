import { readFile, writeFile } from 'node:fs/promises';

// Extract authored KayKit 1.1 clips without bringing its preview mesh into the game.
const source = await readFile(process.argv[2]);
const jsonSize = source.readUInt32LE(12);
const json = JSON.parse(source.subarray(20, 20 + jsonSize).toString());
const binStart = 20 + jsonSize;
const binary = source.subarray(binStart + 8, binStart + 8 + source.readUInt32LE(binStart));
const selected = new Set(['Crouching', 'Sneaking']);
json.animations = json.animations.filter((animation) => selected.has(animation.name));
if (json.animations.length !== selected.size) throw new Error('Expected KayKit movement clips');
const accessorIds = [
  ...new Set(
    json.animations.flatMap((animation) =>
      animation.samplers.flatMap((sampler) => [sampler.input, sampler.output]),
    ),
  ),
];
const viewIds = [...new Set(accessorIds.map((id) => json.accessors[id].bufferView))];
const chunks = [];
let offset = 0;
json.bufferViews = viewIds.map((id) => {
  const view = json.bufferViews[id];
  const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
  bytes.copy(padded);
  chunks.push(padded);
  const result = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
  if (view.byteStride) result.byteStride = view.byteStride;
  offset += padded.length;
  return result;
});
json.accessors = accessorIds.map((id) => {
  const accessor = json.accessors[id];
  if (accessor.sparse) throw new Error('Sparse animation accessor unsupported');
  return { ...accessor, bufferView: viewIds.indexOf(accessor.bufferView) };
});
for (const animation of json.animations)
  for (const sampler of animation.samplers) {
    sampler.input = accessorIds.indexOf(sampler.input);
    sampler.output = accessorIds.indexOf(sampler.output);
  }
for (const node of json.nodes) {
  delete node.mesh;
  delete node.skin;
}
for (const key of ['meshes', 'skins', 'materials', 'textures', 'images', 'samplers'])
  delete json[key];
json.buffers = [{ byteLength: offset }];
const encoded = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
encoded.copy(jsonChunk);
const binChunk = Buffer.concat(chunks);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
header.writeUInt32LE(jsonChunk.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
const output = new URL('../public/assets/models/kaykit-movement.glb', import.meta.url);
await writeFile(output, Buffer.concat([header, jsonChunk, binHeader, binChunk]));
console.log('Extracted Crouching and Sneaking', Math.round(binChunk.length / 1024), 'KiB');

import { readFile } from 'node:fs/promises';
const actualFetch = globalThis.fetch;
// Exercise the actual authored skeletons, clips and Babylon cloning in NullEngine.
// Only image materials are stripped: no GPU/DOM image decoder exists in node:test.
globalThis.fetch = async (url) => {
  if (!String(url).startsWith('/assets/')) return actualFetch(url);
  const data = await readFile(
    new URL('../../public/assets/models/' + String(url).split('/').at(-1), import.meta.url),
  );
  const length = data.readUInt32LE(12),
    json = JSON.parse(data.subarray(20, 20 + length).toString());
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) delete primitive.material;
  for (const key of ['materials', 'textures', 'images', 'extensionsRequired']) delete json[key];
  const text = Buffer.from(JSON.stringify(json)),
    padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const rest = data.subarray(20 + length),
    result = Buffer.alloc(20 + padded.length + rest.length);
  data.copy(result, 0, 0, 20);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  padded.copy(result, 20);
  rest.copy(result, 20 + padded.length);
  return new Response(result);
};

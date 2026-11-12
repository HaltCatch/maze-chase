import { createHash } from 'node:crypto';
import { readFile, mkdir, readdir, unlink, writeFile, rename, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../dist/', import.meta.url);
const result = await build({
  absWorkingDir: root,
  entryPoints: { game: 'src/client/game.js' },
  bundle: true,
  minify: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'inline',
  write: false,
  metafile: true,
});
const style = Buffer.concat(
  await Promise.all(
    ['style.css', 'lobby.css'].map((file) =>
      readFile(new URL('../public/' + file, import.meta.url)),
    ),
  ),
);
await mkdir(out, { recursive: true });
const manifest = { game: '', style: '', chunks: [] };
let gameGzipBytes = 0;
for (const output of result.outputFiles) {
  const file = output.path.split('/').at(-1),
    compressed = gzipSync(output.contents);
  if (file.startsWith('game-')) manifest.game = file;
  else manifest.chunks.push(file);
  gameGzipBytes += compressed.length;
  await Promise.all([
    writeFile(new URL(file, out), output.contents),
    writeFile(new URL(file + '.gz', out), compressed),
  ]);
}
const hash = createHash('sha256').update(style).digest('hex').slice(0, 16);
manifest.style = 'style-' + hash + '.css';
await Promise.all([
  writeFile(new URL(manifest.style, out), style),
  writeFile(new URL(manifest.style + '.gz', out), gzipSync(style)),
]);
await writeFile(new URL('manifest.tmp', out), JSON.stringify(manifest) + '\n');
await rename(new URL('manifest.tmp', out), new URL('manifest.json', out));
const keep = new Set(
  [manifest.game, manifest.style, ...manifest.chunks].flatMap((file) => [file, file + '.gz']),
);
for (const file of await readdir(out)) {
  if (/^(game|style|chunk)-[a-zA-Z0-9]{8,16}\.(js|css)(\.gz)?$/.test(file) && !keep.has(file))
    await unlink(new URL(file, out));
}
await mkdir(new URL('engine/', out), { recursive: true });
const wasm = await readFile(
  new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm')),
);
await Promise.all([
  writeFile(new URL('engine/havok.wasm', out), wasm),
  writeFile(new URL('engine/havok.wasm.gz', out), gzipSync(wasm)),
]);
const outputs = result.metafile.outputs,
  initial = new Set();
function collect(file) {
  if (initial.has(file)) return;
  initial.add(file);
  for (const dep of outputs[file]?.imports ?? [])
    if (dep.kind === 'import-statement') collect(dep.path);
}
collect('dist/' + manifest.game);
const initialGzip = result.outputFiles
  .filter((f) => initial.has(f.path.slice(root.length)))
  .reduce((n, f) => n + gzipSync(f.contents).length, 0);
await writeFile(
  new URL('build-report.json', out),
  JSON.stringify(
    {
      initialJsGzip: initialGzip,
      totalJsGzip: gameGzipBytes,
      wasmGzip: gzipSync(wasm).length,
      chunks: manifest.chunks.length,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Initial JS:',
  Math.round(initialGzip / 1024) + ' KiB gzip; Havok:',
  Math.round(gzipSync(wasm).length / 1024) + ' KiB gzip',
);
console.log('Client bundle:', manifest.game, Math.round(gameGzipBytes / 1024) + ' KiB gzip');

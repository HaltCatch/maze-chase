import { readFileSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const types = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  glb: 'model/gltf-binary',
  mp3: 'audio/mpeg',
  webp: 'image/webp',
  wasm: 'application/wasm',
};
const csp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob: data:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export function staticHandler() {
  const manifest = JSON.parse(read('dist/manifest.json')),
    routes = new Map();
  function file(path, relative, type, immutable = false) {
    const url = new URL(relative, root),
      etag = '"' + createHash('sha256').update(readFileSync(url)).digest('hex').slice(0, 24) + '"';
    routes.set(path, {
      url,
      type,
      size: statSync(url).size,
      etag,
      cache: immutable ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    });
  }
  for (const [key, ext] of [
    ['game', 'js'],
    ['style', 'css'],
  ]) {
    const name = manifest[key];
    if (!new RegExp('^' + key + '-[a-zA-Z0-9]{8,16}\\.' + ext + '$').test(name))
      throw new Error('Invalid manifest');
    file('/' + name, 'dist/' + name, types[ext], true);
    file('/' + name + '.gz', 'dist/' + name + '.gz', types[ext], true);
  }
  for (const name of manifest.chunks ?? []) {
    if (!/^chunk-[A-Z0-9]{8}\.js$/.test(name)) throw new Error('Invalid chunk');
    file('/' + name, 'dist/' + name, types.js, true);
    file('/' + name + '.gz', 'dist/' + name + '.gz', types.js, true);
  }
  const html = Buffer.from(
    read('public/index.html')
      .toString()
      .replace('__GAME_SCRIPT__', '/' + manifest.game)
      .replace('__GAME_STYLE__', '/' + manifest.style),
  );
  routes.set('/', {
    body: html,
    gzip: gzipSync(html),
    type: types.html,
    cache: 'private, no-store, max-age=0',
  });
  file('/icons.svg', 'public/icons.svg', types.svg);
  file('/credits', 'LICENSES/weapon-assets.txt', types.txt);
  file('/engine/havok.wasm', 'dist/engine/havok.wasm', types.wasm);
  file('/engine/havok.wasm.gz', 'dist/engine/havok.wasm.gz', types.wasm);
  for (const [folder, ext] of [
    ['audio', 'mp3'],
    ['models', 'glb'],
    ['textures', 'webp'],
    ['portraits', 'webp'],
  ]) {
    const directory = 'public/assets/' + folder + '/';
    for (const name of readdirSync(new URL(directory, root)))
      if (new RegExp('^[a-z0-9-]+\\.' + ext + '$').test(name))
        file('/assets/' + name, directory + name, types[ext]);
  }
  return (req, res) => {
    const path = req.url?.split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    if (path === '/healthz')
      return res
        .writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
        .end(req.method === 'HEAD' ? undefined : 'ok');
    let entry = routes.get(path);
    if (!entry) return res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    const accepts = /\bgzip\b/.test(req.headers['accept-encoding'] || ''),
      compressed = accepts && (entry.gzip || routes.has(path + '.gz'));
    if (compressed && !entry.gzip) entry = routes.get(path + '.gz');
    const headers = {
      'Content-Type': entry.type,
      'Cache-Control': entry.cache,
      Vary: 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': csp,
      ...(entry.etag ? { ETag: entry.etag } : {}),
      ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
    };
    if (entry.etag && req.headers['if-none-match'] === entry.etag)
      return res.writeHead(304, headers).end();
    const body = compressed && entry.gzip ? entry.gzip : entry.body;
    res.writeHead(200, { ...headers, 'Content-Length': body?.length ?? entry.size });
    if (req.method === 'HEAD') return res.end();
    if (body) return res.end(body);
    const stream = createReadStream(entry.url);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };
}

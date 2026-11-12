import {build} from 'esbuild';
import {rm,mkdir,copyFile,writeFile} from 'node:fs/promises';
await rm('pages-dist',{recursive:true,force:true});
await mkdir('pages-dist/engine',{recursive:true});
await build({entryPoints:['src/client/solo.ts'],outfile:'pages-dist/solo.js',bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'linked'});
await copyFile('public/solo.html','pages-dist/index.html');
await copyFile(new URL(import.meta.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm')),'pages-dist/engine/havok.wasm');
await writeFile('pages-dist/.nojekyll','');

import { NodeIO } from '@gltf-transform/core';
import { prune, resample, dedup } from '@gltf-transform/functions';
import { resolve } from 'node:path';

// Explicit local upstream checkouts. Nothing is downloaded or generated at build.
const [arenaRoot, adventurersRoot, humanoidRoot] = process.argv.slice(2);
if (!humanoidRoot)
  throw new Error('Usage: node scripts/prepare-showcase-assets.mjs ARENA ADVENTURERS HUMANOID');
const io = new NodeIO(),
  out = new URL('../public/assets/models/', import.meta.url);
for (const [original, name] of [
  ['Container_Small', 'container'],
  ['Pallet', 'pallet'],
  ['Crate', 'crate'],
  ['StreetLight', 'lamp'],
]) {
  const doc = await io.read(resolve(arenaRoot, 'client/public/models/props', original + '.gltf'));
  await doc.transform(dedup(), prune());
  await io.write(new URL('lobby-' + name + '.glb', out).pathname, doc);
}
for (const [path, name, clips] of [
  [
    resolve(humanoidRoot, 'test/human_male.glb'),
    'operator-combat',
    ['Pistol_Aim_Neutral', 'Pistol_Idle_Loop', 'Pistol_Reload', 'Pistol_Shoot', 'OverhandThrow'],
  ],
  [
    resolve(adventurersRoot, 'addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb'),
    'adventurer-combat',
    [
      '1H_Ranged_Aiming',
      '1H_Ranged_Reload',
      '1H_Ranged_Shoot',
      '2H_Ranged_Aiming',
      '2H_Ranged_Reload',
      '2H_Ranged_Shoot',
      'Throw',
    ],
  ],
]) {
  const doc = await io.read(path);
  for (const animation of doc.getRoot().listAnimations())
    if (!clips.includes(animation.getName())) {
      for (const channel of animation.listChannels()) channel.dispose();
      for (const sampler of animation.listSamplers()) sampler.dispose();
      animation.dispose();
    }
  if (doc.getRoot().listAnimations().length !== clips.length)
    throw new Error('Missing authored animation in ' + path);
  for (const node of doc.getRoot().listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  await doc.transform(resample({ tolerance: 1e-5 }), dedup(), prune({ keepLeaves: true }));
  await io.write(new URL(name + '.glb', out).pathname, doc);
}
console.log(
  'Prepared four CC0 props and two authored animation libraries. See LICENSES/weapon-assets.txt.',
);

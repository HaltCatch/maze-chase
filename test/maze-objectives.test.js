import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '../src/engine/babylon.ts';
import { Assets, findNode } from '../src/client/render/assets.ts';
import { mazeObjectives } from '../src/client/render/maze-objectives.ts';
import { defineMap } from '../src/content/maps.ts';
import './support/assets.js';

test('real lever and exit meshes remain inside corridors; handle changes independently without floor rings', async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    assets = new Assets(scene);
  scene.useRightHandedSystem = true;
  try {
    for (const grid of [
      ['#####', '#...#', '#####'],
      ['###', '#.#', '#.#', '#.#', '###'],
    ]) {
      const points =
        grid.length === 3
          ? [
              { x: 1.5, z: 1.5 },
              { x: 2.5, z: 1.5 },
              { x: 3.5, z: 1.5 },
            ]
          : [
              { x: 1.5, z: 1.5 },
              { x: 1.5, z: 2.5 },
              { x: 1.5, z: 3.5 },
            ];
      const props = await mazeObjectives(
        assets,
        defineMap(grid),
        points.slice(0, 2).map((p) => ({ ...p, on: false })),
        points[2],
      );
      assert.equal(props.length, 3);
      const handle = findNode(props[0].root, 'handle');
      for (const p of props) p.set(false);
      const off = handle.rotationQuaternion.clone();
      props[0].set(true);
      assert.ok(!off.equals(handle.rotationQuaternion));
      assert.ok(off.equals(findNode(props[1].root, 'handle').rotationQuaternion));
      for (const state of [false, true]) {
        for (const [i, p] of props.entries()) {
          p.set(state);
          p.root.computeWorldMatrix(true);
          for (const mesh of p.root.getChildMeshes()) mesh.computeWorldMatrix(true);
          const b = p.root.getHierarchyBoundingVectors(true),
            at = points[i];
          assert.ok(b.min.y > -0.001, p.root.name + ' must not sink below the floor');
          assert.ok(b.max.y > (i === 2 ? 1.7 : 0.6), p.root.name + ' visible silhouette');
          assert.ok(
            b.min.x >= at.x - 0.5 &&
              b.max.x <= at.x + 0.5 &&
              b.min.z >= at.z - 0.5 &&
              b.max.z <= at.z + 0.5,
            `${p.root.name} crosses corridor walls: ${b.min}, ${b.max}`,
          );
          assert.ok(p.root.getChildMeshes().every((m) => !m.name.endsWith('-ring')));
        }
      }
    }
  } finally {
    assets.dispose();
    scene.dispose();
    engine.dispose();
  }
});

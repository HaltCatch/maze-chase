import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene, FreeCamera, Vector3 } from '../src/engine/babylon.ts';
import { Assets, normalize } from '../src/client/render/assets.ts';
import { parkourEnvironment } from '../src/client/render/parkour-environment.ts';
import { sceneryBlocksCourse } from '../src/content/scenery-clearance.ts';
import { forestLayout } from '../src/content/forest-layout.ts';
import { mapFromDocument } from '../src/content/map-document.ts';
import { ascentMap } from '../src/content/ascent-map.ts';
import './support/assets.js';
test('authored forest models clear the starting platform, return stairs and all route headroom', async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  new FreeCamera('test', new Vector3(0, 1, 0), scene);
  const assets = new Assets(scene),
    map = mapFromDocument(ascentMap());
  try {
    // Reproduce the reported tree at the stairs; include its real canopy, not just its centre.
    const tree = await assets.instance('ascent-oak', true);
    normalize(tree.root, 6.6, [0, 0.8, 0], true);
    tree.root.position.set(10, 0.3, 16);
    tree.root.computeWorldMatrix(true);
    for (const m of tree.root.getChildMeshes()) m.computeWorldMatrix(true);
    assert.equal(sceneryBlocksCourse(map, tree.root.getHierarchyBoundingVectors(true)), true);
    tree.dispose();
    await parkourEnvironment(assets, map, { addShadowCaster() {} });
    const summit = map.pickups.find((p) => p.id === 'summit-launcher');
    const gun = scene.transformNodes.find(
      (n) =>
        n.name === 'cannon-instance' &&
        Math.abs(n.position.x - summit.x) < 0.001 &&
        Math.abs(n.position.y - summit.y) < 0.001,
    );
    const trophy = scene.transformNodes.find((n) => n.name === 'ascent-trophy-instance');
    assert.ok(gun && trophy);
    for (const root of [gun, trophy]) {
      root.computeWorldMatrix(true);
      for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
    }
    const gunBounds = gun.getHierarchyBoundingVectors(true),
      trophyBounds = trophy.getHierarchyBoundingVectors(true);
    assert.ok(
      gunBounds.min.x > trophyBounds.max.x + 0.3,
      'actual launcher mesh must not overlap the trophy',
    );
    const platform = map.colliders.find((c) => c.id === 'route-58');
    assert.ok(
      gunBounds.max.x < platform.x + platform.width / 2,
      'launcher fits on enlarged summit platform',
    );
    const names = [...new Set(forestLayout(map).map((p) => p.model + '-instance'))];
    const route = { ...map, colliders: map.colliders.filter((c) => c.surface !== 'scenery') };
    const props = scene.transformNodes.filter((n) => names.includes(n.name));
    assert.ok(props.length >= 20, 'keep scenery outside the route instead of emptying the world');
    for (const p of props)
      assert.equal(
        sceneryBlocksCourse(route, p.getHierarchyBoundingVectors(true)),
        false,
        p.name + ' at ' + p.position,
      );
    assert.ok(
      scene.transformNodes.filter((n) => n.name === 'forest-stairs-instance').length >= 3,
      'stairs remain intact',
    );
  } finally {
    assets.dispose();
    scene.dispose();
    engine.dispose();
  }
});

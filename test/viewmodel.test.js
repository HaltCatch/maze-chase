import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3, Matrix, Quaternion } from '../src/engine/babylon.ts';
import { ViewModel } from '../src/client/render/viewmodel.ts';
import { weapons } from '../src/shared/arsenal.ts';
import './support/assets.js';
test('course launcher has visible shoulder carry and connected arms through recoil', async () => {
  const engine = new NullEngine({ renderWidth: 1280, renderHeight: 720, textureSize: 512 });
  const view = new ViewModel(engine);
  try {
    await view.prepare(['cannon'], true);
    for (let frame = 0; frame < 60; frame++) {
      if (frame === 15) view.launch('cannon', frame * 16);
      view.update('cannon', 1, 0, 1 / 60, frame * 16, frame * 0.2, 0.4, 0, frame > 30);
      view.render();
      const launcher = view.scene.transformNodes.find((n) => n.name === 'cannon-instance');
      assert.ok(launcher.isEnabled());
      const bounds = launcher.getHierarchyBoundingVectors(true);
      assert.ok(
        bounds.min.z < -0.7 && bounds.max.x > 0.15,
        'barrel extends forward from the right shoulder',
      );
      for (const side of ['R', 'L']) {
        const shoulder = view.scene.transformNodes.find((n) => n.name.startsWith(side + '_arm_'));
        const wrist = view.scene.transformNodes.find((n) => n.name.startsWith(side + '_wrist_'));
        shoulder.computeWorldMatrix(true);
        wrist.computeWorldMatrix(true);
        assert.ok(
          Vector3.Distance(shoulder.getAbsolutePosition(), wrist.getAbsolutePosition()) < 0.75,
        );
        assert.ok(wrist.getAbsolutePosition().asArray().every(Number.isFinite));
      }
    }
  } finally {
    view.dispose();
    engine.dispose();
  }
});
test('every first-person weapon keeps finite joints and visible geometry through aim, recoil and reload', async () => {
  const engine = new NullEngine({ renderWidth: 1280, renderHeight: 720, textureSize: 512 }),
    view = new ViewModel(engine);
  await view.prepare(Object.keys(weapons));
  try {
    assert.equal(view.camera.rotation.y, 0, 'right-handed first-person camera looks along -Z');
    let time = 1000;
    for (const name of Object.keys(weapons))
      for (const aim of [false, true])
        for (const reload of [0, 0.3, 0.7, 1]) {
          view.update(
            name,
            5,
            name === 'bow' ? 0.8 : 0,
            1 / 60,
            (time += 16),
            0,
            0,
            0,
            aim,
            reload,
          );
          view.render();
          const nodes = view.scene.transformNodes;
          for (const node of nodes) {
            assert.ok(
              node.position.asArray().every(Number.isFinite),
              name + ' ' + node.name + ' position',
            );
            if (node.rotationQuaternion)
              assert.ok(
                node.rotationQuaternion.asArray().every(Number.isFinite),
                name + ' ' + node.name + ' rotation',
              );
          }
          const weapon = nodes.find((n) => n.name === name + '-instance');
          assert.ok(weapon?.isEnabled());
          const shoulder = nodes.find((n) => n.name === 'R_arm_024');
          shoulder.computeWorldMatrix(true);
          const position = shoulder.getAbsolutePosition();
          assert.ok(
            position.length() < 1,
            name + ' shoulder must use the imported centimetre scale',
          );
          const wrist = nodes.find((n) => n.name === 'R_wrist_026');
          wrist.computeWorldMatrix(true);
          assert.ok(
            Vector3.Distance(position, wrist.getAbsolutePosition()) < 0.75,
            name + ' arm must remain connected',
          );
          const skeleton = view.scene.meshes.find((m) => m.skeleton)?.skeleton;
          assert.ok(skeleton);
          for (const bone of skeleton.bones)
            assert.ok(bone.getAbsoluteTransform().asArray().every(Number.isFinite));
        }
  } finally {
    view.dispose();
    engine.dispose();
  }
});

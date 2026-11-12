import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene, FreeCamera, Vector3 } from '../src/engine/babylon.ts';
import { Assets, findNode } from '../src/client/render/assets.ts';
import { Avatar } from '../src/client/render/avatar.ts';
import { characterDefinitions, rigs } from '../src/content/characters.ts';
import './support/assets.js';
for (const [id, spec] of Object.entries(characterDefinitions))
  test(
    id + ' Babylon skeletons, clips and third-person weapon grips stay independent and finite',
    async () => {
      const engine = new NullEngine(),
        scene = new Scene(engine);
      scene.useRightHandedSystem = true;
      new FreeCamera('test-camera', new Vector3(0, 1, -3), scene);
      const assets = new Assets(scene);
      const state = { x: 0, y: 0, z: 0, yaw: 0, character: id, motion: 'idle', weapon: 'rifle' };
      const a = await Avatar.create(assets, state),
        b = await Avatar.create(assets, { ...state, x: 3 });
      try {
        const rigsA = a.root.getChildMeshes().filter((m) => m.skeleton),
          rigsB = b.root.getChildMeshes().filter((m) => m.skeleton);
        assert.ok(rigsA.length);
        assert.notEqual(rigsA[0].skeleton, rigsB[0].skeleton);
        assert.ok(findNode(a.root, rigs[spec.rig].right));
        assert.ok(findNode(a.root, rigs[spec.rig].left));
        for (const motion of ['walk', 'run', 'jump', 'air', 'land', 'crouch', 'hide', 'idle']) {
          for (let i = 0; i < 4; i++) {
            a.update({ ...state, motion }, 1 / 60);
            b.update({ ...state, x: 3 }, 1 / 60);
            scene.render();
          }
          assert.ok(
            scene.animationGroups.some((g) => g.isPlaying),
            'authored animation must be active',
          );
          for (const bone of rigsA[0].skeleton.bones)
            assert.ok(
              bone.getAbsoluteTransform().asArray().every(Number.isFinite),
              id + ' ' + bone.name,
            );
        }
        // Rendering a crouching instance must never animate/resize the source container.
        const stair = {
          id: 'test-stairs',
          x: 0,
          y: -0.36,
          z: 0,
          width: 2.4,
          height: 1.92,
          depth: 3.6,
          ramp: 'positive-z',
          surface: 'concrete',
          climbable: false,
        };
        for (let frame = 0; frame < 8; frame++) {
          a.update({ ...state, motion: 'walk', stair }, 1 / 60);
          scene.render();
          assert.equal(a.root.rotation.x, 0);
          assert.equal(a.root.rotation.z, 0);
          for (const bone of rigsA[0].skeleton.bones)
            assert.ok(
              bone.getAbsoluteTransform().asArray().every(Number.isFinite),
              'stairs IK remains finite',
            );
        }
        const late = await Avatar.create(assets, { ...state, x: 6 });
        assert.equal(
          late.body.scaling.y,
          a.body.scaling.y,
          'repeat loads use the same rest-pose scale',
        );

        late.dispose();
        const hand = findNode(a.root, rigs[spec.rig].slot),
          grip = findNode(a.root, 'GripR');
        assert.ok(hand && grip);
        hand.computeWorldMatrix(true);
        grip.computeWorldMatrix(true);
        assert.ok(
          Vector3.Distance(hand.getAbsolutePosition(), grip.getAbsolutePosition()) < 0.06,
          'weapon must follow the real grip',
        );
        assert.equal(
          a.root.scaling.y,
          1,
          'crouch must use authored animation, not squash the character',
        );
      } finally {
        a.dispose();
        b.dispose();
        scene.dispose();
        engine.dispose();
      }
    },
  );

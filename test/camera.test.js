import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Culling/ray.js';
import { aimCamera } from '../src/client/controllers/camera-aim.ts';
test('right-handed FPS camera follows mouse direction and matches the authoritative shot ray', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new FreeCamera('player', Vector3.Zero(), scene);
  try {
    for (const yaw of [-2.8, -0.3, 0, 0.7, 2.9])
      for (const pitch of [-1.4, -0.2, 0, 0.2, 1.4]) {
        aimCamera(camera, yaw, pitch);
        camera.getViewMatrix(true);
        const forward = camera.getForwardRay().direction;
        const shot = new Vector3(
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        );
        assert.ok(Vector3.Dot(forward, shot) > 0.999999);
      }
    aimCamera(camera, -0.2, -0.2); // Positive mouse X/Y means look right/down.
    camera.getViewMatrix(true);
    assert.ok(camera.getForwardRay().direction.x > 0);
    assert.ok(camera.getForwardRay().direction.y < 0);
  } finally {
    engine.dispose();
  }
});

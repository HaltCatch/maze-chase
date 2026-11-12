import { BoneIKController, Vector3, type TransformNode } from '../../engine/babylon.ts';
import type { Collider } from '../../content/maps.ts';
import { findNode } from './assets.ts';
import { stairHeight } from '../../shared/stairs.ts';
/** Keep the author's walk cycle and use Babylon's native two-bone IK at the feet.
 * The capsule follows a smooth ramp; feet follow the visible authored stair treads. */
export class StairPose {
  private legs: { ik: BoneIKController; foot: TransformNode }[] = [];
  constructor(root: TransformNode, human: boolean) {
    const mesh = root.getChildMeshes().find((m) => m.skeleton);
    if (!mesh?.skeleton) return;
    for (const side of ['l', 'r']) {
      const bone = mesh.skeleton.bones.find(
        (b) => b.name === (human ? 'calf_' + side : 'lowerleg.' + side),
      );
      const foot = findNode(root, human ? 'foot_' + side : 'foot.' + side);
      if (bone && foot)
        this.legs.push({
          ik: new BoneIKController(mesh, bone, { maxAngle: Math.PI * 0.96, slerpAmount: 0.7 }),
          foot,
        });
    }
  }
  update(stair: Collider | undefined, yaw: number) {
    if (!stair) return;
    for (const { ik, foot } of this.legs) {
      foot.computeWorldMatrix(true);
      const position = foot.getAbsolutePosition();
      if (
        Math.abs(position.x - stair.x) > stair.width / 2 ||
        Math.abs(position.z - stair.z) > stair.depth / 2
      )
        continue;
      const base = stair.y - stair.height / 2;
      const tread =
        base +
        (Math.ceil((stairHeight(stair, position.z) - base) / (stair.height / 12)) * stair.height) /
          12;
      const delta = tread + 0.045 - position.y;
      if (delta < -0.16 || delta > 0.3) continue; // Preserve lifted/swinging feet.
      ik.targetPosition.copyFrom(position);
      ik.targetPosition.y += delta;
      ik.poleTargetPosition
        .copyFrom(position)
        .addInPlace(new Vector3(-Math.sin(yaw), 0.55, -Math.cos(yaw)));
      ik.update();
    }
  }
}

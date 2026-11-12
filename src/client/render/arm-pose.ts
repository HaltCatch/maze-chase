// Analytic two-bone pose adapted from Workmelt 4af0cfa (MIT), src/weapons/hands.js.
// The imported DJMaesen rig uses -Z bone axes and centimetres. Keep the existing
// grip/wrist adaptation; Babylon's default BoneIKController assumes a Y/X chain.
// See LICENSES/workmelt.txt and LICENSES/weapon-assets.txt.
import { Vector3, Quaternion, TransformNode } from '../../engine/babylon.ts';
import { findNode } from './assets.ts';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rotate = (v: Vector3, q: Quaternion) => v.rotateByQuaternionToRef(q, new Vector3());
function point(from: Vector3, to: Vector3, roll: Vector3) {
  const z = from.subtract(to).normalize();
  let y = roll.subtract(z.scale(Vector3.Dot(roll, z)));
  if (y.lengthSquared() < 1e-6) y = Vector3.Up().subtract(z.scale(z.y));
  y.normalize();
  return Quaternion.RotationQuaternionFromAxis(Vector3.Cross(y, z).normalize(), y, z);
}
export class ArmPose {
  private upper: TransformNode;
  private fore: TransformNode;
  private wrist: TransformNode;
  private scale: number;
  private l1: number;
  private l2: number;
  private shoulder: Vector3;
  private pole: Vector3;
  private grip: Vector3;
  private hidden = 0;
  readonly side: number;
  constructor(root: TransformNode, side: number) {
    this.side = side;
    this.upper = findNode(root, side < 0 ? 'L_arm_01' : 'R_arm_024')!;
    this.fore = findNode(root, side < 0 ? 'L_elbow_02' : 'R_elbow_025')!;
    this.wrist = findNode(root, side < 0 ? 'L_wrist_03' : 'R_wrist_026')!;
    this.upper.computeWorldMatrix(true);
    const scale = new Vector3();
    this.upper.getWorldMatrix().decompose(scale);
    this.scale = Math.abs(scale.x);
    this.l1 = this.fore.position.length() * this.scale;
    this.l2 = this.wrist.position.length() * this.scale;
    this.shoulder = new Vector3(side * 0.2, -0.355, -0.03);
    this.pole = new Vector3(side * 0.46, -0.86, 0.22).normalize();
    this.grip = side < 0 ? new Vector3(-0.027, 0.032, -0.102) : new Vector3(-0.008, 0.043, -0.106);
  }
  stow(amount: number) {
    this.hidden = amount;
  }
  solve(contact: Vector3, rotation: Quaternion, pinch = false) {
    const shoulder = this.shoulder.subtract(new Vector3(0, this.hidden, 0)),
      grip = pinch ? new Vector3(0.022, 0.047, -0.13) : this.grip;
    this.upper.position.copyFrom(shoulder.scale(1 / this.scale));
    const locate = (hand: Quaternion) => {
      const target = contact.subtract(rotate(grip, hand)),
        direction = target.subtract(shoulder),
        distance = clamp(direction.length(), 0.05, (this.l1 + this.l2) * 0.995);
      direction.normalize();
      const bend = this.pole
        .subtract(direction.scale(Vector3.Dot(this.pole, direction)))
        .normalize();
      const reach = (this.l1 * this.l1 - this.l2 * this.l2 + distance * distance) / (2 * distance);
      return {
        elbow: shoulder
          .add(direction.scale(reach))
          .add(bend.scale(Math.sqrt(Math.max(0, this.l1 * this.l1 - reach * reach)))),
        wrist: shoulder.add(direction.scale(distance)),
      };
    };
    let hand = rotation.clone(),
      chain = locate(hand);
    const forward = rotate(new Vector3(0, 0, -1), hand),
      fore = chain.wrist.subtract(chain.elbow).normalize();
    const angle = Math.acos(clamp(Vector3.Dot(forward, fore), -1, 1)),
      limit = Math.PI / 3;
    if (angle > limit) {
      const turn = Quaternion.FromUnitVectorsToRef(forward, fore, Quaternion.Identity());
      hand = Quaternion.Slerp(turn, Quaternion.Identity(), limit / angle).multiply(hand);
      chain = locate(hand);
    }
    const up = rotate(Vector3.Up(), hand),
      upper = point(shoulder, chain.elbow, up),
      lower = point(chain.elbow, chain.wrist, up);
    this.upper.rotationQuaternion = upper;
    this.fore.rotationQuaternion = upper.conjugate().multiply(lower);
    this.wrist.rotationQuaternion = lower.conjugate().multiply(hand);
  }
}

import { ArmPose } from './arm-pose.ts';
import {
  Scene,
  FreeCamera,
  Vector3,
  Quaternion,
  Matrix,
  TransformNode,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  Color3,
  type Engine,
} from '../../engine/babylon.ts';
import { Assets, normalize, findNode } from './assets.ts';
import { weaponPresentation } from '../../content/weapons.ts';
import { bowLine, arrowLength, weapons, type WeaponId } from '../../shared/arsenal.ts';

export class ViewModel {
  readonly scene: Scene;
  readonly camera: FreeCamera;
  private assets: Assets;
  private root: TransformNode;
  private props = new Map<WeaponId, Awaited<ReturnType<Assets['instance']>>>();
  private arms?: Awaited<ReturnType<Assets['instance']>>;
  private solvers: ArmPose[] = [];
  private string;
  private arrow?: Awaited<ReturnType<Assets['instance']>>;
  private raised = 0;
  private shoulderCarry = false;
  private kick = 0;
  private velocity = 0;
  private shotAt = -Infinity;
  private shot?: WeaponId;
  constructor(engine: Engine) {
    this.scene = new Scene(engine);
    this.scene.useRightHandedSystem = true;
    this.scene.autoClear = false;
    this.scene.autoClearDepthAndStencil = true;
    this.camera = new FreeCamera('weapon-camera', Vector3.Zero(), this.scene);
    this.camera.minZ = 0.025;
    this.camera.maxZ = 4;
    this.camera.fov = (68 * Math.PI) / 180;
    this.camera.rotation.set(0, 0, 0);
    this.root = new TransformNode('viewmodel', this.scene);
    this.assets = new Assets(this.scene);
    new HemisphericLight('weapon-fill', new Vector3(0, 1, 0), this.scene).intensity = 1.5;
    new DirectionalLight('weapon-key', new Vector3(-1, -2, -1), this.scene).intensity = 1.4;
    this.string = MeshBuilder.CreateLines(
      'bow-string',
      { points: [Vector3.Zero(), Vector3.Zero(), Vector3.Zero()], updatable: true },
      this.scene,
    );
    this.string.parent = this.root;
    this.string.color = new Color3(0.7, 0.7, 0.65);
    this.string.setEnabled(false);
  }
  async prepare(names: WeaponId[], shoulderCarry = false) {
    this.shoulderCarry = shoulderCarry;
    this.arms = await this.assets.instance('arms');
    this.arms.root.parent = this.root;
    this.arms.root.scaling.setAll(0.7);
    for (const mesh of this.arms.root.getChildMeshes()) mesh.alwaysSelectAsActiveMesh = true;
    this.solvers = [new ArmPose(this.arms.root, -1), new ArmPose(this.arms.root, 1)];
    for (const name of names) {
      const spec = this.presentation(name),
        prop = await this.assets.instance(name);
      normalize(prop.root, spec.size, spec.orientation);
      prop.root.position.copyFrom(Vector3.FromArray(spec.position));
      prop.root.parent = this.root;
      prop.root.setEnabled(false);
      this.props.set(name, prop);
    }
    if (names.includes('bow')) {
      this.arrow = await this.assets.instance('arrow');
      normalize(this.arrow.root, arrowLength);
      this.arrow.root.parent = this.root;
      this.arrow.root.setEnabled(false);
    }
  }
  private presentation(name: WeaponId) {
    const spec = weaponPresentation[name];
    return this.shoulderCarry && name === 'cannon'
      ? {
          ...spec,
          size: 0.85,
          position: [0.24, -0.07, -0.38],
          right: [0.25, -0.14, -0.28],
          left: [0.24, -0.085, -0.53],
        }
      : spec;
  }
  launch(name: WeaponId, now: number) {
    this.shot = name;
    this.shotAt = now;
    this.velocity +=
      ({ rifle: 2.6, pistol: 4, sniper: 7, cannon: 7.4 } as Partial<Record<WeaponId, number>>)[
        name
      ] ?? 2;
  }
  update(
    name: WeaponId,
    ammo: number,
    charge: number,
    dt: number,
    now: number,
    stride: number,
    movement: number,
    lowered: number,
    aiming: boolean,
    reload = 0,
  ) {
    const spec = this.presentation(name),
      prop = this.props.get(name);
    if (!prop) return;
    const grenade = weapons[name].projectile === 'grenade',
      age = now - this.shotAt,
      throwing = grenade && this.shot === name && age < 430;
    for (const [id, p] of this.props)
      p.root.setEnabled(id === name && (!grenade || (ammo > 0 && !throwing)));
    this.raised += (Number(aiming || age < 190) - this.raised) * (1 - Math.exp(-dt * 18));
    // Stable damped recoil; small substeps prevent a dropped frame from exploding the spring.
    for (let left = dt; left > 0;) {
      const h = Math.min(left, 1 / 240);
      this.velocity += (-2500 * this.kick - 65 * this.velocity) * h;
      this.kick += this.velocity * h;
      left -= h;
    }
    const carry = this.shoulderCarry ? (1 - this.raised) * 0.25 : 1 - this.raised,
      dip = Math.sin(Math.PI * reload);
    this.root.position.set(
      carry * (name === 'bow' ? 0.23 : 0.1) + Math.cos(stride * 0.5) * movement * 0.012,
      -carry * (name === 'bow' ? 0.17 : 0.09) -
        lowered * 0.24 +
        Math.sin(stride) * movement * 0.012,
      this.kick * 0.45 - carry * 0.1,
    );
    this.root.rotation.set(this.kick * 0.8 - dip * 0.24, -carry * 0.12, -carry * 0.2 - dip * 0.17);
    this.root.computeWorldMatrix(true);
    this.arms?.root.setEnabled(!grenade || ammo > 0 || throwing);
    const line = bowLine(charge);
    this.string.setEnabled(name === 'bow');
    if (name === 'bow') {
      MeshBuilder.CreateLines('bow-string', {
        points: [
          new Vector3(-0.091, 0.174, -0.46),
          Vector3.FromArray(line.nock),
          new Vector3(-0.091, -0.378, -0.46),
        ],
        instance: this.string,
      });
      if (this.arrow) {
        this.arrow.root.setEnabled(charge > 0 && ammo > 0);
        this.arrow.root.position.copyFrom(
          Vector3.FromArray(line.nock).add(Vector3.FromArray(line.aim).scale(arrowLength / 2)),
        );
        this.arrow.root.rotationQuaternion = Quaternion.FromLookDirectionRH(
          Vector3.FromArray(line.aim),
          Vector3.Up(),
        );
      }
    } else this.arrow?.root.setEnabled(false);
    const magazine = findNode(prop.root, 'Magazine');
    if (magazine) {
      magazine.metadata ??= {};
      if (!Number.isFinite(magazine.metadata.rest)) magazine.metadata.rest = magazine.position.y;
      magazine.position.y = magazine.metadata.rest - dip * 0.28;
    }
    this.scene.onAfterAnimationsObservable.addOnce(() => {
      for (const arm of this.solvers) {
        const hidden = arm.side < 0 && (grenade || (name === 'pistol' && dip < 0.1));
        arm.stow(hidden ? 1.35 : 0);
        const grip = findNode(prop.root, arm.side < 0 ? 'GripL' : 'GripR');
        let target = Vector3.FromArray(arm.side < 0 ? spec.left : spec.right);
        if (name === 'bow' && arm.side > 0) target = Vector3.FromArray(line.nock);
        if (grip) {
          grip.computeWorldMatrix(true);
          target = Vector3.TransformCoordinates(
            grip.getAbsolutePosition(),
            Matrix.Invert(this.root.getWorldMatrix()),
          );
        }

        if (name === 'pistol' && arm.side > 0) {
          target.x += 0.006;
          target.y -= 0.045;
          target.z -= 0.019;
        }
        if (throwing && arm.side > 0) {
          target.y += Math.sin((Math.PI * age) / 430) * 0.23;
          target.z -= Math.sin((Math.PI * age) / 430) * 0.22;
        }
        const angles = arm.side < 0 ? spec.leftAngle : spec.rightAngle;
        const wrist = Quaternion.RotationYawPitchRoll(angles[1], angles[0], angles[2]);
        arm.solve(target, wrist, name === 'bow' && arm.side > 0);
      }
    });
  }
  render() {
    this.scene.render();
  }
  dispose() {
    this.scene.dispose();
  }
}

import {
  TransformNode,
  Vector3,
  Quaternion,
  Matrix,
  AnimationGroup,
  BoneIKController,
  type AbstractMesh,
} from '../../engine/babylon.ts';
import { StairPose } from './stair-pose.ts';
import type { Collider } from '../../content/maps.ts';
import { Assets, findNode, normalize } from './assets.ts';
import { characterDefinitions, rigs, type CharacterId } from '../../content/characters.ts';
import { weaponPresentation } from '../../content/weapons.ts';
import type { WeaponId } from '../../shared/arsenal.ts';
export interface AvatarState {
  id?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  character?: string;
  monster?: boolean;
  motion: string;
  weapon?: string;
  reloading?: boolean;
  firing?: boolean;
  throwing?: boolean;
  shotSequence?: number;
  stair?: Collider;
}
export class Avatar {
  readonly root: TransformNode;
  private asset: Awaited<ReturnType<Assets['instance']>>;
  private clips = new Map<string, AnimationGroup>();
  private current?: AnimationGroup;
  private upper?: AnimationGroup;
  private gear?: Awaited<ReturnType<Assets['instance']>>;
  private weapon?: string;
  private version = 0;
  private disposed = false;
  private rig: (typeof rigs)[keyof typeof rigs];
  private body: TransformNode;
  private support?: BoneIKController;
  private hand?: TransformNode;
  private grip?: TransformNode;
  private instanceGroups: AnimationGroup[] = [];
  private assets: Assets;
  private stairPose?: StairPose;
  private lowerKey = '';
  private upperKey = '';
  private constructor(
    assets: Assets,
    asset: Awaited<ReturnType<Assets['instance']>>,
    rig: (typeof rigs)[keyof typeof rigs],
  ) {
    this.assets = assets;
    this.asset = asset;
    this.body = asset.root;
    this.rig = rig;
    this.root = new TransformNode('avatar', assets.scene);
    asset.root.parent = this.root;
  }
  static async create(assets: Assets, state: AvatarState) {
    const id = Object.hasOwn(characterDefinitions, state.character ?? '')
      ? (state.character as CharacterId)
      : 'operator';
    const spec = characterDefinitions[state.monster ? 'operator' : id],
      asset = await assets.instance(spec.model);
    for (const group of asset.instance.animationGroups) group.stop();
    for (const skeleton of asset.instance.skeletons) skeleton.returnToRest();
    const avatar = new Avatar(assets, asset, rigs[spec.rig]);
    const { scale, min, max } = normalize(
      asset.root,
      state.monster ? 1.82 : spec.height,
      [0, 0, 0],
      true,
    );
    asset.root.position.y = ((max.y - min.y) * scale) / 2;
    for (const mesh of asset.root.getChildMeshes()) {
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isPickable = false;
    }
    for (const group of asset.instance.animationGroups) {
      group.stop();
      avatar.clips.set(group.name, group);
    }
    const byName = new Map(asset.root.getDescendants(false).map((node) => [node.name, node]));
    for (const name of spec.animations) {
      const library = await assets.load(name);
      for (const source of library.animationGroups) {
        const group = source.clone(source.name, (target) => byName.get(target.name) ?? null, true);
        if (group) {
          group.stop();
          avatar.clips.set(source.name, group);
          avatar.instanceGroups.push(group);
        }
      }
    }
    avatar.stairPose = new StairPose(asset.root, spec.rig === 'human');
    avatar.hand = findNode(asset.root, avatar.rig.slot) ?? findNode(asset.root, avatar.rig.right);
    const mesh = asset.root.getChildMeshes().find((m) => m.skeleton),
      bone = mesh?.skeleton?.bones.find((b) => b.name === avatar.rig.foreLeft);
    if (mesh && bone)
      avatar.support = new BoneIKController(mesh, bone, {
        maxAngle: Math.PI * 0.92,
        slerpAmount: 1,
      });
    avatar.root.position.set(state.x, state.y, state.z);
    avatar.root.rotation.y = state.yaw + Math.PI;
    await avatar.equip(state.monster ? undefined : state.weapon);
    avatar.update(state, 1 / 60);
    return avatar;
  }
  private async equip(name?: string) {
    if (name === this.weapon) return;
    this.weapon = name;
    const revision = ++this.version;
    this.gear?.dispose();
    this.gear = undefined;
    this.grip = undefined;
    if (!name || !Object.hasOwn(weaponPresentation, name)) return;
    const spec = weaponPresentation[name as WeaponId],
      gear = await this.assets.instance(name);
    if (this.disposed || revision !== this.version) {
      gear.dispose();
      return;
    }
    normalize(gear.root, spec.size, spec.orientation);
    gear.root.parent = this.root;
    gear.root.rotation.y = Math.PI;
    this.gear = gear;
    this.grip = findNode(gear.root, 'GripR');
    if (name === 'cannon' && !this.grip) {
      // Authored bazooka has no grip markers: use its existing view-model grip
      // coordinates, converted back through normalization, for both hands.
      for (const [id, at] of [
        ['GripR', spec.right],
        ['GripL', spec.left],
      ] as const) {
        const node = new TransformNode(id, this.assets.scene);
        node.parent = gear.root;
        node.position.copyFrom(
          Vector3.FromArray(at)
            .subtract(Vector3.FromArray(spec.position))
            .divide(gear.root.scaling),
        );
      }
      this.grip = findNode(gear.root, 'GripR');
    }
  }
  update(p: AvatarState, dt: number) {
    if (this.disposed) return;
    const blend = 1 - Math.exp(-dt * 18);
    this.root.position.copyFrom(
      Vector3.Lerp(
        this.root.position,
        new Vector3(p.x, p.y, p.z),
        Vector3.DistanceSquared(this.root.position, new Vector3(p.x, p.y, p.z)) > 9 ? 1 : blend,
      ),
    );
    const target = p.yaw + Math.PI;
    this.root.rotation.y +=
      Math.atan2(Math.sin(target - this.root.rotation.y), Math.cos(target - this.root.rotation.y)) *
      blend;
    void this.equip(p.monster ? undefined : p.weapon).catch(console.error);
    const single = p.weapon === 'pistol',
      armPattern = single
        ? /upperarm[_.]?r|lowerarm[_.]?r|hand[_.]?r|wrist[_.]?r|(?:index|middle|pinky|ring|thumb).*_r/
        : /arm[_.]|hand[_.]|wrist[_.]|(?:index|middle|pinky|ring|thumb).*_[lr]/;
    const motion = p.monster
      ? p.motion === 'attack'
        ? 'Zombie_Scratch'
        : p.motion === 'walk'
          ? 'Zombie_Walk_Fwd_Loop'
          : 'Zombie_Idle_Loop'
      : (this.rig.clips[p.motion as keyof typeof this.rig.clips] ?? this.rig.clips.idle);
    const key = motion + ':' + (p.weapon ? (single ? 'single' : 'double') : 'unarmed');
    if (key !== this.lowerKey) {
      this.current?.stop();
      this.lowerKey = key;
      const original = this.clips.get(motion) ?? this.clips.get(this.rig.clips.idle);
      if (original) {
        let filtered = this.clips.get(key);
        if (!filtered) {
          filtered = new AnimationGroup(key, this.assets.scene);
          for (const a of original.targetedAnimations)
            if (!p.weapon || !armPattern.test(a.target.name))
              filtered.addTargetedAnimation(a.animation, a.target);
          this.clips.set(key, filtered);
          this.instanceGroups.push(filtered);
        }
        filtered.enableBlending = true;
        filtered.blendingSpeed = 0.12;
        filtered.start(true, 1);
        this.current = filtered;
      }
    }
    if (this.current) this.current.speedRatio = p.stair ? 0.85 : 1;
    const prefix = this.rig === rigs.kaykit ? (single ? '1H_Ranged_' : '2H_Ranged_') : '';
    const upper = p.throwing
      ? this.rig.throw
      : p.reloading
        ? prefix
          ? prefix + 'Reload'
          : this.rig.reload
        : p.firing
          ? prefix
            ? prefix + 'Shoot'
            : this.rig.fire
          : prefix
            ? prefix + 'Aiming'
            : this.rig.aim;
    const upperKey =
      (p.weapon ? upper + ':' + (single ? 'single' : 'double') : '') +
      (p.firing ? ':' + p.shotSequence : '');
    if (upperKey !== this.upperKey) {
      this.upper?.stop();
      this.upper?.dispose();
      this.upper = undefined;
      this.upperKey = upperKey;
      const source = p.weapon && this.clips.get(upper);
      if (source) {
        const group = new AnimationGroup('upper', this.assets.scene);
        for (const a of source.targetedAnimations)
          if (armPattern.test(a.target.name)) group.addTargetedAnimation(a.animation, a.target);
        group.enableBlending = true;
        group.blendingSpeed = 0.18;
        group.start(!p.firing && !p.reloading && !p.throwing);
        this.upper = group;
      }
    }
    // Run after author animations, before rendering, so the held object follows the actual hand.
    this.assets.scene.onBeforeRenderObservable.addOnce(() => {
      this.attach(p);
      this.stairPose?.update(p.stair, p.yaw);
    });
  }
  private attach(p: AvatarState) {
    if (!this.gear || !this.hand || this.disposed) return;
    this.gear.root.setEnabled(!p.throwing);
    this.root.computeWorldMatrix(true);
    this.hand.computeWorldMatrix(true);
    const inverse = Matrix.Invert(this.root.getWorldMatrix()),
      hand = Vector3.TransformCoordinates(this.hand.getAbsolutePosition(), inverse);
    this.gear.root.position.copyFrom(hand);
    this.gear.root.computeWorldMatrix(true);
    if (this.grip) {
      this.grip.computeWorldMatrix(true);
      const grip = Vector3.TransformCoordinates(this.grip.getAbsolutePosition(), inverse);
      this.gear.root.position.addInPlace(hand.subtract(grip));
    }
    const support = findNode(this.gear.root, 'GripL');
    if (this.support && support && p.weapon !== 'pistol' && !p.reloading && !p.throwing) {
      support.computeWorldMatrix(true);
      this.support.targetPosition.copyFrom(support.getAbsolutePosition());
      this.support.poleTargetPosition.copyFrom(this.root.position.add(new Vector3(-0.6, 0.8, 0)));
      this.support.update();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.version++;
    this.upper?.dispose();
    for (const g of this.instanceGroups) g.dispose();
    this.gear?.dispose();
    this.asset.dispose();
    this.root.dispose();
  }
}

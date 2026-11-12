import {
  Scene,
  Vector3,
  Quaternion,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Color3,
  Mesh,
  TransformNode,
} from '../../engine/babylon.ts';
import { Assets, normalize } from './assets.ts';
import { weaponPresentation } from '../../content/weapons.ts';
import { smokeShape, arrowLength, maxEmbeddedArrows, type WeaponId } from '../../shared/arsenal.ts';
type Position = { x: number; y: number; z: number };
export interface Effect {
  weapon: WeaponId;
  effect: string;
  point?: Position;
  from?: Position;
  direction?: number[];
  id?: number;
  depth?: number;
  impact?: string;
  own?: boolean;
}
export class Effects {
  private assets: Assets;
  private scene: Scene;
  private live = new Map<number, { root: TransformNode; dispose: () => void }>();
  private loading = new Set<number>();
  private arrows: { root: TransformNode; dispose: () => void }[] = [];
  private ephemeral: { mesh: Mesh; until: number; born: number }[] = [];
  private clouds = new Map<
    number,
    { root: TransformNode; puffs: Mesh[]; materials: StandardMaterial[]; started: number }
  >();
  private pickups = new Map<number, Awaited<ReturnType<Assets['instance']>>>();
  private pickupLoading = new Set<number>();
  private texture: Texture;
  private dead = false;
  constructor(scene: Scene, assets: Assets) {
    this.scene = scene;
    this.assets = assets;
    this.texture = new Texture('/assets/smoke-puff.webp', scene);
    this.texture.getAlphaFromRGB = true;
  }
  async effect(e: Effect, now: number) {
    if (!e.point || this.dead) return;
    if (e.effect === 'land' && e.weapon === 'bow') {
      const item = await this.assets.instance('arrow');
      if (this.dead) {
        item.dispose();
        return;
      }
      normalize(item.root, arrowLength);
      const direction = Vector3.FromArray(e.direction ?? [0, 0, -1]);
      item.root.position.copyFrom(
        new Vector3(e.point.x, e.point.y, e.point.z).add(
          direction.scale((e.depth ?? 0.04) - arrowLength / 2),
        ),
      );
      item.root.rotationQuaternion = Quaternion.FromLookDirectionRH(direction, Vector3.Up());
      this.arrows.push(item);
      if (this.arrows.length > maxEmbeddedArrows) this.arrows.shift()!.dispose();
    }
    if (e.effect === 'trace' && e.from) {
      const from = new Vector3(e.from.x, e.from.y, e.from.z),
        to = new Vector3(e.point.x, e.point.y, e.point.z),
        delta = to.subtract(from);
      // A short moving streak, not a persistent full-length laser beam.
      const start = from.add(delta.scale(0.18)),
        end = from.add(delta.scale(Math.min(1, 0.18 + 3 / Math.max(3, delta.length()))));
      const trace = MeshBuilder.CreateLines('bullet-streak', { points: [start, end] }, this.scene);
      trace.color = new Color3(1, 0.82, 0.46);
      trace.alpha = 0.75;
      this.ephemeral.push({ mesh: trace, until: now + 55, born: now });
      if (e.impact === 'surface') {
        const spark = MeshBuilder.CreateLines(
          'impact',
          { points: [to.add(new Vector3(-0.04, 0.02, 0)), to.add(new Vector3(0.04, -0.02, 0))] },
          this.scene,
        );
        spark.color = new Color3(1, 0.7, 0.35);
        this.ephemeral.push({ mesh: spark, until: now + 85, born: now });
      }
    }
    if (e.effect === 'burst') {
      const mesh = MeshBuilder.CreateSphere('burst', { diameter: 0.3, segments: 6 }, this.scene);
      mesh.position.set(e.point.x, e.point.y, e.point.z);
      const material = new StandardMaterial('burst-light', this.scene);
      material.disableLighting = true;
      material.emissiveColor = Color3.FromHexString(e.weapon === 'flash' ? '#fffceb' : '#ffc375');
      mesh.material = material;
      this.ephemeral.push({ mesh, until: now + 100, born: now });
    }
  }
  update(
    shots: {
      id: number;
      kind: WeaponId;
      vx: number;
      vy: number;
      vz: number;
      x: number;
      y: number;
      z: number;
    }[],
    dt: number,
    now: number,
    pickups: { id: number; x: number; z: number }[],
    smokes: { id: number; x: number; z: number; age: number }[],
    camera: Vector3,
  ) {
    const ids = new Set(shots.map((s) => s.id));
    for (const [id, item] of this.live)
      if (!ids.has(id)) {
        item.dispose();
        this.live.delete(id);
      }
    for (const shot of shots) {
      if (!this.live.has(shot.id) && !this.loading.has(shot.id)) {
        this.loading.add(shot.id);
        void this.assets
          .instance(shot.kind === 'bow' ? 'arrow' : shot.kind === 'cannon' ? 'frag' : shot.kind)
          .then((item) => {
            if (this.dead) {
              item.dispose();
              return;
            }
            const spec = weaponPresentation[shot.kind];
            normalize(
              item.root,
              shot.kind === 'bow' ? arrowLength : shot.kind === 'cannon' ? 0.13 : spec.size,
              shot.kind === 'bow' ? [0, 0, 0] : spec.orientation,
            );
            this.live.set(shot.id, item);
          })
          .catch(console.error)
          .finally(() => this.loading.delete(shot.id));
      }
      const item = this.live.get(shot.id);
      if (item) {
        item.root.position.set(shot.x, shot.y, shot.z);
        if (shot.kind === 'bow')
          item.root.rotationQuaternion = Quaternion.FromLookDirectionRH(
            new Vector3(shot.vx, shot.vy, shot.vz).normalize(),
            Vector3.Up(),
          );
        else item.root.rotation.x += dt * 5;
      }
    }
    this.ephemeral = this.ephemeral.filter((item) => {
      if (now >= item.until) {
        item.mesh.dispose(false, true);
        return false;
      }
      item.mesh.visibility = (item.until - now) / (item.until - item.born);
      return true;
    });
    const available = new Set(pickups.map((p) => p.id));
    for (const [id, p] of this.pickups) p.root.setEnabled(available.has(id));
    for (const p of pickups)
      if (!this.pickups.has(p.id) && !this.pickupLoading.has(p.id)) {
        this.pickupLoading.add(p.id);
        void this.assets
          .instance('ammo-box')
          .then((item) => {
            if (this.dead) {
              item.dispose();
              return;
            }
            normalize(item.root, 0.54);
            item.root.position.set(p.x, 0.2, p.z);
            this.pickups.set(p.id, item);
          })
          .catch(console.error)
          .finally(() => this.pickupLoading.delete(p.id));
      }
    const clouds = new Set(smokes.map((s) => s.id));
    for (const [id, c] of this.clouds)
      if (!clouds.has(id)) {
        c.root.dispose();
        for (const m of c.materials) m.dispose();
        this.clouds.delete(id);
      }
    let density = 0;
    for (const smoke of smokes) {
      let cloud = this.clouds.get(smoke.id);
      if (!cloud) {
        const root = new TransformNode('smoke', this.scene),
          puffs: Mesh[] = [],
          materials: StandardMaterial[] = [];
        root.position.set(smoke.x, 1, smoke.z);
        for (let i = 0; i < 18; i++) {
          const puff = MeshBuilder.CreatePlane('smoke-puff', { size: 1 }, this.scene);
          puff.billboardMode = Mesh.BILLBOARDMODE_ALL;
          puff.parent = root;
          puff.isPickable = false;
          const mat = new StandardMaterial('smoke', this.scene);
          mat.opacityTexture = this.texture;
          mat.disableLighting = true;
          mat.emissiveColor.setAll(0.62 + (i % 4) * 0.05);
          mat.backFaceCulling = false;
          mat.disableDepthWrite = true;
          puff.material = mat;
          puffs.push(puff);
          materials.push(mat);
        }
        cloud = { root, puffs, materials, started: now - smoke.age };
        this.clouds.set(smoke.id, cloud);
      }
      const shape = smokeShape(smoke.age),
        r = shape.radius;
      cloud.puffs.forEach((p, i) => {
        const theta = i * 2.399963,
          rad = 0.55 * Math.sqrt(i / 18);
        p.position.set(
          Math.cos(theta) * rad * r,
          Math.max(-0.8, (((i * 5) % 11) - 5) * 0.09 * r),
          Math.sin(theta) * rad * r,
        );
        p.scaling.set(r * 1.5, r * 1.05, 1);
        cloud!.materials[i].alpha = shape.density * 0.88;
      });
      const distance = Math.hypot(camera.x - smoke.x, (camera.y - 1) * 1.5, camera.z - smoke.z);
      density = Math.max(density, shape.density * Math.max(0, Math.min(1, (r - distance) / 1.2)));
    }
    this.scene.fogDensity = 0.012 + density * 0.8;
  }
  dispose() {
    this.dead = true;
    for (const item of this.live.values()) item.dispose();
    for (const a of this.arrows) a.dispose();
    for (const p of this.pickups.values()) p.dispose();
    for (const e of this.ephemeral) e.mesh.dispose(false, true);
    for (const c of this.clouds.values()) {
      c.root.dispose();
      for (const m of c.materials) m.dispose();
    }
    this.texture.dispose();
  }
}

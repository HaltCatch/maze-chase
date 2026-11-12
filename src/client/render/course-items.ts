import { Quaternion, Vector3, type TransformNode } from '../../engine/babylon.ts';
import type { MapDefinition } from '../../content/maps.ts';
import type { Assets } from './assets.ts';
import { normalize } from './assets.ts';
type Shot = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
/** Fixed-size projectile display pool; author models and materials remain shared. */
export async function courseItems(assets: Assets, map: MapDefinition) {
  const items = new Map<string, TransformNode>(),
    pool: TransformNode[] = [];
  await Promise.all(
    (map.pickups ?? []).map(async (p) => {
      const model = await assets.instance(
        p.kind === 'rocket'
          ? 'cannon'
          : p.kind === 'double-jump'
            ? 'ascent-spring'
            : p.kind === 'refill'
              ? 'ascent-tonic'
              : 'ascent-energy',
        true,
      );
      normalize(model.root, p.kind === 'rocket' ? 1.1 : 0.65);
      model.root.position.set(p.x, p.y, p.z);
      for (const mesh of model.root.getChildMeshes()) mesh.isPickable = false;
      items.set(p.id, model.root);
    }),
  );
  if (map.checkpoints?.length || map.pickups?.some((p) => p.kind === 'rocket'))
    for (let i = 0; i < 24; i++) {
      const model = await assets.instance('ascent-rocket', true);
      normalize(model.root, 0.6);
      for (const mesh of model.root.getChildMeshes()) mesh.isPickable = false;
      model.root.setEnabled(false);
      pool.push(model.root);
    }
  const orientation = Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2);
  let previous = '';
  return {
    update(taken: string[], shots: Shot[], time: number, extrapolation: number) {
      const key = taken.join(',');
      if (key !== previous) {
        previous = key;
        const set = new Set(taken);
        for (const [id, root] of items) root.setEnabled(!set.has(id));
      }
      for (const root of items.values()) if (root.isEnabled()) root.rotation.y = time * 0.0007;
      for (let i = 0; i < pool.length; i++) {
        const root = pool[i],
          shot = shots[i];
        root.setEnabled(!!shot);
        if (!shot) continue;
        root.position.set(
          shot.x + shot.vx * extrapolation,
          shot.y + shot.vy * extrapolation,
          shot.z + shot.vz * extrapolation,
        );
        root.rotationQuaternion = Quaternion.FromLookDirectionRH(
          new Vector3(shot.vx, shot.vy, shot.vz).normalize(),
          Vector3.Up(),
        ).multiply(orientation);
      }
    },
  };
}

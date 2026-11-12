import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import {
  Vector3,
  Color3,
  type StandardMaterial,
  type TransformNode,
} from '../../engine/babylon.ts';
import type { MapDefinition } from '../../content/maps.ts';
import { forestLayout } from '../../content/forest-layout.ts';
import { courseItems } from './course-items.ts';
import { pendulumPose } from '../../shared/obstacles.ts';
import { TransformNode as Node, Quaternion } from '../../engine/babylon.ts';
import { dressForestProp, dressForestArchitecture } from './forest-materials.ts';
import { Assets, normalize } from './assets.ts';

export async function fittedProp(
  assets: Assets,
  model: string,
  dimensions: Vector3,
  at: Vector3,
  yaw = 0,
) {
  const prop = await assets.instance(model, true);
  normalize(prop.root, 1);
  const bounds = prop.root.getHierarchyBoundingVectors(true),
    size = bounds.max.subtract(bounds.min);
  prop.root.scaling.multiplyInPlace(dimensions.divide(size));
  prop.root.rotation.y = yaw;
  prop.root.position.copyFrom(at);
  return prop.root;
}
function freeze(root: TransformNode, shadow?: ShadowGenerator) {
  root.freezeWorldMatrix();
  for (const mesh of root.getChildMeshes()) {
    mesh.isPickable = false;
    (mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh).receiveShadows = true;
    shadow?.addShadowCaster(mesh, false);
    mesh.freezeWorldMatrix();
  }
}
/** Shared authored assets; static scenery colliders live in the shared map definition. */
export async function parkourEnvironment(
  assets: Assets,
  map: MapDefinition,
  shadow: ShadowGenerator,
) {
  const jobs: Promise<unknown>[] = [];
  const itemView = await courseItems(assets, map);
  for (const p of map.colliders.filter((c) => c.model))
    jobs.push(
      fittedProp(
        assets,
        map.environment === 'forest' && p.model === 'ascent-stairs'
          ? 'forest-stairs'
          : map.environment === 'forest' && p.model === 'ascent-bridge'
            ? 'forest-bridge'
            : p.model!,
        new Vector3(p.width, p.height, p.depth),
        new Vector3(p.x, p.y, p.z),
        p.ramp === 'negative-z' ? Math.PI : 0,
      ).then((r) => {
        if (map.environment === 'forest' && p.model !== 'ascent-bounce')
          dressForestProp(r, p.model === 'ascent-bridge' ? 'wood' : 'concrete');
        freeze(r, shadow);
      }),
    );
  for (const p of forestLayout(map))
    jobs.push(
      (async () => {
        const prop = await assets.instance(p.model, true);
        normalize(prop.root, p.height, [0, 0, 0], true);
        prop.root.rotation.y = p.yaw;
        prop.root.position.set(p.x, (map.groundY ?? -3) + p.height / 2, p.z);
        if (['forest-house', 'forest-house-alt', 'forest-tower'].includes(p.model))
          dressForestArchitecture(prop.root);
        // Buildings and solid ground props anchor to the terrain with shared shadows.
        // Fine foliage does not enter the low-resolution shadow map.
        freeze(
          prop.root,
          p.solid && !['forest-pine', 'forest-fir'].includes(p.model) ? shadow : undefined,
        );
      })(),
    );
  const swings = new Map<
    string,
    { root: TransformNode; rod: TransformNode; ball: TransformNode }
  >();
  for (const p of map.obstacles ?? [])
    jobs.push(
      (async () => {
        const root = new Node(p.id, assets.scene);
        root.position.set(p.x, p.y, p.z);
        const ball = await fittedProp(
          assets,
          'ascent-pendulum',
          new Vector3(p.radius * 2, p.radius * 2, p.radius * 2),
          new Vector3(0, -p.length, 0),
        );
        const rod = await fittedProp(
          assets,
          'ascent-pole',
          new Vector3(0.075, p.length, 0.075),
          new Vector3(0, -p.length / 2, 0),
        );
        ball.parent = root;
        rod.parent = root;
        for (const part of [...ball.getChildMeshes(), ...rod.getChildMeshes()]) {
          part.isPickable = false;
          shadow.addShadowCaster(part, false);
        }
        // Fixed author-model support mast; above the walking capsule, not a hidden obstacle.
        const mast = await fittedProp(
          assets,
          'ascent-pole',
          new Vector3(0.12, 0.12, 5),
          new Vector3(p.x, p.y, p.z),
        );
        freeze(mast);
        swings.set(p.id, { root, rod, ball });
      })(),
    );
  for (const c of map.colliders.filter((c) => c.model === 'ascent-bridge')) {
    // Rope-fence artwork frames the narrow crossing; no invisible rails prevent falls.
    for (const side of [-1, 1])
      jobs.push(
        fittedProp(
          assets,
          'ascent-rope',
          new Vector3(c.depth, 0.7, 0.08),
          new Vector3(c.x + side * 0.62, c.y + c.height / 2 + 0.35, c.z),
          Math.PI / 2,
        ).then((r) => freeze(r)),
      );
  }
  if (map.environment === 'forest')
    for (const [i, p] of (map.checkpoints ?? []).entries()) {
      if (i % 2 === 0)
        jobs.push(
          fittedProp(
            assets,
            'ascent-balloons',
            new Vector3(1.5, 3.4, 1.5),
            new Vector3(p.x + 2.9, p.y + 2.5, p.z),
          ).then((r) => freeze(r)),
        );
    }
  let trophy: TransformNode | undefined;
  const trophyGlow: Color3[] = [];
  const finish = map.checkpoints?.at(-1);
  if (finish)
    jobs.push(
      (async () => {
        trophy = await fittedProp(
          assets,
          'ascent-trophy',
          new Vector3(0.95, 1.2, 0.65),
          new Vector3(finish.x, finish.y + 1.5, finish.z),
        );
        for (const mesh of trophy.getChildMeshes()) {
          mesh.isPickable = false;
          const material = mesh.material as StandardMaterial | null;
          if (material?.emissiveColor) trophyGlow.push(material.emissiveColor);
        }
      })(),
    );
  const coins = new Map<string, TransformNode>();
  for (const p of map.collectibles ?? [])
    jobs.push(
      (async () => {
        const coin = await assets.instance('ascent-coin', true);
        normalize(coin.root, 0.42);
        coin.root.position.set(p.x, p.y, p.z);
        for (const mesh of coin.root.getChildMeshes()) mesh.isPickable = false;
        coins.set(p.id, coin.root);
      })(),
    );
  await Promise.all(jobs);
  let collectedKey = '',
    lastElapsed = -1,
    sampledAt = 0;
  return {
    update(
      collected: string[],
      now: number,
      elapsed: number,
      taken: string[] = [],
      shots: Parameters<typeof itemView.update>[1] = [],
      finished = false,
    ) {
      if (elapsed !== lastElapsed) {
        lastElapsed = elapsed;
        sampledAt = now;
      }
      const extrapolation = Math.min(0.15, (now - sampledAt) / 1000);
      const time = elapsed + extrapolation;
      itemView.update(taken, shots, now, extrapolation);
      for (const p of map.obstacles ?? []) {
        const swing = swings.get(p.id);
        if (!swing) continue;
        const pose = pendulumPose(p, time);
        swing.root.rotationQuaternion = Quaternion.RotationAxis(
          p.axis === 'x' ? new Vector3(0, 0, 1) : new Vector3(-1, 0, 0),
          pose.angle,
        );
      }
      const key = collected.join(',');
      if (key !== collectedKey) {
        const taken = new Set(collected);
        for (const [id, root] of coins) root.setEnabled(!taken.has(id));
        collectedKey = key;
      }
      if (trophy && finish) {
        trophy.setEnabled(!finished);
        trophy.position.y = finish.y + 1.5 + Math.sin(now * 0.0018) * 0.12;
        trophy.rotation.y = now * 0.00065;
        const pulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(now * 0.003));
        for (const color of trophyGlow) color.set(pulse, pulse * 0.68, pulse * 0.12);
      }
      for (const root of coins.values()) if (root.isEnabled()) root.rotation.y = now * 0.0015;
    },
  };
}

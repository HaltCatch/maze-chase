import { Color3, Quaternion, Vector3, type TransformNode } from '../../engine/babylon.ts';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { MapDefinition, Point } from '../../content/maps.ts';
import { normalize, type Assets, findNode } from './assets.ts';

type Switch = Pick<Point, 'x' | 'z'> & { on: boolean };
/** Authored Kenney props; each objective owns its tint, while geometry/textures are shared. */
export async function mazeObjectives(
  assets: Assets,
  map: MapDefinition,
  switches: Switch[],
  exit?: Pick<Point, 'x' | 'z'>,
) {
  const props: { root: TransformNode; set: (on: boolean) => void }[] = [];
  for (const [i, point] of [...switches, ...(exit ? [exit] : [])].entries()) {
    const gate = i === switches.length;
    const model = await assets.instance(gate ? 'maze-exit' : 'maze-lever');
    const root = model.root;
    normalize(root, gate ? 1.8 : 0.48, [0, 0, 0], gate);
    // Fit a one-metre maze corridor, keeping the tall silhouette above floor level.
    if (gate) root.scaling.x *= 0.81;
    else root.scaling.y *= 1.8;
    const walls = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    const wall = walls.find(
      ([x, z]) => map.grid[Math.floor(point.z) + z]?.[Math.floor(point.x) + x] === '#',
    ) ?? [0, 1];
    root.rotation.y = Math.atan2(wall[0], wall[1]);
    root.position.set(
      point.x + (gate ? 0 : wall[0] * 0.22),
      0,
      point.z + (gate ? 0 : wall[1] * 0.22),
    );
    root.computeWorldMatrix(true);
    for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
    root.position.y -= root.getHierarchyBoundingVectors(true).min.y;
    const materials = new Set<PBRMaterial>();
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      if (mesh.material) {
        mesh.material = mesh.material.clone('objective-' + i + '-' + mesh.material.name);
        if (mesh.material) materials.add(mesh.material as PBRMaterial);
      }
    }
    const handle = gate ? undefined : findNode(root, 'handle');
    const rest = handle?.rotationQuaternion?.clone() ?? Quaternion.Identity();
    let previous: boolean | undefined;
    props.push({
      root,
      set(on) {
        if (on === previous) return;
        previous = on;
        const color = Color3.FromHexString(on ? '#64d8ad' : '#ffad55').scale(on ? 0.4 : 0.22);
        for (const material of materials) material.emissiveColor?.copyFrom(color);
        if (handle)
          handle.rotationQuaternion = rest.multiply(
            Quaternion.RotationAxis(Vector3.Right(), on ? -0.6 : 0.5),
          );
      },
    });
  }
  return props;
}

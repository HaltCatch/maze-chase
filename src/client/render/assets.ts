import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import '@babylonjs/loaders/glTF/glTFFileLoader.js';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_clearcoat.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform.js';
import { TransformNode, Vector3, Quaternion, type Scene } from '../../engine/babylon.ts';

/** CPU source cache is bounded; parsed/GPU assets are owned by one scene and disposed with it. */
const buffers = new Map<string, Uint8Array>();
let bytes = 0;
const pending = new Map<string, Promise<Uint8Array>>();
export async function fetchModel(name: string): Promise<Uint8Array> {
  const hit = buffers.get(name);
  if (hit) {
    buffers.delete(name);
    buffers.set(name, hit);
    return hit;
  }
  if (pending.has(name)) return pending.get(name)!;
  const task = fetch('/assets/' + name + '.glb')
    .then(async (response) => {
      if (!response.ok) throw new Error('模型加载失败: ' + name);
      const data = new Uint8Array(await response.arrayBuffer());
      buffers.set(name, data);
      bytes += data.byteLength;
      while (bytes > 24 * 1024 * 1024 && buffers.size > 1) {
        const key = buffers.keys().next().value!;
        bytes -= buffers.get(key)!.byteLength;
        buffers.delete(key);
      }
      return data;
    })
    .finally(() => pending.delete(name));
  pending.set(name, task);
  return task;
}
export class Assets {
  private loaded = new Map<string, Promise<AssetContainer>>();
  private parsing = Promise.resolve();
  private disposed = false;
  readonly scene: Scene;
  constructor(scene: Scene) {
    this.scene = scene;
    scene.onDisposeObservable.add(() => this.dispose());
  }
  load(name: string) {
    if (!this.loaded.has(name)) {
      const task = fetchModel(name)
        .then((data) => {
          const task = this.parsing.then(async () => {
            if (this.disposed) throw new Error('Scene disposed');
            const asset = await LoadAssetContainerAsync(data, this.scene, {
              pluginExtension: '.glb',
              pluginOptions: { gltf: { animationStartMode: 0 } },
            });
            if (this.disposed) {
              asset.dispose();
              throw new Error('Scene disposed');
            }
            return asset;
          });
          this.parsing = task.then(
            () => {},
            () => {},
          );
          return task;
        })
        .catch((error) => {
          this.loaded.delete(name);
          throw error;
        });
      this.loaded.set(name, task);
    }
    return this.loaded.get(name)!;
  }
  async instance(name: string, instanced = false) {
    const asset = await this.load(name);
    if (this.disposed) throw new Error('Scene disposed');
    const instance = asset.instantiateModelsToScene((n) => n, false, {
      doNotInstantiate: !instanced,
    });
    const root = new TransformNode(name + '-instance', this.scene);
    for (const node of instance.rootNodes) node.parent = root;
    return {
      root,
      instance,
      asset,
      dispose: () => {
        instance.dispose();
        root.dispose();
      },
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.loaded.values())
      void p.then(
        (a) => a.dispose(),
        () => {},
      );
    this.loaded.clear();
  }
}
export function normalize(
  root: TransformNode,
  size: number,
  rotation: readonly number[] = [0, 0, 0],
  heightOnly = false,
) {
  const pose = new TransformNode('asset-pose', root.getScene());
  for (const child of root.getChildren()) child.parent = pose;
  pose.parent = root;
  pose.rotationQuaternion = Quaternion.RotationYawPitchRoll(rotation[1], rotation[0], rotation[2]);
  root.computeWorldMatrix(true);
  pose.computeWorldMatrix(true);
  const { min, max } = pose.getHierarchyBoundingVectors(true),
    extent = max.subtract(min),
    center = min.add(max).scale(0.5);
  const scale = size / (heightOnly ? extent.y : Math.max(extent.x, extent.y, extent.z));
  pose.position.copyFrom(center.scale(-1));
  root.scaling.setAll(scale);
  return { scale, min, max, pose };
}
export function findNode(root: TransformNode, name: string) {
  return root.getDescendants(false).find((n) => n.name === name) as TransformNode | undefined;
}

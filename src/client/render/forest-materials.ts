import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Color3, Texture, type Scene, type TransformNode } from '../../engine/babylon.ts';

const libraries = new WeakMap<Scene, ReturnType<typeof createLibrary>>();
/** Native metallic/roughness PBR with packed AO, mipmaps and bounded anisotropy.
 * Shared per scene; no shaders, per-object textures or screen-space effects. */
function createLibrary(scene: Scene) {
  const materials = new Map<string, PBRMaterial>();
  function texture(file: string, linear: boolean, repeat: number) {
    const tex = new Texture(
      '/assets/' + file + '.webp',
      scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    tex.gammaSpace = !linear;
    tex.uScale = tex.vScale = repeat;
    tex.anisotropicFilteringLevel = 4;
    return tex;
  }
  return (surface: string, repeat = 1) => {
    const key = surface + ':' + repeat;
    if (materials.has(key)) return materials.get(key)!;
    const mat = new PBRMaterial('forest-' + key, scene);
    mat.metallic = 0;
    mat.roughness = 0.92;
    mat.enableSpecularAntiAliasing = true;
    const prefix =
      surface === 'wood'
        ? 'forest-wood'
        : surface === 'floor' || surface === 'olive'
          ? 'forest-soil'
          : undefined;
    if (prefix) {
      mat.albedoTexture = texture(prefix + '-albedo', false, repeat);
      mat.bumpTexture = texture(prefix + '-normal', true, repeat);
      mat.metallicTexture = texture(prefix + '-arm', true, repeat);
      mat.useRoughnessFromMetallicTextureAlpha = false;
      mat.useRoughnessFromMetallicTextureGreen = true;
      mat.useMetallnessFromMetallicTextureBlue = true;
      mat.useAmbientOcclusionFromMetallicTextureRed = true;
    } else {
      const stone = surface === 'brick' ? 'brick' : 'stone';
      mat.albedoTexture = texture(stone, false, repeat);
      mat.bumpTexture = texture(stone + '-normal', true, repeat);
    }
    mat.bumpTexture.level = 0.45;
    mat.albedoColor = Color3.White();
    materials.set(key, mat);
    return mat;
  };
}
export function forestMaterial(scene: Scene, surface: string, repeat = 1) {
  if (!libraries.has(scene)) libraries.set(scene, createLibrary(scene));
  return libraries.get(scene)!(surface, repeat);
}
export function dressForestProp(root: TransformNode, surface: string) {
  const material = forestMaterial(root.getScene(), surface);
  for (const part of root.getChildMeshes())
    (part instanceof InstancedMesh ? part.sourceMesh : part).material = material;
}

const architectureNormals = new WeakMap<Scene, Texture>();
export function dressForestArchitecture(root: TransformNode) {
  const scene = root.getScene();
  let normal = architectureNormals.get(scene);
  if (!normal) {
    normal = (forestMaterial(scene, 'concrete').bumpTexture as Texture).clone();
    normal.coordinatesIndex = 1;
    normal.level = 0.25;
    architectureNormals.set(scene, normal);
  }
  for (const part of root.getChildMeshes()) {
    const mesh = part instanceof InstancedMesh ? part.sourceMesh : part;
    if (!(mesh.material instanceof PBRMaterial)) continue;
    mesh.material.bumpTexture = normal;
    mesh.material.metallic = 0;
    mesh.material.roughness = 0.95;
    mesh.material.albedoColor.set(0.8, 0.75, 0.65);
    mesh.material.enableSpecularAntiAliasing = true;
  }
}

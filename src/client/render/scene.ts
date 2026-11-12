import { forestMaterial, dressForestProp } from './forest-materials.ts';
import { PhotoDome } from '@babylonjs/core/Helpers/photoDome.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import {
  Scene,
  Color3,
  Color4,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Texture,
  HemisphericLight,
  DirectionalLight,
  TransformNode,
  type Engine,
  type Mesh,
} from '../../engine/babylon.ts';
import type { MapDefinition } from '../../content/maps.ts';
import { Assets, normalize } from './assets.ts';
import { applyRamp } from './collider-mesh.ts';
import { fittedProp, parkourEnvironment } from './parkour-environment.ts';

export function createScene(engine: Engine, definition: MapDefinition, blackout = false) {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.skipPointerMovePicking = true;
  const forest = definition.environment === 'forest';
  scene.clearColor = Color4.FromHexString(blackout ? '#101822ff' : '#899da6ff');
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = Color3.FromHexString(blackout ? '#101822' : '#899da6');
  scene.fogDensity = definition.environment === 'forest' ? 0.006 : 0.012;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.exposure = forest ? 1 : 1.2;
  if (!blackout) {
    const sky = new PhotoDome(
      'sky',
      '/assets/sky.webp',
      { resolution: 24, size: 150, useDirectMapping: true },
      scene,
    );
    sky.mesh.parent = null; // Infinite-distance meshes must be unparented to follow the camera.
    sky.mesh.infiniteDistance = true;
    sky.mesh.isPickable = false;
    sky.mesh.applyFog = false;
  }
  const fill = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  fill.intensity = blackout ? 0.13 : forest ? 0.55 : 0.95;
  fill.groundColor = Color3.FromHexString('#41443d');
  const sun = new DirectionalLight('sun', new Vector3(-0.6, -1, -0.3), scene);
  sun.intensity = blackout ? 0.04 : 1.4;
  sun.diffuse = Color3.FromHexString('#ffe4c8');
  sun.position.set(definition.size * 0.8, definition.size, definition.size * 0.7);
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = definition.size * 3;
  sun.shadowFrustumSize = definition.size * 1.65;
  const shadow = new ShadowGenerator(1024, sun);
  shadow.usePercentageCloserFiltering = true;
  shadow.filteringQuality = ShadowGenerator.QUALITY_LOW;
  shadow.bias = 0.0004;
  shadow.normalBias = 0.025;
  shadow.getShadowMap()!.refreshRate = forest ? 1 : 2;
  const assets = new Assets(scene),
    materials = new Map<string, StandardMaterial>();
  function material(surface: string) {
    if (materials.has(surface)) return materials.get(surface)!;
    const mat = new StandardMaterial(surface, scene);
    mat.specularColor.setAll(0.08);
    const file =
      surface === 'brick'
        ? 'brick'
        : surface === 'floor'
          ? definition.environment === 'forest'
            ? 'forest-floor'
            : definition.climbable
              ? 'stone'
              : 'harbor-asphalt'
          : surface === 'concrete' || surface === 'depot'
            ? 'harbor-concrete'
            : 'harbor-steel';
    mat.diffuseTexture = new Texture('/assets/' + file + '.webp', scene);
    mat.diffuseTexture.wrapU = mat.diffuseTexture.wrapV = Texture.WRAP_ADDRESSMODE;
    if (file === 'brick' || file === 'stone') {
      mat.bumpTexture = new Texture('/assets/' + file + '-normal.webp', scene);
      mat.bumpTexture.level = 0.55;
    }
    mat.diffuseColor = Color3.FromHexString(
      (
        { oxide: '#b87659', olive: '#8c936c', steel: '#90a8b0', wagon: '#789787' } as Record<
          string,
          string
        >
      )[surface] ?? '#d5d3c9',
    );
    materials.set(surface, mat);
    return mat;
  }
  const floor = MeshBuilder.CreateGround(
    'ground',
    { width: definition.size, height: definition.size },
    scene,
  );
  floor.position.set(
    definition.size / 2,
    definition.groundY ??
      (definition.environment === 'forest' ? -3 : definition.ground === false ? -9 : 0),
    definition.size / 2,
  );
  floor.material = forest ? forestMaterial(scene, 'floor', definition.size / 5) : material('floor');
  floor.receiveShadows = true;
  if (!forest) {
    const tex = materials.get('floor')!.diffuseTexture as Texture;
    tex.uScale = tex.vScale = definition.size / 3;
    const normal = materials.get('floor')!.bumpTexture as Texture | undefined;
    if (normal) normal.uScale = normal.vScale = definition.size / 3;
  }
  // Mesh instances share geometry and material. Collider boxes are the rendering source of truth.
  const templates = new Map<string, Mesh>(),
    propLoads: Promise<void>[] = [];
  for (const c of definition.colliders) {
    if (c.model || c.surface === 'scenery') continue;
    const key = [c.surface, c.width, c.height, c.depth, c.ramp].join(':');
    let template = templates.get(key);
    let mesh;
    if (!template) {
      const uv = (w: number, h: number) => new Vector4(0, 0, w / 2, h / 2);
      template = MeshBuilder.CreateBox(
        c.id,
        {
          wrap: true, // Keep U horizontal on both X- and Z-facing wall faces.
          width: c.width,
          height: c.height,
          depth: c.depth,
          faceUV: [
            uv(c.width, c.height),
            uv(c.width, c.height),
            uv(c.depth, c.height),
            uv(c.depth, c.height),
            uv(c.width, c.depth),
            uv(c.width, c.depth),
          ],
        },
        scene,
      );
      if (c.ramp) applyRamp(template, c);
      template.material = forest ? forestMaterial(scene, c.surface) : material(c.surface);
      templates.set(key, template);
      mesh = template;
    } else mesh = template.createInstance(c.id);
    mesh.position.set(c.x, c.y, c.z);
    mesh.freezeWorldMatrix();
    (mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh).receiveShadows = true;
    shadow.addShadowCaster(mesh, false);
    if (definition.environment === 'forest' && ['olive', 'wood'].includes(c.surface)) {
      const block = mesh;
      propLoads.push(
        fittedProp(
          assets,
          c.surface === 'wood' ? 'forest-pallet' : 'forest-platform',
          new Vector3(c.width, c.height, c.depth),
          new Vector3(c.x, c.y, c.z),
        ).then((root) => {
          dressForestProp(root, c.surface === 'wood' ? 'wood' : 'concrete');
          for (const part of root.getChildMeshes()) {
            shadow.addShadowCaster(part, false);
            part.freezeWorldMatrix();
          }
          block.setEnabled(false);
        }),
      );
    }
    if (c.id.startsWith('block-') && ['steel', 'oxide', 'olive', 'wagon'].includes(c.surface)) {
      const block = mesh;
      propLoads.push(
        (async () => {
          const prop = await assets.instance('lobby-container', true);
          // Fit the authored container to the same solid volume used by Havok and hits.
          normalize(prop.root, 1, [0, c.width > c.depth ? Math.PI / 2 : 0, 0]);
          const bounds = prop.root.getHierarchyBoundingVectors(true),
            size = bounds.max.subtract(bounds.min);
          prop.root.scaling.multiplyInPlace(
            new Vector3(c.width / size.x, c.height / size.y, c.depth / size.z),
          );
          prop.root.position.set(c.x, c.y, c.z);
          for (const part of prop.root.getChildMeshes()) {
            (part instanceof InstancedMesh ? part.sourceMesh : part).receiveShadows = true;
            shadow.addShadowCaster(part, false);
            part.freezeWorldMatrix();
          }
          block.setEnabled(false);
        })(),
      );
    }
  }
  let environment: Awaited<ReturnType<typeof parkourEnvironment>> | undefined;
  const ready = Promise.all([
    ...propLoads,
    parkourEnvironment(assets, definition, shadow).then((value) => {
      environment = value;
    }),
  ]).then(() => undefined);
  const objectives = new Map<string, TransformNode>();
  function marker(id: string, x: number, z: number, color: string) {
    let root = objectives.get(id);
    if (!root) {
      root = new TransformNode(id, scene);
      const ring = MeshBuilder.CreateTorus(
        id + '-ring',
        { diameter: 0.65, thickness: 0.055, tessellation: 24 },
        scene,
      );
      ring.parent = root;
      const mat = new StandardMaterial(id + '-glow', scene);
      mat.emissiveColor = Color3.FromHexString(color);
      mat.disableLighting = true;
      ring.material = mat;
      objectives.set(id, root);
    }
    root.position.set(x, 0.06, z);
    root.setEnabled(true);
    return root;
  }
  return {
    scene,
    assets,
    marker,
    objectives,
    ready,
    shadow,
    updateParkour: (...args: Parameters<NonNullable<typeof environment>['update']>) =>
      environment?.update(...args),
    dispose: () => scene.dispose(),
  };
}

import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { Mesh } from '../../engine/babylon.ts';
import type { Collider } from '../../content/maps.ts';
import { rampGeometry } from '../../content/collider-geometry.ts';
export function applyRamp(mesh: Mesh, c: Collider) {
  const { positions, indices } = rampGeometry(c),
    data = new VertexData(),
    normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = Array.from({ length: positions.length / 3 }, (_, i) => [
    positions[i * 3] / 2,
    positions[i * 3 + 2] / 2,
  ]).flat();
  data.applyToMesh(mesh);
}

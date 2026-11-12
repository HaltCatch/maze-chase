"""Offline adaptation of CC0 Poly Haven scans and existing CC0 Kenney meshes.
Run with Blender: blender -b --factory-startup --python scripts/prepare-forest-assets.py -- UPSTREAM_DIR
Input downloads/checksums and author credits are documented in docs/forest-art.md.
No geometry is generated: retain authored meshes, decimate scans, re-UV existing structures.
"""
import bpy
import sys
from pathlib import Path

source = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
root = Path(__file__).resolve().parents[1]
out = root / 'public/assets/models'


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def save(name):
    bpy.ops.export_scene.gltf(filepath=str(out / (name + '.glb')), export_format='GLB',
                              use_selection=False, export_image_format='WEBP',
                              export_image_quality=85, export_animations=False,
                              export_extras=False, export_cameras=False, export_lights=False)


for name, node, target, result in [
    ('pine_sapling_small', 'pine_sapling_small_b', 20000, 'forest-pine'),
    ('fir_sapling_medium', 'fir_sapling_medium_b_LOD0', 48000, 'forest-fir'),
    ('rock_moss_set_01', 'rock_moss_set_01_rock03', 1600, 'forest-rock'),
    ('tree_stump_01', 'tree_stump_01', 2000, 'forest-stump'),
    ('fern_02', 'fern_02_a', 784, 'forest-fern'),
]:
    reset()
    bpy.ops.import_scene.gltf(filepath=str(source / name / 'prepared.gltf'))
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or obj.name != node:
            bpy.data.objects.remove(obj, do_unlink=True)
    obj = bpy.data.objects[node]
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    # Original sets arrange their variants beside each other; keep one at its own origin.
    obj.location = (0, 0, 0)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > target:
        modifier = obj.modifiers.new('Browser LOD', 'DECIMATE')
        modifier.ratio = target / tris
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for material in obj.data.materials:
        if not material: continue
        material.use_backface_culling = name not in ('pine_sapling_small', 'fir_sapling_medium', 'fern_02')
    for img in bpy.data.images:
        if img.size[0] > 512: img.scale(512, 512)
    save(result)
    print('PREPARED', result, sum(len(p.vertices) - 2 for p in obj.data.polygons), flush=True)

# Reuse the exact authored stair, bridge, pallet and platform geometry. Reproject UVs
# for tiled photographic surfaces instead of sampling a flat-color palette texel.
for original, result, surface in [
    ('ascent-stairs', 'forest-stairs', 'stone'),
    ('ascent-bridge', 'forest-bridge', 'wood'),
    ('lobby-pallet', 'forest-pallet', 'wood'),
    ('ascent-platform', 'forest-platform', 'stone'),
]:
    reset()
    bpy.ops.import_scene.gltf(filepath=str(out / (original + '.glb')))
    mat = bpy.data.materials.new('Forest ' + surface)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.6, 0.6, 0.6, 1)
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Roughness'].default_value = 0.9
    for obj in bpy.data.objects:
        if obj.type != 'MESH': continue
        mesh = obj.data
        uv = mesh.uv_layers.active or mesh.uv_layers.new()
        for polygon in mesh.polygons:
            axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
            axes = [i for i in range(3) if i != axis]
            for loop in polygon.loop_indices:
                pos = mesh.vertices[mesh.loops[loop].vertex_index].co
                uv.data[loop].uv = (pos[axes[0]], pos[axes[1]])
            polygon.material_index = 0
        mesh.materials.clear()
        mesh.materials.append(mat)
    save(result)

# Keep architecture palette/geometry and add a second UV set for real surface detail.
for original in ['house', 'house-alt', 'tower']:
    reset()
    bpy.ops.import_scene.gltf(filepath=str(out / ('ascent-' + original + '.glb')))
    for obj in bpy.data.objects:
        if obj.type != 'MESH': continue
        mesh = obj.data
        uv = mesh.uv_layers.new(name='SurfaceDetail')
        for polygon in mesh.polygons:
            axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
            axes = [i for i in range(3) if i != axis]
            for loop in polygon.loop_indices:
                pos = mesh.vertices[mesh.loops[loop].vertex_index].co
                uv.data[loop].uv = (pos[axes[0]] * 4, pos[axes[1]] * 4)
    save('forest-' + original)

"""Offline-only source preparation: python3 scripts/fetch-forest-assets.py CACHE_DIR.
Requires Pillow. Downloads pinned CC0 source assets; never used by CI or runtime.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
cache = Path(sys.argv[1]).resolve()
sources = json.loads((root / 'scripts/forest-sources.json').read_text())
for name, source in sources.items():
    folder = cache / name
    for relative, entry in source['files'].items():
        path = folder / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            subprocess.run(['curl', '-fLsS', '--retry', '2', '-A', 'Haven-Maze-Chase/1.0',
                            entry['url'], '-o', str(path)], check=True)
        if hashlib.md5(path.read_bytes()).hexdigest() != entry['md5']:
            raise ValueError('Source checksum mismatch: ' + str(path))
    if (folder / 'source.gltf').exists():
        document = json.loads((folder / 'source.gltf').read_text())
        if 'alphaImageMatch' in source:
            image = next(i for i in document['images']
                         if source['alphaImageMatch'] in i['name'])
            diffuse = Image.open(folder / image['uri']).convert('RGBA')
            diffuse.putalpha(Image.open(folder / 'alpha.png').convert('L'))
            diffuse.save(folder / 'leaves.png')
            image.update(uri='leaves.png', mimeType='image/png')
            # Alpha-blended twig cards sort poorly across instances. Use native
            # depth-writing cutout foliage and preserve the authored mask.
            for material in document['materials']:
                if material.get('alphaMode') in ('MASK', 'BLEND'):
                    material.update(alphaMode='MASK', alphaCutoff=0.35)
        (folder / 'prepared.gltf').write_text(json.dumps(document))
    else:
        prefix = 'forest-soil' if name == 'forest_ground_04' else 'forest-wood'
        for channel, output in [('Diffuse', 'albedo'), ('nor_gl', 'normal'), ('arm', 'arm')]:
            Image.open(folder / (channel + '.jpg')).resize((1024, 1024)).save(
                root / 'public/assets/textures' / (prefix + '-' + output + '.webp'),
                quality=88, method=6)
    print('Verified', name)

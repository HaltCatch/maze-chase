import {
  Engine,
  Scene,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  HemisphericLight,
  ArcRotateCamera,
  type Mesh,
} from '../../engine/babylon.ts';
import { applyRamp } from '../render/collider-mesh.ts';
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';
import { mapDocumentSchema, parkourMaps, type MapDocument } from '../../content/map-document.ts';

/** Official Babylon gizmos operate on ordinary meshes; documents contain data, never executable scripts. */
export function openMapEditor(
  initial: unknown,
  onPlay: (map: MapDocument) => void,
  onClose: () => void = () => {},
) {
  const parsed = mapDocumentSchema.safeParse(initial);
  let documentValue = structuredClone(parsed.success ? parsed.data : parkourMaps.ascent!);
  const overlay = document.createElement('section');
  overlay.id = 'map-editor';
  overlay.setAttribute('aria-label', '跳跃地图编辑器');
  overlay.innerHTML = `<header><div><small>WORKSHOP / BABYLON GIZMOS</small><h2>地图工坊</h2></div><button data-action="close">关闭工坊</button></header>
    <div class="editor-workspace"><canvas aria-label="三维地图，拖动轴线移动或缩放"></canvas><aside>
    <label>内置模板<select data-field="template"><option value="">选择模板（替换当前草稿）</option>${Object.values(
      parkourMaps,
    )
      .map((m) => `<option value="${m.id}">${m.name}</option>`)
      .join(
        '',
      )}</select></label><label>平台<select data-field="selection"></select></label><div class="editor-actions"><button data-action="move">移动</button><button data-action="scale">缩放</button></div>
    <label>X 位置<input data-field="x" type="number" step="0.25" min="0" max="64"></label><label>平台顶高<input data-field="y" type="number" step="0.25" min="0" max="64"></label><label>Z 位置<input data-field="z" type="number" step="0.25" min="0" max="64"></label>
    <label>宽度<input data-field="width" type="number" step="0.25" min="0.25" max="32"></label><label>深度<input data-field="depth" type="number" step="0.25" min="0.25" max="32"></label>
    <div class="editor-actions"><button data-action="add">复制平台</button><button data-action="delete">删除平台</button><button data-action="spawn">设为出生点</button><button data-action="checkpoint">追加路线点</button><button data-action="clear">清空路线点</button><button data-action="undo">撤销</button></div>
    <p data-field="route"></p><p class="editor-help">拖动轴线调整位置；滚轮缩放，拖动空白处旋转。路线点按添加顺序通过。路线点只验证经过顺序，不保存进度；坠落从起点重新挑战。</p>
    <div class="editor-actions"><button data-action="save">保存草稿</button><button data-action="export">导出 JSON</button><label class="editor-import">导入 JSON<input type="file" accept="application/json,.json" data-field="import"></label></div>
    <button data-action="play" class="editor-play">验证并创建试玩房间 →</button><p role="status" data-field="status"></p></aside></div>`;
  document.body.append(overlay);
  const focusBefore = document.activeElement as HTMLElement | null;
  const find = <T extends HTMLElement>(selector: string) => overlay.querySelector<T>(selector)!;
  const canvas = find<HTMLCanvasElement>('canvas'),
    engine = new Engine(canvas, true, { powerPreference: 'low-power' }),
    scene = new Scene(engine);
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 1.4));
  scene.useRightHandedSystem = true;
  scene.clearColor = Color4.FromHexString('#14232aff');
  const light = new HemisphericLight('editor-sky', new Vector3(0, 1, 0), scene);
  light.intensity = 1.3;
  const camera = new ArcRotateCamera('editor-camera', -0.9, 0.8, 35, new Vector3(13, 0, 12), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 100;
  camera.setTarget(new Vector3(documentValue.size / 2, 10, documentValue.size / 2));
  camera.radius = 65;
  const gizmos = new GizmoManager(scene);
  gizmos.positionGizmoEnabled = true;
  gizmos.usePointerToAttachGizmos = true;
  if (gizmos.gizmos.positionGizmo) gizmos.gizmos.positionGizmo.snapDistance = 0.25;
  const material = new StandardMaterial('platform', scene);
  material.diffuseColor = Color3.FromHexString('#738f93');
  material.specularColor.setAll(0.1);
  const markerMaterial = new StandardMaterial('checkpoint', scene);
  markerMaterial.emissiveColor = Color3.FromHexString('#f9c979');
  markerMaterial.disableLighting = true;
  const meshes = new Map<string, Mesh>();
  let markers: Mesh[] = [],
    selected = documentValue.colliders[0]!.id,
    lastDraw = 0;
  const undo: string[] = [];
  const remember = () => {
    undo.push(JSON.stringify(documentValue));
    if (undo.length > 40) undo.shift();
  };
  const message = (text: string) => {
    find('[data-field=status]').textContent = text;
  };
  function syncDocument() {
    for (const c of documentValue.colliders) {
      const m = meshes.get(c.id);
      if (!m) continue;
      c.x = m.position.x;
      c.y = m.position.y;
      c.z = m.position.z;
      c.width = m.scaling.x;
      c.height = m.scaling.y;
      c.depth = m.scaling.z;
    }
  }
  function selection() {
    const c = documentValue.colliders.find((c) => c.id === selected);
    if (!c) return;
    for (const field of ['x', 'y', 'z', 'width', 'depth'] as const)
      find<HTMLInputElement>(`[data-field=${field}]`).value = String(
        Math.round((field === 'y' ? c.y + c.height / 2 : c[field]) * 100) / 100,
      );
    find<HTMLSelectElement>('[data-field=selection]').value = selected;
    gizmos.attachToMesh(meshes.get(selected)!);
  }
  function rebuild() {
    gizmos.attachToMesh(null);
    for (const m of meshes.values()) m.dispose();
    meshes.clear();
    markers.forEach((m) => m.dispose());
    markers = [];
    for (const c of documentValue.colliders) {
      const m =
        c.shape === 'sphere'
          ? MeshBuilder.CreateSphere(c.id, { diameter: 1, segments: 12 }, scene)
          : MeshBuilder.CreateBox(c.id, { size: 1 }, scene);
      if (c.ramp) applyRamp(m, { ...c, width: 1, height: 1, depth: 1 });
      m.position.set(c.x, c.y, c.z);
      m.scaling.set(c.width, c.height, c.depth);
      m.material = material;
      meshes.set(c.id, m);
    }
    for (const [i, p] of [documentValue.spawn, ...documentValue.checkpoints].entries()) {
      const marker = MeshBuilder.CreateTorus(
        'checkpoint-' + i,
        { diameter: 0.8, thickness: 0.06, tessellation: 24 },
        scene,
      );
      marker.position.set(p.x, p.y + 0.06, p.z);
      marker.material = markerMaterial;
      marker.isPickable = false;
      markers.push(marker);
    }
    gizmos.attachableMeshes = [...meshes.values()];
    const select = find<HTMLSelectElement>('[data-field=selection]');
    select.replaceChildren(...documentValue.colliders.map((c) => new Option(c.id, c.id)));
    if (!meshes.has(selected)) selected = documentValue.colliders[0]!.id;
    find('[data-field=route]').textContent =
      `${documentValue.colliders.length} 个平台 · ${documentValue.checkpoints.length} 个路线点 · ${documentValue.obstacles?.length ?? 0} 个摆锤（参数随 JSON 保存）`;
    selection();
  }
  gizmos.onAttachedToMeshObservable.add((mesh) => {
    if (mesh && mesh.id !== selected) {
      syncDocument();
      selected = mesh.id;
      selection();
    }
  });
  const boundGizmos = new Set();
  const attachDrag = () => {
    for (const gizmo of [gizmos.gizmos.positionGizmo, gizmos.gizmos.scaleGizmo]) {
      if (!gizmo || boundGizmos.has(gizmo)) continue;
      boundGizmos.add(gizmo);
      gizmo.onDragStartObservable.add(() => {
        syncDocument();
        remember();
      });
      gizmo?.onDragEndObservable.add(() => {
        syncDocument();
        selection();
      });
    }
  };
  attachDrag();
  rebuild();
  const resize = new ResizeObserver(() => engine.resize());
  resize.observe(canvas);
  engine.resize();
  engine.runRenderLoop(() => {
    if (document.hidden || performance.now() - lastDraw < 32) return;
    lastDraw = performance.now();
    scene.render();
  });
  function close() {
    resize.disconnect();
    gizmos.dispose();
    scene.dispose();
    engine.dispose();
    overlay.remove();
    onClose();
    focusBefore?.focus();
  }
  overlay.onchange = (event) => {
    const target = event.target as HTMLInputElement,
      field = target.dataset.field;
    if (!field) return;
    if (field === 'template' && parkourMaps[target.value]) {
      remember();
      documentValue = structuredClone(parkourMaps[target.value]);
      rebuild();
      message('已加载模板，可撤销恢复原草稿');
      return;
    }
    if (field === 'selection') {
      syncDocument();
      selected = target.value;
      selection();
      return;
    }
    if (field === 'import') {
      void (async () => {
        const file = target.files?.[0];
        if (!file) return;
        if (file.size > 65536) {
          message('地图文件不能超过 64 KiB');
          return;
        }
        try {
          const map = mapDocumentSchema.parse(JSON.parse(await file.text()));
          remember();
          documentValue = map;
          rebuild();
          message('已导入 ' + map.name);
        } catch {
          message('地图格式或路线点不合法，请检查后重试。');
        }
      })();
      return;
    }
    if (['x', 'y', 'z', 'width', 'depth'].includes(field)) {
      const value = Number(target.value);
      if (!Number.isFinite(value)) return;
      syncDocument();
      remember();
      const c = documentValue.colliders.find((c) => c.id === selected)!;
      if (field === 'y') c.y = value - c.height / 2;
      else if (field === 'x' || field === 'z' || field === 'width' || field === 'depth')
        c[field] = value;
      rebuild();
    }
  };
  overlay.onclick = (event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;
    syncDocument();
    if (action === 'close') {
      close();
      return;
    }
    if (action === 'move') {
      gizmos.positionGizmoEnabled = true;
      gizmos.scaleGizmoEnabled = false;
      return;
    }
    if (action === 'scale') {
      const first = !gizmos.gizmos.scaleGizmo;
      gizmos.positionGizmoEnabled = false;
      gizmos.scaleGizmoEnabled = true;
      if (gizmos.gizmos.scaleGizmo) gizmos.gizmos.scaleGizmo.snapDistance = 0.25;
      if (first) attachDrag();
      return;
    }
    if (action === 'undo') {
      const previous = undo.pop();
      if (previous) {
        documentValue = JSON.parse(previous);
        rebuild();
      }
      return;
    }
    if (['add', 'delete', 'spawn', 'checkpoint', 'clear'].includes(action)) {
      remember();
      const c = documentValue.colliders.find((c) => c.id === selected)!;
      if (action === 'add') {
        if (documentValue.colliders.length >= 128) return message('最多 128 个平台');
        selected = 'platform-' + crypto.randomUUID().slice(0, 8);
        documentValue.colliders.push({
          ...c,
          id: selected,
          x: Math.min(documentValue.size - 1, c.x + 3),
        });
      }
      if (action === 'delete') {
        if (documentValue.colliders.length <= 2) return message('至少保留两个平台');
        documentValue.colliders = documentValue.colliders.filter((c) => c.id !== selected);
      }
      if (action === 'spawn') documentValue.spawn = { x: c.x, y: c.y + c.height / 2, z: c.z };
      if (action === 'checkpoint')
        documentValue.checkpoints.push({ x: c.x, y: c.y + c.height / 2, z: c.z });
      if (action === 'clear') documentValue.checkpoints = [];
      rebuild();
      return;
    }
    if (action === 'save') {
      try {
        localStorage.setItem('maze-map-draft', JSON.stringify(documentValue));
        message('草稿已保存到此浏览器');
      } catch {
        message('浏览器存储不可用，请导出 JSON');
      }
      return;
    }
    const result = mapDocumentSchema.safeParse(documentValue);
    if (!result.success) {
      message(
        result.error.issues
          .map((i) => i.message)
          .slice(0, 3)
          .join('；'),
      );
      return;
    }
    if (action === 'export') {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = documentValue.id + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (action === 'play') {
      close();
      onPlay(result.data);
    }
  };
  find<HTMLButtonElement>('[data-action=close]').focus();
  return { close };
}

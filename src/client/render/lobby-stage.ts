import { Engine, ArcRotateCamera, Vector3 } from '../../engine/babylon.ts';
import { createScene } from './scene.ts';
import { Avatar } from './avatar.ts';
import { normalize } from './assets.ts';
import { defineMap } from '../../content/maps.ts';
import { characters, weapons } from '../../shared/arsenal.ts';
export function makeLobbyStage(container: HTMLElement) {
  let engine: Engine | undefined,
    visual: ReturnType<typeof createScene> | undefined,
    camera: ArcRotateCamera | undefined,
    avatar: Avatar | undefined;
  let enabled = false,
    revision = 0,
    generation = 0,
    last = 0,
    ratio = 1.3,
    choice: { character: string; weapon?: string } = { character: 'ranger', weapon: 'rifle' };
  const caption = document.getElementById('stage-caption')!,
    status = document.getElementById('stage-status')!;
  async function appearance(next: typeof choice) {
    choice = next;
    if (!visual) return;
    const current = visual,
      version = ++revision;
    status.textContent = '正在准备角色…';
    const player = { ...choice, x: 4, y: 0, z: 4, yaw: 0, motion: 'idle' };
    try {
      const instance = await Avatar.create(current.assets, player);
      if (version !== revision || visual !== current) {
        instance.dispose();
        return;
      }
      avatar?.dispose();
      avatar = instance;
      caption.textContent =
        characters[choice.character as keyof typeof characters] +
        ' / ' +
        (choice.weapon ? weapons[choice.weapon as keyof typeof weapons].label : '跃迁挑战');
      status.textContent = '';
    } catch (error) {
      if (visual === current) {
        status.textContent = '模型加载失败，请重试';
        console.error(error);
      }
    }
  }
  function tick() {
    if (!engine || !visual || document.hidden) return;
    const now = performance.now();
    if (now - last < 1000 / 30) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    avatar?.update({ ...choice, x: 4, y: 0, z: 4, yaw: 0, motion: 'idle' }, dt);
    visual.scene.render();
    container.dataset.rendering = 'active';
  }
  async function start() {
    const version = ++generation,
      canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D 角色预览，拖动旋转');
    container.prepend(canvas);
    engine = new Engine(canvas, true, { powerPreference: 'low-power' });
    engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, ratio));
    visual = createScene(
      engine,
      defineMap([
        '#########',
        '#.......#',
        '#.......#',
        '#.......#',
        '#.......#',
        '#.......#',
        '#.......#',
        '#.......#',
        '#########',
      ]),
    );
    camera = new ArcRotateCamera(
      'preview',
      -Math.PI / 2,
      1.28,
      3.7,
      new Vector3(4, 0.94, 4),
      visual.scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2.4;
    camera.upperRadiusLimit = 5.8;
    camera.wheelPrecision = 45;
    camera.lowerBetaLimit = 0.65;
    camera.upperBetaLimit = 1.6;
    engine.resize();
    engine.runRenderLoop(tick);
    void currentReady();
    async function currentReady() {
      try {
        await visual?.ready;
        await appearance(choice);
      } catch (error) {
        if (generation === version) console.error(error);
      }
    }
    const current = visual;
    for (const [name, x, z, size] of [
      ['container', 6.7, 6, 3],
      ['crate', 2.2, 5.5, 1],
      ['pallet', 5.6, 5, 0.8],
    ] as const) {
      try {
        const prop = await current.assets.instance('lobby-' + name);
        if (generation !== version) {
          prop.dispose();
          return;
        }
        normalize(prop.root, size);
        const bounds = prop.root.getHierarchyBoundingVectors(true);
        prop.root.position.set(x, -bounds.min.y, z);
      } catch (error) {
        if (generation === version) console.error(error);
      }
    }
  }
  function stop() {
    generation++;
    revision++;
    avatar?.dispose();
    avatar = undefined;
    visual?.dispose();
    visual = undefined;
    const canvas = engine?.getRenderingCanvas();
    engine?.dispose();
    engine = undefined;
    canvas?.remove();
    container.dataset.rendering = 'stopped';
  }
  container.querySelectorAll<HTMLElement>('[data-rotate]').forEach(
    (button) =>
      (button.onclick = () => {
        if (camera) camera.alpha += Number(button.dataset.rotate) * 0.35;
      }),
  );
  const resize = () => engine?.resize();
  new ResizeObserver(resize).observe(container);
  return {
    appearance,
    active(value: boolean) {
      if (enabled === value) return;
      enabled = value;
      if (value) void start();
      else stop();
    },
    quality(value: number) {
      ratio = value;
      engine?.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, ratio));
      resize();
    },
  };
}

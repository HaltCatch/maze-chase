/** Native browser capture: protected Ctrl shortcuts require API-entered fullscreen.
 * https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock
 * Escape is deliberately omitted so a normal press can always pause/release. */
export const gameplayKeys = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ControlLeft',
  'ControlRight',
  'KeyC',
  'ShiftLeft',
  'ShiftRight',
  'KeyR',
  'KeyE',
  'KeyG',
  'KeyF',
  'KeyQ',
  'KeyL',
  'KeyT',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
];
interface KeyboardCapture {
  lock?: (codes: string[]) => Promise<void>;
  unlock?: () => void;
}
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardCapture }).keyboard;
export async function enterGameFullscreen() {
  if (!document.fullscreenElement && document.fullscreenEnabled) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* Window mode remains playable. */
    }
  }
}
/** Call both APIs in the same click, pointer first: fullscreen consumes activation.
 * https://www.w3.org/TR/pointerlock-2/#extensions-to-the-element-interface */
export async function captureGameplayPointer(canvas: HTMLCanvasElement, immersive: boolean) {
  if (typeof canvas.requestPointerLock !== 'function') return false;
  let finish: (locked: boolean) => void;
  let timer: ReturnType<typeof setTimeout>;
  const changed = () => finish(document.pointerLockElement === canvas);
  const failed = () => finish(false);
  const result = new Promise<boolean>((resolve) => {
    finish = (locked) => {
      clearTimeout(timer);
      document.removeEventListener('pointerlockchange', changed);
      document.removeEventListener('pointerlockerror', failed);
      resolve(locked);
    };
    document.addEventListener('pointerlockchange', changed);
    document.addEventListener('pointerlockerror', failed);
    timer = setTimeout(failed, 15000);
  });
  try {
    const pointer = canvas.requestPointerLock();
    // No await here: retain the original user gesture for both requests.
    const fullscreen = immersive ? enterGameFullscreen() : Promise.resolve();
    if (pointer?.then) pointer.then(changed, failed);
    await fullscreen;
    return (await result) && document.pointerLockElement === canvas;
  } catch {
    failed();
    return false;
  }
}
export async function captureGameplayKeys(active: () => boolean) {
  if (!document.fullscreenElement || !active()) return;
  try {
    await keyboard()?.lock?.(gameplayKeys);
    if (!active()) releaseGameplayKeys();
  } catch {
    /* Denied/unsupported: ordinary key cancellation and C crouch remain available. */
  }
}
export function releaseGameplayKeys() {
  keyboard()?.unlock?.();
}

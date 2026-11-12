import { gameplayKeys, releaseGameplayKeys } from './browser-capture.ts';
import { navigateMenu } from './menu-navigation.ts';
import { GamepadManager } from '@babylonjs/core/Gamepads/gamepadManager.js';
import type { Gamepad as BabylonGamepad } from '@babylonjs/core/Gamepads/gamepad.js';
export type Action =
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'fire'
  | 'aim'
  | 'reload'
  | 'interact'
  | 'grenade'
  | 'cycle'
  | 'primary'
  | 'sidearm'
  | 'throwable'
  | 'decoy'
  | 'light'
  | 'route'
  | 'pause'
  | 'activate';
export interface InputOptions {
  action: (action: Action, down: boolean) => void;
  look: (x: number, y: number) => void;
  playing: () => boolean;
  paused: () => boolean;
  status: (message: string) => void;
}
const keys: Record<string, Action> = {
  Space: 'jump',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyR: 'reload',
  KeyE: 'interact',
  KeyG: 'grenade',
  KeyF: 'grenade',
  KeyQ: 'decoy',
  KeyL: 'light',
  KeyT: 'route',
  Digit1: 'primary',
  Digit2: 'sidearm',
  Digit3: 'throwable',
  Digit4: 'throwable',
  Escape: 'pause',
};
const buttons: Record<number, Action> = {
  0: 'jump',
  1: 'crouch',
  2: 'reload',
  3: 'cycle',
  4: 'grenade',
  5: 'interact',
  6: 'aim',
  7: 'fire',
  8: 'route',
  9: 'pause',
  10: 'sprint',
  11: 'decoy',
  12: 'primary',
  13: 'sidearm',
  14: 'throwable',
  15: 'light',
};
/** Radial dead zone preserves direction and the full analogue range outside centre drift. */
export function radial(x: number, y: number, dead = 0.16) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0] as const;
  const size = Math.hypot(x, y);
  if (size <= dead) return [0, 0] as const;
  const n = Math.min(1, (size - dead) / (1 - dead)) / size;
  return [x * n, y * n] as const;
}
export class InputController {
  private manager = new GamepadManager();
  private pad?: BabylonGamepad;
  private held = new Set<string>();
  private previous: boolean[] = [];
  private mouseButtons = 0;
  private abort = new AbortController();
  private options: InputOptions;
  private frame = 0;
  private last = 0;
  private menuAt = 0;
  settings = { sensitivity: 1, deadZone: 0.16, invertY: false, immersive: true };
  private moveX = 0;
  private moveZ = 0;
  private sprint = false;
  private crouch = false;
  gamepadActive = false;
  pointerFallback = false;
  constructor(options: InputOptions) {
    this.options = options;
    const signal = this.abort.signal;
    this.manager.onGamepadConnectedObservable.add((pad) => {
      if (pad.browserGamepad.mapping !== 'standard') {
        options.status('此手柄未提供标准映射，请使用系统的标准手柄模式');
        return;
      }
      if (!this.pad) {
        this.pad = pad;
        this.previous = [];
        options.status('手柄已连接 · A 确认，方向键导航');
      }
    });
    this.manager.onGamepadDisconnectedObservable.add((pad) => {
      if (this.pad === pad) {
        this.release();
        this.pad = undefined;
        options.action('pause', true);
        options.status('手柄已断开，已暂停输入');
      }
    });
    addEventListener(
      'keydown',
      (e) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLSelectElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;
        if (
          !options.playing() ||
          options.paused() ||
          (!document.pointerLockElement && !this.pointerFallback)
        )
          return;
        // Include reload, weapon keys and crouch: Ctrl+R/W/T/F otherwise invoke
        // browser reload/close/new-tab/find while the player holds crouch.
        if (gameplayKeys.includes(e.code)) e.preventDefault();
        if (e.metaKey) return;
        this.gamepadActive = false;
        this.held.add(e.code);
        if (!e.repeat && keys[e.code]) options.action(keys[e.code], true);
      },
      { signal },
    );
    addEventListener(
      'keyup',
      (e) => {
        if (options.playing() && !options.paused() && gameplayKeys.includes(e.code))
          e.preventDefault();
        this.held.delete(e.code);
        if (keys[e.code]) options.action(keys[e.code], false);
      },
      { signal },
    );
    addEventListener(
      'pointermove',
      (e) => {
        if (
          options.playing() &&
          !options.paused() &&
          (document.pointerLockElement || (this.pointerFallback && e.buttons === 4))
        ) {
          this.gamepadActive = false;
          this.updateMouseButtons(e.buttons);
          options.look(e.movementX * 0.0022, e.movementY * 0.0022);
        }
      },
      { signal },
    );
    addEventListener(
      'pointerdown',
      (e) => {
        if (
          options.playing() &&
          !options.paused() &&
          (document.pointerLockElement || this.pointerFallback) &&
          e.button !== 1 &&
          e.button < 3 &&
          !(e.target as Element).closest('button')
        ) {
          e.preventDefault();
          this.gamepadActive = false;
          this.updateMouseButtons(e.buttons || (e.button === 2 ? 2 : 1));
        }
      },
      { signal, capture: true },
    );
    addEventListener(
      'pointerup',
      (e) => {
        this.updateMouseButtons(options.playing() && !options.paused() ? e.buttons : 0);
      },
      { signal },
    );
    addEventListener('pointercancel', () => this.updateMouseButtons(0), { signal });
    addEventListener(
      'contextmenu',
      (e) => {
        if (
          options.playing() &&
          !options.paused() &&
          (document.pointerLockElement || this.pointerFallback)
        )
          e.preventDefault();
      },
      { signal, capture: true },
    );
    addEventListener(
      'blur',
      () => {
        this.release();
        options.action('pause', true);
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.release();
          options.action('pause', true);
        }
      },
      { signal },
    );
    this.frame = requestAnimationFrame(this.tick);
  }
  /** Pointer Events report a second held mouse button via pointermove, not pointerdown.
   * https://www.w3.org/TR/pointerevents/#chorded-button-interactions */
  private updateMouseButtons(buttons: number) {
    const changed = this.mouseButtons ^ buttons;
    this.mouseButtons = buttons;
    // Aim first when both buttons change, so a firing edge sees the current draw state.
    for (const [mask, action] of [
      [2, 'aim'],
      [1, 'fire'],
    ] as const)
      if (changed & mask) this.options.action(action, !!(buttons & mask));
  }
  private release() {
    this.mouseButtons = 0;
    releaseGameplayKeys();
    this.held.clear();
    this.moveX = this.moveZ = 0;
    this.sprint = this.crouch = false;
    for (const a of ['fire', 'aim', 'sprint', 'crouch'] as Action[]) this.options.action(a, false);
    this.gamepadActive = false;
    this.pointerFallback = false;
    this.previous = [];
  }
  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.last) / 1000 || 1 / 60);
    this.last = now;
    if (!this.pad?.isConnected || document.hidden) return;
    const pad = this.pad,
      raw = pad.browserGamepad as Gamepad,
      current = raw.buttons.map((b) => b.pressed || b.value > 0.35),
      pressed = (i: number) => current[i] && !this.previous[i];
    const [lx, ly] = radial(pad.leftStick.x, pad.leftStick.y, this.settings.deadZone),
      [rx, ry] = radial(pad.rightStick.x, pad.rightStick.y, this.settings.deadZone);
    if (!this.options.playing()) {
      const dx = +!!current[15] - +!!current[14] || (Math.abs(lx) > 0.6 ? Math.sign(lx) : 0),
        dy = +!!current[13] - +!!current[12] || (Math.abs(ly) > 0.6 ? Math.sign(ly) : 0);
      if (pressed(0) || pressed(1) || ((dx || dy) && now > this.menuAt)) {
        navigateMenu(dx, dy, pressed(0), pressed(1));
        this.menuAt = now + 180;
      }
      this.previous = current;
      return;
    }
    if (this.options.paused()) {
      const dy = +!!current[13] - +!!current[12] || (Math.abs(ly) > 0.6 ? Math.sign(ly) : 0);
      if (dy && now > this.menuAt) {
        navigateMenu(0, dy, false, false);
        this.menuAt = now + 180;
      }
      if (pressed(0) && document.activeElement?.id === 'quit') {
        (document.activeElement as HTMLButtonElement).click();
      } else if (pressed(0) || pressed(9)) {
        this.gamepadActive = true;
        this.options.action('activate', true);
      }
      this.previous = current;
      return;
    }
    if (lx || ly || rx || ry || current.some(Boolean)) this.gamepadActive = true;
    if (this.gamepadActive) {
      this.moveX = lx;
      this.moveZ = -ly;
      this.sprint = !!current[10];
      this.crouch = !!current[1];
      this.options.look(
        rx * 2.3 * dt * this.settings.sensitivity,
        ry * 1.9 * dt * this.settings.sensitivity * (this.settings.invertY ? -1 : 1),
      );
    }
    for (const [id, action] of Object.entries(buttons)) {
      const i = Number(id);
      if (!!current[i] !== !!this.previous[i]) this.options.action(action, !!current[i]);
    }
    this.previous = current;
  };
  movement() {
    if (this.options.paused())
      return {
        f: false,
        b: false,
        l: false,
        r: false,
        run: false,
        quiet: false,
        moveX: 0,
        moveZ: 0,
      };
    const x = this.gamepadActive
      ? this.moveX
      : Number(this.held.has('KeyD')) - Number(this.held.has('KeyA'));
    const z = this.gamepadActive
      ? this.moveZ
      : Number(this.held.has('KeyW')) - Number(this.held.has('KeyS'));
    return {
      f: z > 0,
      b: z < 0,
      l: x < 0,
      r: x > 0,
      moveX: x,
      moveZ: z,
      run: this.gamepadActive
        ? this.sprint
        : this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      quiet: this.gamepadActive
        ? this.crouch
        : this.held.has('ControlLeft') || this.held.has('ControlRight') || this.held.has('KeyC'),
    };
  }
  suspend() {
    this.release();
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.release();
    this.manager.dispose();
  }
}

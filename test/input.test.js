import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { InputController, radial } from '../src/client/controllers/input.ts';
test('analogue dead zones preserve direction, reject drift and clamp the outer circle', () => {
  assert.deepEqual(radial(0.03, -0.04), [0, 0]);
  assert.deepEqual(radial(1, 0), [1, 0]);
  const [x, y] = radial(0.8, 0.8);
  assert.ok(Math.abs(x - y) < 1e-9);
  assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-9);
  assert.ok(radial(0.5, 0)[0] > 0.3 && radial(0.5, 0)[0] < 0.5);
});
test(
  'Babylon GamepadManager drives menus, analogue movement, triggers, pause and disconnect',
  { timeout: 5000 },
  () => {
    const win = new Window({ url: 'http://localhost' }),
      saved = new Map(),
      frames = new Map();
    let id = 0,
      now = 1000,
      playing = false,
      paused = false;
    const actions = [],
      looks = [],
      status = [];
    const globals = {
      window: win,
      document: win.document,
      navigator: win.navigator,
      HTMLElement: win.HTMLElement,
      HTMLButtonElement: win.HTMLButtonElement,
      HTMLInputElement: win.HTMLInputElement,
      HTMLSelectElement: win.HTMLSelectElement,
      HTMLTextAreaElement: win.HTMLTextAreaElement,
      Event: win.Event,
      AbortController: win.AbortController,
      addEventListener: win.addEventListener.bind(win),
      requestAnimationFrame: (fn) => {
        frames.set(++id, fn);
        return id;
      },
      cancelAnimationFrame: (n) => frames.delete(n),
      getComputedStyle: win.getComputedStyle.bind(win),
    };
    for (const [k, v] of Object.entries(globals)) {
      saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    }
    win.requestAnimationFrame = globals.requestAnimationFrame;
    win.cancelAnimationFrame = globals.cancelAnimationFrame;
    const pad = {
      id: 'Xbox 360 Controller (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    let pads = [pad];
    Object.defineProperty(win.navigator, 'getGamepads', { value: () => pads, configurable: true });
    Object.defineProperty(win.document, 'hidden', { value: false, configurable: true });
    win.document.body.innerHTML =
      '<canvas id="view"></canvas><button id="menu">开始</button><button id="quit">返回大厅</button>';
    for (const e of win.document.querySelectorAll('button'))
      e.getClientRects = () => [{ width: 30, height: 20 }];
    let clicked = 0;
    win.document.getElementById('menu').onclick = () => clicked++;
    const tick = () => {
      now += 20;
      const pending = [...frames];
      frames.clear();
      for (const [, fn] of pending) fn(now);
    };
    const controller = new InputController({
      playing: () => playing,
      paused: () => paused,
      action: (a, d) => {
        actions.push([a, d]);
        if (a === 'activate') paused = false;
      },
      look: (x, y) => looks.push([x, y]),
      status: (m) => status.push(m),
    });
    const button = (i, down) => {
      pad.buttons[i] = { pressed: down, touched: down, value: Number(down) };
      tick();
      tick();
    };
    try {
      win.document.getElementById('menu').focus();
      button(0, true);
      assert.equal(clicked, 1);
      button(0, false);
      assert.ok(status.some((s) => s.includes('连接')));
      playing = true;
      controller.pointerFallback = true;
      const canvas = win.document.getElementById('view');
      canvas.addEventListener('pointerdown', (e) => e.preventDefault());
      canvas.dispatchEvent(
        new win.PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }),
      );
      canvas.dispatchEvent(new win.PointerEvent('pointerup', { button: 0, bubbles: true }));
      assert.ok(
        actions.some(([a, d]) => a === 'fire' && d),
        'pointer capture works even when engine prevents synthetic mouse events',
      );
      // Pointer events remain available even when pointerdown cancels compatibility mouse events.
      Object.defineProperty(win.document, 'pointerLockElement', {
        value: canvas,
        configurable: true,
      });
      const lookStart = looks.length;
      for (const buttons of [0, 1, 2]) {
        const event = new win.PointerEvent('pointermove', { buttons, bubbles: true });
        Object.defineProperties(event, { movementX: { value: 20 }, movementY: { value: -10 } });
        canvas.dispatchEvent(event);
      }
      assert.equal(looks.length, lookStart + 3);
      for (const [x, y] of looks.slice(lookStart)) {
        assert.ok(Math.abs(x - 0.044) < 1e-12 && Math.abs(y + 0.022) < 1e-12);
      }
      canvas.dispatchEvent(new win.PointerEvent('pointerup', { buttons: 0, bubbles: true }));
      const chord = actions.length;
      canvas.dispatchEvent(
        new win.PointerEvent('pointerdown', { button: 2, buttons: 2, bubbles: true }),
      );
      canvas.dispatchEvent(
        new win.PointerEvent('pointermove', { button: 0, buttons: 3, bubbles: true }),
      );
      canvas.dispatchEvent(
        new win.PointerEvent('pointermove', { button: 0, buttons: 2, bubbles: true }),
      );
      canvas.dispatchEvent(
        new win.PointerEvent('pointerup', { button: 2, buttons: 0, bubbles: true }),
      );
      assert.deepEqual(actions.slice(chord), [
        ['aim', true],
        ['fire', true],
        ['fire', false],
        ['aim', false],
      ]);
      paused = true;
      canvas.dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true }));
      assert.equal(looks.length, lookStart + 5);
      paused = false;
      const control = new win.KeyboardEvent('keydown', {
        code: 'ControlLeft',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(control);
      assert.equal(controller.movement().quiet, true);
      for (const code of ['KeyW', 'KeyR', 'KeyT', 'KeyF', 'KeyS', 'Digit1']) {
        const event = new win.KeyboardEvent('keydown', {
          code,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        canvas.dispatchEvent(event);
        assert.equal(
          event.defaultPrevented,
          true,
          code + ' must not invoke a browser shortcut while crouched',
        );
        canvas.dispatchEvent(new win.KeyboardEvent('keyup', { code, bubbles: true }));
      }
      const count = actions.length;
      const fire = new win.PointerEvent('pointerdown', {
        button: 0,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(fire);
      canvas.dispatchEvent(
        new win.PointerEvent('pointerup', { button: 0, ctrlKey: true, bubbles: true }),
      );
      assert.deepEqual(actions.slice(count), [
        ['fire', true],
        ['fire', false],
      ]);
      assert.equal(fire.defaultPrevented, true);
      const context = new win.MouseEvent('contextmenu', {
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(context);
      assert.equal(context.defaultPrevented, true);
      canvas.dispatchEvent(new win.KeyboardEvent('keyup', { code: 'ControlLeft', bubbles: true }));
      assert.equal(controller.movement().quiet, false);
      paused = true;
      const reloadOutside = new win.KeyboardEvent('keydown', {
        code: 'KeyR',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(reloadOutside);
      assert.equal(
        reloadOutside.defaultPrevented,
        false,
        'paused browser shortcuts remain available',
      );
      paused = false;
      pad.axes = [0.5, -0.8, 0.7, -0.3];
      tick();
      tick();
      const move = controller.movement();
      assert.ok(move.moveX > 0.3 && move.moveZ > 0.6);
      assert.ok(move.f && move.r);
      assert.ok(looks.length);
      button(7, true);
      assert.ok(actions.some(([a, d]) => a === 'fire' && d));
      button(7, false);
      assert.ok(actions.some(([a, d]) => a === 'fire' && !d));
      button(6, true);
      assert.ok(actions.some(([a, d]) => a === 'aim' && d));
      button(6, false);
      button(1, true);
      assert.equal(controller.movement().quiet, true);
      button(1, false);
      button(10, true);
      assert.equal(controller.movement().run, true);
      button(10, false);
      paused = true;
      button(9, true);
      assert.ok(actions.some(([a, d]) => a === 'activate' && d));
      button(9, false);
      pads = [];
      pad.connected = false;
      const event = new win.Event('gamepaddisconnected');
      event.gamepad = pad;
      win.dispatchEvent(event);
      tick();
      assert.equal(controller.gamepadActive, false);
      assert.ok(status.some((s) => s.includes('断开')));
    } finally {
      controller.dispose();
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
      win.happyDOM.abort();
    }
  },
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  gameplayKeys,
  captureGameplayPointer,
  enterGameFullscreen,
  captureGameplayKeys,
  releaseGameplayKeys,
} from '../src/client/controllers/browser-capture.ts';
test('native fullscreen captures game shortcuts, never Escape, and releases denied/stale capture safely', async () => {
  const win = new Window();
  const saved = new Map(
    ['document', 'navigator'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const key of saved.keys())
    Object.defineProperty(globalThis, key, { value: win[key], configurable: true });
  let full = false,
    locks = 0,
    unlocks = 0,
    active = true,
    finish;
  Object.defineProperty(win.document, 'fullscreenEnabled', { value: true });
  Object.defineProperty(win.document, 'fullscreenElement', {
    get: () => (full ? win.document.documentElement : null),
  });
  win.document.documentElement.requestFullscreen = async () => {
    full = true;
  };
  Object.defineProperty(win.navigator, 'keyboard', {
    value: {
      lock: async (codes) => {
        assert.deepEqual(codes, gameplayKeys);
        locks++;
        await new Promise((r) => {
          finish = r;
        });
      },
      unlock: () => unlocks++,
    },
    configurable: true,
  });
  try {
    await captureGameplayKeys(() => active);
    assert.equal(locks, 0, 'no keyboard lock outside API fullscreen');
    await enterGameFullscreen();
    assert.ok(full);
    assert.ok(!gameplayKeys.includes('Escape'));
    assert.ok(gameplayKeys.includes('KeyW') && gameplayKeys.includes('KeyR'));
    let pending = captureGameplayKeys(() => active);
    finish();
    await pending;
    assert.equal(locks, 1);
    releaseGameplayKeys();
    assert.equal(unlocks, 1);
    pending = captureGameplayKeys(() => active);
    active = false;
    finish();
    await pending;
    assert.equal(unlocks, 2, 'late permission must not recapture a paused game');
    active = true;
    win.navigator.keyboard.lock = async () => {
      throw Error('NotAllowedError');
    };
    await assert.doesNotReject(() => captureGameplayKeys(() => active));
    win.navigator.keyboard.lock = undefined;
    win.navigator.keyboard.unlock = undefined;
    await assert.doesNotReject(() => captureGameplayKeys(() => active));
    assert.doesNotThrow(releaseGameplayKeys);
    full = false;
    win.document.documentElement.requestFullscreen = async () => {
      throw Error('NotAllowedError');
    };
    await assert.doesNotReject(enterGameFullscreen);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    win.happyDOM.abort();
  }
});

test('pointer capture precedes fullscreen consumption and never reports rejected or stale capture as active', async () => {
  const win = new Window();
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
  const canvas = win.document.createElement('canvas');
  let activation,
    locked = null,
    full = false;
  const calls = [];
  Object.defineProperty(win.document, 'pointerLockElement', { get: () => locked });
  Object.defineProperty(win.document, 'fullscreenEnabled', { value: true });
  Object.defineProperty(win.document, 'fullscreenElement', {
    get: () => (full ? win.document.documentElement : null),
  });
  win.document.documentElement.requestFullscreen = async () => {
    calls.push('fullscreen');
    activation = false;
    full = true;
  };
  try {
    for (const legacy of [false, true]) {
      activation = true;
      full = false;
      locked = null;
      calls.length = 0;
      canvas.requestPointerLock = () => {
        calls.push('pointer');
        assert.ok(activation, 'pointer request needs the original click activation');
        const done = Promise.resolve().then(() => {
          locked = canvas;
          win.document.dispatchEvent(new win.Event('pointerlockchange'));
        });
        return legacy ? undefined : done;
      };
      assert.equal(await captureGameplayPointer(canvas, true), true);
      assert.deepEqual(calls, ['pointer', 'fullscreen']);
    }
    locked = null;
    full = false;
    canvas.requestPointerLock = () => Promise.reject(new Error('NotAllowedError'));
    assert.equal(await captureGameplayPointer(canvas, true), false);
    canvas.requestPointerLock = () => {
      queueMicrotask(() => win.document.dispatchEvent(new win.Event('pointerlockerror')));
    };
    assert.equal(await captureGameplayPointer(canvas, false), false);
    canvas.requestPointerLock = () => {
      locked = canvas;
      win.document.dispatchEvent(new win.Event('pointerlockchange'));
      return Promise.resolve();
    };
    full = false;
    win.document.documentElement.requestFullscreen = async () => {
      locked = null;
    };
    assert.equal(
      await captureGameplayPointer(canvas, true),
      false,
      'lost lock during fullscreen must keep entry paused',
    );
    canvas.requestPointerLock = undefined;
    assert.equal(await captureGameplayPointer(canvas, false), false);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved);
    else delete globalThis.document;
    win.happyDOM.abort();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { primaryModes, combatVariants } from '../src/shared/modes.ts';
import { isGameMode } from '../src/shared/protocol.ts';
import { startDuel, duelAction, duelState, dropCore, tickCore } from '../src/server/duel.js';
import { rescueAlly, startWaves, tickWaves } from '../src/server/survival.js';
import { combatRespawn } from '../src/server/modes/respawn.ts';
import { resetCombat, armPlayer } from '../src/server/combat.js';
import { deployment } from '../src/shared/arsenal.ts';
import { arenas, docksMap, docksCores } from '../src/shared/docks.js';
import { cell, sight } from '../src/shared/world.js';
const reset = (p, spawn) =>
  Object.assign(p, spawn, { y: 0, alive: true, stunUntil: 0, input: {}, energy: 1 });
function fixture(mode = 'duel', arena = 'docks', round = 0) {
  const r = {
    mode,
    arena,
    round,
    difficulty: 'normal',
    players: [0, 1].map((id) => ({ id, kit: deployment(mode) })),
  };
  startDuel(r, reset);
  resetCombat(r);
  return r;
}
test('five focused cards keep gun ladder under combat; retired hide is rejected at the protocol boundary', async () => {
  assert.equal(primaryModes.length, 5);
  assert.deepEqual(combatVariants, ['skirmish', 'gungame']);
  assert.equal(isGameMode('hide'), false);
  const win = new Window({ url: 'http://localhost' });
  win.document.write(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'));
  const keys = ['document', 'localStorage', 'Option'];
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const k of keys)
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: win[k] });
  globalThis.Option = function (text, value) {
    const o = win.document.createElement('option');
    o.textContent = text;
    o.value = value;
    return o;
  };
  win.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
  });
  try {
    const { makeLobby } = await import('../src/client/lobby.js');
    const menu = makeLobby({});
    const $ = (id) => win.document.getElementById(id);
    assert.equal($('choices').children.length, 5);
    $('choices').querySelector('[data-mode=skirmish]').click();
    assert.equal($('combat-variant-picker').hidden, false);
    $('combat-variant').value = 'gungame';
    $('combat-variant').dispatchEvent(new win.Event('change'));
    assert.equal(menu.selected(), 'gungame');
    assert.match($('brief-win').textContent, /6 次/);
    $('choices').querySelector('[data-mode=parkour]').click();
    assert.equal($('ai-count').disabled, true);
    assert.equal($('ai-count').value, '0');
    assert.equal($('jump-settings').hidden, true);
    assert.equal($('double-jump').disabled, true);
    $('arena').value = 'skyline';
    $('arena').dispatchEvent(new win.Event('change'));
    assert.equal($('jump-settings').hidden, false);
    assert.equal($('double-jump').disabled, false);
    $('double-jump').checked = true;
    $('choices').querySelector('[data-mode=survival]').click();
    assert.equal($('ai-count').value, '-1');
    assert.equal($('ai-count').disabled, false);
    assert.equal($('ai-label').textContent, 'AI 队友');
    assert.equal($('double-jump').checked, true, 'other maps retain selectable air jumps');
    assert.equal($('combat-variant-picker').hidden, true);
    menu.difficulty({ room: 'one', host: true, difficulty: 'normal' });
    $('difficulty').value = 'easy';
    menu.difficulty({ room: 'one', host: true, difficulty: 'normal' });
    assert.equal($('difficulty').value, 'easy', 'teammate readiness preserves host selection');
    menu.room(false);
    menu.difficulty({ room: 'two', host: true, difficulty: 'hard' });
    assert.equal($('difficulty').value, 'hard');
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
    await win.happyDOM.abort();
  }
});
test('each core carrier must cross into the opposing half; kills and the wrong dock never score', () => {
  for (const round of [0, 1])
    for (const side of [0, 1]) {
      const r = fixture('duel', 'docks', round),
        p = r.players[side],
        other = r.players[1 - side];
      const ownStart = p.z;
      Object.assign(p, docksCores[0]);
      duelAction(r, p, 1000);
      const goal = duelState(r, p, 1100),
        wrong = duelState(r, other, 1100).drop;
      assert.ok(Math.abs(goal.drop.z - ownStart) > 15);
      Object.assign(p, wrong);
      duelAction(r, p, 1200);
      assert.deepEqual(r.duel.scores, [0, 0]);
      Object.assign(p, goal.alternate);
      duelAction(r, p, 2000);
      assert.equal(r.duel.scores[side], 1);
      assert.equal(r.duel.carrier, null);
    }
});
test('dropped core returns once after 15 seconds; a pickup cancels return and aerial pickup is rejected', () => {
  const r = fixture(),
    p = r.players[0];
  Object.assign(p, docksCores[0], { y: 2 });
  duelAction(r, p, 1000);
  assert.equal(r.duel.carrier, null);
  p.y = 0;
  duelAction(r, p, 1100);
  Object.assign(p, { x: 12.5, z: 9.5 });
  dropCore(r, p, 2000);
  tickCore(r, 16999);
  assert.ok(r.duel.looseCore);
  tickCore(r, 17000);
  assert.equal(r.duel.looseCore, undefined);
  Object.assign(p, docksCores[0]);
  duelAction(r, p, 18000);
  dropCore(r, p, 19000);
  duelAction(r, p, 20000);
  tickCore(r, 50000);
  assert.equal(r.duel.carrier, p);
  assert.equal(r.duel.returnAt, undefined);
});
test('cooperative rescue requires a live nearby teammate and sight, preserves ammo, and cannot farm revives', () => {
  const r = fixture('survival'),
    [a, b] = r.players;
  startWaves(r, 1000);
  tickWaves(r, 1000, reset, armPlayer);
  Object.assign(a, { x: 12.5, z: 2.5 });
  Object.assign(b, { x: 12.5, z: 3.6, alive: false, health: 0 });
  b.ammo.rifle = 7;
  a.stunUntil = 2000;
  assert.equal(rescueAlly(r, a, 1000), undefined);
  a.stunUntil = 0;
  b.y = 2;
  assert.equal(rescueAlly(r, a, 1000), undefined);
  b.y = 0;
  b.z = 8;
  assert.equal(rescueAlly(r, a, 1000), undefined);
  b.z = 3.6;
  assert.equal(rescueAlly(r, a, 1000), b);
  assert.equal(b.health, 50);
  assert.equal(b.ammo.rifle, 7);
  b.alive = false;
  b.health = 0;
  assert.equal(rescueAlly(r, a, 3000), undefined);
  // A thin occluder between adjacent players must prevent rescue, even within 1.6 m.
  r.map = ['#####', '#.#.#', '#####'];
  Object.assign(a, { x: 1.8, z: 1.5 });
  Object.assign(b, { x: 3.2, z: 1.5, rescuedThisWave: false });
  assert.equal(rescueAlly(r, a, 3000), undefined);
  b.enemy = true;
  assert.equal(rescueAlly(r, a, 3000), undefined);
});
test('respawn candidates remain walkable, avoid occupied/visible camp sites, and preserve core team halves', () => {
  for (const arena of Object.keys(arenas)) {
    const r = fixture('skirmish', arena),
      [a, b] = r.players;
    a.alive = false;
    Object.assign(b, { x: 12.5, z: 22.5 });
    for (const random of [() => 0, () => 0.99]) {
      const p = combatRespawn(r, a, random);
      assert.equal(cell(r.map, p.x, p.z), '.');
      assert.ok(Math.hypot(p.x - b.x, p.z - b.z) > 6, arena);
      assert.equal(sight(r.map, p, b), false, arena + ' should choose covered spawn');
    }
    r.mode = 'duel';
    const p = combatRespawn(r, a, () => 0);
    assert.ok(p.z > 17);
  }
});

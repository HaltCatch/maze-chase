import { mazeObjectives } from './render/maze-objectives.ts';
import { abortable, nextPaint } from './controllers/scene-loading.ts';
import { captureGameplayPointer, captureGameplayKeys } from './controllers/browser-capture.ts';
import { stairAt } from '../shared/stairs.ts';
import { aimCamera } from './controllers/camera-aim.ts';
import { createPrediction } from './controllers/prediction.ts';
import { bindControlSettings } from './controllers/settings.ts';
import { InputController } from './controllers/input.ts';
import { Engine, FreeCamera, Vector3, SpotLight } from '../engine/babylon.ts';
import { createScene } from './render/scene.ts';
import { Avatar } from './render/avatar.ts';
import { ViewModel } from './render/viewmodel.ts';
import { Effects } from './render/effects.ts';
import { prepareMatchAssets } from './controllers/preload.ts';
import { PhysicsWorld, initPhysics } from '../engine/physics.ts';
import { defineMap, registerMap } from '../content/maps.ts';
import { parkourMaps } from '../content/parkour-maps.ts';
import { GameConnection } from '../network/client.ts';
import { createGameAudio } from './audio.js';
import { modeCatalog } from '../shared/modes.ts';
import { labels, makeLobby } from './lobby.js';
import { makeLobbyStage } from './render/lobby-stage.ts';
import { qualities, renderRatio } from './render-quality.ts';
import { drawHud, hud, weaponSlots } from './hud.js';
import { arenas } from '../shared/docks.js';
import { canCatch, ledge, sight, MANTLE_TIME } from '../shared/world.js';
import {
  bowMinDraw,
  characterPosture,
  harborBody,
  harborMode,
  weapons,
  weaponSounds,
} from '../shared/arsenal.ts';
const $ = (id) => document.getElementById(id);
const difficultyLabels = { easy: '轻松', normal: '标准', hard: '挑战' };
const results = {
  'load-failed': '有人未能完成场景载入，请重试。',
  'parkour-ended': '挑战结束 · 返回工坊继续调整路线',
  secured: '五波突袭全部清除 · 小队胜利',
  overrun: '小队全员倒下 · 再配合试一次',
  escaped: '逃生者打开出口了！',
  caught: '怪物抓到了所有逃生者。',
  survived: '时间到，还有人躲过了怪物。',
  timeout: '时间到，出口关闭了。',
  left: '有人离开，本局已结束。',
};
let input;
const isActive = () =>
  !document.hidden &&
  (!!document.pointerLockElement || !!input?.gamepadActive || !!input?.pointerFallback);
const noShots = [];
let socket,
  room,
  mode,
  scene,
  renderer,
  camera,
  map,
  self,
  serverSelf,
  state,
  frame,
  props,
  avatars,
  lastFrame,
  lastPulse = 0;
let weaponView,
  weaponEffects,
  harbor,
  exit,
  stride = 0,
  lastStep = 0;
const sound = createGameAudio(() => yaw);
const { footstep } = sound;
let torch,
  alternateRoute = false,
  routeKey;
let lastWeapon = 'bow',
  returnFromThrow;
let selected = 'bow',
  charging = 0,
  bowReadyAt = 0,
  pendingFire,
  raiseUntil = 0;
let sceneTask = Promise.resolve(),
  sceneAbort;
let fireHeld = false,
  nextAuto = 0,
  scopeHeld = false,
  scopeLatched = false,
  scopeBlend = 0,
  flashAnimation;
let physics, visual, prediction;
const creatingAvatars = new Set();
let matchKit;
const setup = $('deployment');
const lobbyStage = makeLobbyStage($('lobby-stage'));
let previewSlot = 'primary',
  previewMode = 'survival';
function previewEquipment() {
  const kit = kitChoice();
  const port = harborMode(previewMode);
  $('preview-weapons').hidden = previewMode === 'parkour';
  const weapon =
    previewMode === 'parkour'
      ? undefined
      : previewMode === 'gungame'
        ? 'pistol'
        : port
          ? previewSlot === 'pistol'
            ? 'pistol'
            : kit[previewSlot]
          : { primary: 'bow', pistol: 'cannon', throwable: 'flash' }[previewSlot];
  $('preview-weapons').querySelector('[data-preview=pistol]').textContent = port ? 'M1911' : '火炮';
  lobbyStage.appearance({ character: kit.character, weapon });
}
$('preview-weapons').onclick = (event) => {
  const button = event.target.closest('[data-preview]');
  if (!button) return;
  previewSlot = button.dataset.preview;
  for (const item of $('preview-weapons').children)
    item.setAttribute('aria-pressed', String(item === button));
  previewEquipment();
};
lobbyStage.active(true);
const menu = makeLobby({
  join: (id) => connect({ type: 'join', room: id }),
  reconnect: () => connect(),
  rename: (name) => send({ type: 'hello', name }),
  selection: (value) => {
    previewMode = value;
    previewEquipment();
  },
});
let lastReportedError = -Infinity;
function reportError(message) {
  const now = performance.now();
  if (now - lastReportedError < 5000) return;
  lastReportedError = now;
  send({ type: 'client-error', message: String(message).slice(0, 240) });
}
function clientFailure(message) {
  reportError(message);
  if (!frame) return;
  lobbyView();
  send({ type: 'leave' });
  status('场景发生异常，已返回大厅，可以重新加入。');
}
addEventListener('error', (event) => {
  if (event.message)
    clientFailure(
      event.message + ' · ' + (event.filename?.split('/').at(-1) ?? '') + ':' + event.lineno,
    );
});
addEventListener('unhandledrejection', (event) =>
  clientFailure(event.reason?.message ?? event.reason),
);
function kitChoice() {
  return Object.fromEntries(new FormData(setup));
}
setup.onsubmit = (event) => event.preventDefault();
setup.onchange = () => {
  previewEquipment();
  send({ type: 'deployment', ...kitChoice() });
};
function cancelCharge() {
  pendingFire = undefined;
  fireHeld = false;
  scopeHeld = scopeLatched = false;
  if (charging) send({ type: 'weapon-cancel' });
  charging = 0;
}
function equip(name) {
  if (selected === name) return;
  if (weapons[name].projectile !== 'grenade') lastWeapon = name;
  selected = name;
  raiseUntil = 0;
  send({ type: 'weapon-select', weapon: name });
}
function fireWeapon(name) {
  if (
    movementLocked() ||
    state.phase !== 'hunt' ||
    self.mantle ||
    serverSelf.reload ||
    !serverSelf.ammo?.[name]
  )
    return false;
  send({ type: 'input', yaw, ...inputs() });
  send({ type: 'weapon-fire', weapon: name, pitch: pitch + recoilPitch });
  return true;
}
function raiseAndFire(name) {
  if (
    pendingFire ||
    movementLocked() ||
    state.phase !== 'hunt' ||
    self.mantle ||
    serverSelf.reload ||
    !serverSelf.ammo?.[name]
  )
    return;
  const now = performance.now();
  if (weapons[name].projectile === 'bullet') {
    if (fireWeapon(name)) nextAuto = now + weapons[name].cooldown + 6;
  } else {
    pendingFire = { name, at: now + 155 };
  }
  raiseUntil = now + 390;
}
let jumpSeq = 0,
  jumpAt = 0,
  eyeHeight = 1.16,
  notice = '',
  noticeUntil = 0;
let resolutionScale = 1,
  frameWindow = 0,
  frameSamples = 0,
  sampleTime = 0;
let quality = localStorage.getItem('maze-quality') || 'balanced';
if (!Object.hasOwn(qualities, quality)) quality = 'balanced';
function setQuality() {
  $('quality').textContent = '画质 · ' + qualities[quality].label;
}
setQuality();
$('quality').onclick = () => {
  const options = Object.keys(qualities);
  quality = options[(options.indexOf(quality) + 1) % options.length];
  localStorage.setItem('maze-quality', quality);
  setQuality();
  lobbyStage.quality(qualities[quality].ratio);
};
let yaw = 0,
  pitch = 0,
  recoilPitch = 0;
const gunKick = { rifle: 0.017, pistol: 0.027, sniper: 0.042 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let hitAnimation, damageAnimation;
function showHit(knockdown = false, headshot = false) {
  if (!harbor) return;
  const marker = $('hit-marker');
  marker.classList.toggle('knockdown', knockdown);
  marker.classList.toggle('headshot', headshot);
  hitAnimation?.cancel();
  hitAnimation = marker.animate(
    [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.33 }, { opacity: 0 }],
    { duration: knockdown ? 320 : 160 },
  );
}
function status(message) {
  $('status').textContent = message;
}
function send(m) {
  if (socket) void socket.send(m);
}
function inputs() {
  return input?.movement() ?? { f: false, b: false, l: false, r: false, run: false, quiet: false };
}
function lobbyView(showLobby = true) {
  sceneAbort?.abort();
  sceneAbort = undefined;
  input?.suspend();
  cancelCharge();
  $('loading-screen').hidden = true;
  sound.stopBreathing();
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  if (document.pointerLockElement) document.exitPointerLock();
  if (scene) {
    for (const avatar of avatars?.values() ?? []) avatar.dispose();
    weaponEffects?.dispose();
    weaponView?.dispose();
    weaponEffects = weaponView = undefined;
    prediction?.dispose();
    prediction = undefined;
    physics?.dispose();
    physics = undefined;
    visual?.dispose();
    visual = undefined;
    flashAnimation?.cancel();
    hitAnimation?.cancel();
    damageAnimation?.cancel();
    scene = undefined;
  }
  $('route').hidden = true;
  harbor = torch = undefined;
  $('play').hidden = true;
  $('lobby').hidden = false;
  lobbyStage.active(showLobby);
}
function connect(message) {
  if (message) $('match-result').hidden = true;
  if (socket && !socket.connected) {
    void socket.close();
    socket = undefined;
    room = undefined;
  }
  if (socket) {
    if (message && socket.connected && !room) {
      menu.busy(true);
      send(message);
    }
    return;
  }
  status('正在连接…');
  $('connection-state').textContent = '正在连接…';
  $('reconnect').hidden = true;
  let assets = Promise.resolve(),
    ready = false,
    roundVersion = 0,
    assetRevision = -1,
    assetVersion = 0,
    latestState;
  const ws = new GameConnection(
    (m) => {
      if (socket && socket !== ws) return;
      if (m.type === 'connection-lost') {
        input?.suspend();
        cancelCharge();
        notice = '连接中断，正在重连…';
        noticeUntil = performance.now() + 20000;
      }
      if (m.type === 'welcome') menu.welcome(m.name);
      if (m.type === 'directory') {
        menu.directory(m);
        return;
      }
      if (m.type === 'left') {
        roundVersion++;
        assetVersion++;
        assetRevision = -1;
        room = undefined;
        ready = false;
        lobbyView();
        menu.room(false);
        history.replaceState(null, '', location.pathname);
        return;
      }
      if (m.type === 'error') {
        menu.busy(false);
        status(m.message);
      }
      if (m.type === 'lobby') {
        if (room !== m.room) {
          setup.reset();
          previewEquipment();
          assetRevision = -1;
        }
        if (assetRevision !== m.revision) {
          assetRevision = m.revision;
          const version = ++assetVersion;
          ready = false;
          status('正在加载场景和角色…');
          assets = nextPaint()
            .then(() => prepareMatchAssets(m))
            .then(() => {
              if (socket !== ws || version !== assetVersion) return;
              ready = true;
              send({ type: 'assets-ready', revision: m.revision });
            })
            .catch((error) => {
              if (socket !== ws || version !== assetVersion) return;
              console.error(error);
              status('素材载入失败，请返回大厅后重试。');
            });
        }
        room = m.room;
        mode = m.mode;
        if (previewMode !== mode) {
          previewMode = mode;
          previewEquipment();
        }
        menu.room(true);
        menu.members(m.members, m.host, m.mode);
        $('roster').textContent =
          labels[mode] +
          (m.arena
            ? ' · ' +
              (arenas[m.arena]?.name ?? parkourMaps[m.arena]?.name ?? '自建地图') +
              (m.blackout ? ' · 断电' : '')
            : '') +
          ' · ' +
          m.count +
          ' / ' +
          m.maxPlayers +
          ' 人' +
          (m.aiCount < 0 ? ' · AI 自动补位（单人 1 / 多人 0）' : ' · ' + m.aiCount + ' 名 AI') +
          (m.doubleJump ? ' · 二段跳 ' + Math.round(m.airJumpHeight * 100) + '%' : ' · 单次跳跃');
        $('rules').hidden = false;
        $('rules').textContent = modeCatalog[mode]?.tip ?? '';
        $('room-goal').textContent = modeCatalog[mode]?.win ?? '单人练习';
        $('room-tag').textContent =
          (modeCatalog[mode]?.category ?? '练习') + ' / ' + (modeCatalog[mode]?.duration ?? '');
        $('firearm-kit').hidden = !harborMode(mode) || mode === 'gungame';
        $('fixed-kit').hidden = mode !== 'gungame';
        $('difficulty-picker').hidden =
          !m.host || (mode !== 'survival' && !m.aiCount) || mode === 'practice';
        menu.difficulty(m);
        $('start').hidden = !m.host;
        $('start').disabled = !ready || m.members.some((member) => !member.ready);
        $('start').textContent = m.count === 1 ? '开始行动' : '开始多人对局';
        if (!m.active && frame) lobbyView();
        if (!m.active && ready && m.members.every((member) => member.ready)) {
          status(m.host ? '装备就绪，随时可以出发。' : '已就绪，等待房主开始。');
          if (mode === 'practice' && m.host && !ws.started) {
            ws.started = true;
            send({ type: 'start' });
          }
        }
      }
      if (m.type === 'start') {
        const version = ++roundVersion;
        latestState = undefined;
        $('loading-screen').hidden = false;
        assets
          .then(async () => {
            await nextPaint();
            if (!ready || socket !== ws || version !== roundVersion) return;
            sceneTask = sceneTask
              .catch(() => {})
              .then(async () => {
                if (socket !== ws || version !== roundVersion) return;
                await play(m);
                if (socket !== ws || version !== roundVersion) lobbyView();
              });
            await sceneTask;
            if (socket !== ws || version !== roundVersion) return;
            if (latestState) {
              state = latestState;
              serverSelf = latestState.self;
            }
            $('loading-screen').hidden = true;
            send({ type: 'scene-ready' });
          })
          .catch((err) => {
            if (socket !== ws || version !== roundVersion) return;
            console.error(err);
            reportError('Renderer: ' + err.message);
            lobbyView();
            status('场景启动失败，请返回大厅后重试。');
          });
        return;
      }
      if (m.type === 'state' && !frame) latestState = m;
      if (m.type === 'state' && frame) {
        if (m.parkour && state?.parkour) {
          if (m.parkour.checkpoint > state.parkour.checkpoint) {
            sound.play('score', 0.22);
            notice = '已通过路段';
            noticeUntil = performance.now() + 2000;
          } else if (m.parkour.coins > state.parkour.coins) sound.play('score', 0.12);
        }
        if (m.duel && state?.duel) {
          if (m.duel.scores.some((value, i) => value !== state.duel.scores[i]))
            sound.play('score', 0.18);
          else if (m.duel.possession === 'self' && state.duel.possession !== 'self')
            sound.play('flash-bounce', 0.2);
          else if (m.duel.possession === 'opponent' && state.duel.possession === 'self')
            sound.play('flash-bounce', 0.13);
        }
        state = m;
        serverSelf = m.self;
        if (m.self.currentWeapon && selected !== m.self.currentWeapon) {
          cancelCharge();
          equip(m.self.currentWeapon);
          for (const slot of weaponSlots)
            slot.hidden = slot.dataset.weapon !== m.self.currentWeapon;
          notice = '当前武器 · ' + weapons[m.self.currentWeapon].label;
          noticeUntil = performance.now() + 1800;
        }
        for (const sound of m.noises) footstep(sound);
      }
      if (!frame && m.type !== 'end') return;
      if (m.type === 'hint') {
        notice = m.message;
        noticeUntil = performance.now() + 1700;
      }
      if (m.type === 'weapon-effect') {
        const now = performance.now();
        weaponEffects?.effect(m, now);
        if (m.own && m.effect === 'launch') {
          weaponView?.launch(m.weapon, now);
          if (gunKick[m.weapon] && !reducedMotion.matches)
            recoilPitch = Math.min(0.08, recoilPitch + gunKick[m.weapon]);
          if (weapons[m.weapon].projectile === 'grenade')
            returnFromThrow = { name: m.weapon, at: now + 440 };
        }
        const point = m.point;
        if (
          self &&
          !m.silent &&
          !(weapons[m.weapon].projectile === 'grenade' && m.effect === 'launch' && !m.own)
        ) {
          const bearing = point
            ? Math.atan2(self.x - point.x, self.z - point.z) / (Math.PI / 4)
            : undefined;
          const gain = m.own
            ? 0.72
            : point
              ? Math.max(0.14, 1 - Math.hypot(point.x - self.x, point.z - self.z) / 19)
              : 0.16;
          const clip = weaponSounds[m.weapon]?.[m.effect];
          const volume =
            m.effect === 'bounce'
              ? 0.22
              : weapons[m.weapon].projectile === 'bullet'
                ? 0.26
                : m.weapon === 'bow'
                  ? 0.4
                  : 0.49;
          sound.play(clip, volume * gain, bearing, point ? 11500 : 1250);
        }
      }
      if (m.type === 'weapon-confirm') {
        showHit(false, m.region === 'head');
        notice =
          (m.region === 'head' ? '爆头' : m.region === 'legs' ? '腿部命中' : '命中') +
          (m.damage ? ' · ' + m.damage : '');
        noticeUntil = performance.now() + 700;
      }
      if (m.type === 'parkour-launch') {
        weaponView?.launch('cannon', performance.now());
        raiseUntil = performance.now() + 400;
        sound.play('cannon-shot', 0.18);
      }
      if (m.type === 'parkour-impact') {
        void weaponEffects?.effect(
          { weapon: 'cannon', effect: 'burst', point: m.point },
          performance.now(),
        );
        sound.play('flash-bounce', 0.2);
      }
      if (m.type === 'parkour-bump') {
        notice = '被摆锤击退 · 等它摆开再通过';
        noticeUntil = performance.now() + 1500;
      }
      if (m.type === 'parkour-fall') {
        sound.play('fall-scream', 0.3);
        notice = '坠落 · 返回起点，金币与道具清空';
        noticeUntil = performance.now() + 2000;
      }
      if (m.type === 'knockdown') {
        showHit(true, m.region === 'head');
        notice = state.duel?.survival
          ? '清除突袭者'
          : state.duel?.skirmish
            ? '淘汰对手'
            : '击倒对手 · 核心仍可争夺';
        if (m.region === 'head') notice = '爆头 · ' + notice;
        noticeUntil = performance.now() + 1350;
      }
      if (m.type === 'weapon-hit') {
        if (harbor) {
          damageAnimation?.cancel();
          const hit = $('damage-vignette');
          const angle = Number.isFinite(m.bearing) ? yaw - m.bearing : 0;
          hit.style.setProperty('--hit-x', 50 + 44 * Math.sin(angle) + '%');
          hit.style.setProperty('--hit-y', 50 - 44 * Math.cos(angle) + '%');
          hit.classList.toggle('directed', Number.isFinite(m.bearing));
          damageAnimation = hit.animate(
            [{ opacity: Math.min(0.92, 0.32 + (m.damage ?? 0) / 85) }, { opacity: 0 }],
            { duration: 360 },
          );
          if (m.damage) {
            serverSelf = { ...serverSelf, health: m.health };
            hud('health-loss', '−' + m.damage);
            $('health-loss')
              .getAnimations()
              .forEach((animation) => animation.cancel());
            $('health-loss').animate(
              [{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
              { duration: 650 },
            );
          }
        }
        notice = weapons[m.weapon].label + ' · 你被击中';
        noticeUntil = performance.now() + 750;
      }
      if (m.type === 'weapon-reload') {
        sound.play(weaponSounds[m.weapon]?.reload, 0.32);
      }
      if (m.type === 'flash') {
        flashAnimation?.cancel();
        flashAnimation = $('flash').animate(
          [
            { opacity: m.strength, offset: 0 },
            { opacity: m.strength, offset: 0.12 },
            { opacity: m.strength * 0.66, offset: 0.39 },
            { opacity: m.strength * 0.24, offset: 0.7 },
            { opacity: 0 },
          ],
          { duration: m.duration ?? 1500 },
        );
      }
      if (m.type === 'caught') {
        serverSelf = { ...serverSelf, alive: false };
        $('capture-label').textContent = '巡猎者近身抓住了你';
        if (document.pointerLockElement) document.exitPointerLock();
      }
      if (m.type === 'end') {
        roundVersion++;
        lobbyView();
        $('match-result').hidden = false;
        if (m.result === 'duel') {
          const result = m.winner === null ? '平局' : m.winner === m.side ? '你赢了' : '对手获胜';
          $('match-result').textContent =
            result +
            ' · ' +
            m.scores[m.side] +
            ' : ' +
            m.scores[1 - m.side] +
            '　调整装备，再来一局。';
        } else if (m.parkour) {
          const best = m.parkour.standings[0]?.coins ?? 0;
          const winners = m.parkour.standings.filter((p) => p.coins === best).map((p) => p.name);
          $('match-result').textContent =
            (winners.length > 1 ? '并列第一：' : '金币冠军：') +
            winners.join('、') +
            ' · ' +
            best +
            ' 枚；你的金币 ' +
            m.parkour.coins;
        } else $('match-result').textContent = results[m.result] ?? '本局结束';
      }
    },
    (connected, message) => {
      menu.connected(connected);
      status(message ?? '');
      if (connected && messageToSend) {
        send(messageToSend);
        messageToSend = undefined;
      }
    },
  );
  socket = ws;
  let messageToSend = message;
  void ws.connect($('player-name').value);
}

async function play(m) {
  $('match-result').hidden = true;
  lobbyView(false);
  const abort = new AbortController();
  sceneAbort = abort;
  const wait = (task) => abortable(task, abort.signal);
  lobbyStage.active(false);
  $('loading-screen').hidden = false;
  if (!renderer) {
    const canvas = document.createElement('canvas');
    $('play').append(canvas);
    renderer = new Engine(canvas, true, { powerPreference: 'high-performance' });
  }
  map = m.map;
  mode = m.mode;
  exit = m.exit;
  self = { ...m.self, kit: m.kit, input: inputs(), vx: 0, vz: 0, recovery: 0, exhausted: false };
  jumpSeq = m.self.jumpAck ?? 0;
  jumpAt = noticeUntil = 0;
  eyeHeight = m.duel ? harborBody.standing.eye : self.monster ? 1.39 : 1.16;
  alternateRoute = false;
  routeKey = undefined;
  serverSelf = m.self;
  state = {
    phase: 'hunt',
    remaining: m.remaining,
    players: [],
    switches: m.switches ?? [],
    duel: m.duel,
    parkour: m.parkour,
  };
  if (m.definition) {
    m.definition.grid = map;
    registerMap(m.definition);
  }
  yaw = m.self.yaw;
  pitch = recoilPitch = 0;
  visual = createScene(renderer, m.definition ?? defineMap(map, m.arena), !!m.duel?.blackout);
  scene = visual.scene;
  const visualReady = visual.ready;
  visualReady.catch(() => {});
  physics = new PhysicsWorld(m.definition ?? defineMap(map, m.arena), await wait(initPhysics()));
  prediction = createPrediction(socket.activeRoom, self, physics);
  camera = new FreeCamera('player', Vector3.Zero(), scene);
  camera.fov = (72 * Math.PI) / 180;
  camera.minZ = 0.065;
  camera.maxZ = 90;
  props = m.exit
    ? await wait(
        mazeObjectives(visual.assets, m.definition ?? defineMap(map, m.arena), m.switches, m.exit),
      )
    : [];
  harbor = !!m.duel;
  $('route').hidden = !harbor || m.duel.skirmish;
  $('enemy').hidden = true;
  avatars = new Map();
  creatingAvatars.clear();
  if (m.duel?.blackout) {
    torch = new SpotLight('flashlight', Vector3.Zero(), new Vector3(0, 0, -1), 0.65, 2, scene);
    torch.parent = camera;
    torch.intensity = 0;
  }
  matchKit = m.kit;
  selected = lastWeapon =
    mode === 'parkour' ? 'cannon' : m.self.currentWeapon || (harbor ? matchKit.primary : 'bow');
  returnFromThrow = undefined;
  charging = bowReadyAt = raiseUntil = scopeBlend = nextAuto = 0;
  pendingFire = undefined;
  fireHeld = scopeHeld = scopeLatched = false;
  for (const slot of weaponSlots) {
    slot.hidden =
      !Object.hasOwn(m.self.ammo, slot.dataset.weapon) ||
      (slot.dataset.arena && slot.dataset.arena !== (harbor ? 'port' : 'maze'));
    if (slot.dataset.weapon === 'pistol')
      slot.querySelector('kbd').textContent = mode === 'gungame' ? '1' : '2';
  }
  $('scope').hidden = true;
  $('crosshair').classList.toggle('fps-reticle', !!harbor);
  $('weapons').hidden = self.monster || mode === 'parkour';
  $('vitals').hidden = !harbor;
  weaponView = self.monster ? null : new ViewModel(renderer);
  if (weaponView)
    await wait(
      weaponView.prepare(
        mode === 'parkour' ? ['cannon'] : Object.keys(m.self.ammo),
        mode === 'parkour',
      ),
    );
  weaponEffects = new Effects(scene, visual.assets);
  $('lobby').hidden = true;
  $('play').hidden = false;
  $('capture-label').textContent = '点击进入 · ' + labels[mode];
  $('capture-mission').textContent = modeCatalog[mode]?.win ?? '';
  $('capture-controls').textContent =
    mode === 'parkour'
      ? 'WASD / 左摇杆移动 · Space / A 跳跃 · Shift / L3 冲刺'
      : harbor
        ? 'WASD 移动 · Shift 冲刺 · Ctrl 蹲下 · R 换弹 · E 补弹'
        : 'WASD 移动 · Space 跳跃' +
          (self.climbable ? ' / 翻墙' : '') +
          (self.monster ? ' · E / 左键近身抓捕' : ' · E 交互 · 右键拉弓，左键放箭');
  if (self.maxJumps === 2) $('capture-controls').textContent += ' · 空中再按跳跃：二段跳';
  $('capture').hidden = false;
  $('role').textContent =
    mode === 'parkour'
      ? '跃迁挑战'
      : harbor
        ? '02 / ' + (arenas[m.arena]?.name ?? parkourMaps[m.arena]?.name ?? '自建地图')
        : self.monster
          ? '◆ 巡猎者'
          : '◈ 逃生者';
  if (m.solo) $('role').textContent += ' · AI ' + difficultyLabels[m.difficulty];
  const prepared = scene;
  renderer.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, qualities[quality].ratio));
  renderer.resize();
  await wait(
    Promise.all([visualReady, scene.whenReadyAsync(), weaponView?.scene.whenReadyAsync()]),
  );
  if (scene !== prepared) return;
  lastFrame = performance.now();
  lastPulse = 0;
  stride = 0;
  lastStep = 0;
  resolutionScale = 1;
  frameWindow = frameSamples = sampleTime = 0;
  frame = requestAnimationFrame(draw);
}

function interaction() {
  if (!serverSelf.alive || !isActive()) return '';
  if (self.mantle) return '正在翻越';
  if (state.phase !== 'hunt') return '';
  if (mode === 'parkour')
    return state.parkour?.finishedAt
      ? '已登顶 · 继续收集金币，时间到按金币结算'
      : state.parkour?.next
        ? self.maxJumps === 2
          ? '沿路线攀登 · 空中再按空格 / A 二段跳 · 落地前可接跳'
          : '沿路线攀登 · 空格跳跃 / Shift 冲刺 · 落地前可接跳'
        : '';
  const near = (p, r) =>
    Math.hypot(p.x - self.x, (p.y || 0) - self.y, p.z - self.z) < r &&
    sight(map, self, p, self.climbable);
  const duel = state.duel;
  if (duel) {
    if (duel.survival && state.players.some((p) => p.friendly && p.rescueAvailable && near(p, 1.6)))
      return 'E / X · 救起队友（50 HP，每波一次）';
    if (duel.skirmish) return state.pickups?.some((p) => near(p, 0.95)) ? 'E · 补充弹药' : '';
    if (duel.possession === 'ground' && near(duel.core, 0.9)) return 'E · 拾取核心';
    if (
      duel.possession === 'self' &&
      (near(duel.drop, 1.05) || (duel.alternate && near(duel.alternate, 1.05)))
    )
      return 'E · 交付核心';
    const carrier = state.players.find((p) => p.carrying);
    if (carrier && near(carrier, 1.25)) {
      if (duel.protected) return '对手刚拿到核心，暂时无法反抢';
      const dx = carrier.x - self.x,
        dz = carrier.z - self.z;
      return -Math.sin(yaw) * dx - Math.cos(yaw) * dz >= 0.35 * Math.hypot(dx, dz)
        ? 'E · 夺回核心'
        : '面对对手 · E 夺回核心';
    }
    return state.pickups?.some((p) => near(p, 0.95)) ? 'E · 补充弹药' : '';
  }
  const climbPrompt = ledge(map, self) ? '空格 · 翻上墙顶' : '';
  if (self.monster)
    return state.players.some((p) => !p.monster && canCatch(map, self, p, yaw))
      ? 'E · 抓捕'
      : climbPrompt;
  if (state.switches.some((p) => !p.on && near(p, 0.85))) return 'E · 拉下电闸';
  if (near(exit, 0.85))
    return state.switches.every((p) => p.on) ? 'E · 从这里撤离' : '闸门锁定 · 需要两处电源';
  return climbPrompt;
}
function movementLocked() {
  return state.phase === 'caught' || !serverSelf.alive || serverSelf.stunned;
}

function draw(now) {
  const elapsed = now - lastFrame;
  const active = isActive();
  if (!active && elapsed < 32) {
    frame = requestAnimationFrame(draw);
    return;
  }
  const dt = Math.min(0.05, elapsed / 1000);
  lastFrame = now;
  self.input = inputs();
  self.yaw = yaw;
  const frozen = movementLocked(),
    prevX = camera.position.x,
    prevZ = camera.position.z,
    wasGrounded = self.grounded;
  const movementInput =
    frozen || !active
      ? { f: false, b: false, l: false, r: false, run: false, quiet: false, moveX: 0, moveZ: 0 }
      : self.input;
  const pose = prediction.frame(now, movementInput, yaw, jumpSeq);
  const climbing = !!self.mantle;
  const travel = Math.hypot(pose.x - prevX, pose.z - prevZ);
  const distance = travel < 1 ? travel : 0;
  sound.updateBreathing(active, serverSelf);
  if (!wasGrounded && self.grounded && active) footstep({ heavy: true, gain: 0.7 });
  if (distance > 0.001 && self.grounded) {
    stride += distance * 8.5;
    if (!self.input.quiet && now - lastStep > (self.input.run ? 285 : 420)) {
      footstep({ heavy: self.monster, stairs: !!stairAt(physics.map, self) });
      lastStep = now;
    }
  }
  const eye = self.monster ? 1.62 : characterPosture(matchKit.character, self.input.quiet).eye;
  const movement = Math.min(1, distance / Math.max(dt, 0.001) / 3.25);
  const bob = self.grounded && mode !== 'parkour' ? Math.sin(stride) * 0.014 * movement : 0;
  eyeHeight = eyeHeight + (eye + bob - eyeHeight) * Math.min(1, dt * 12);
  camera.position.set(pose.x, eyeHeight + pose.y, pose.z);
  const pull = self.mantle ? Math.sin((Math.PI * self.mantle.elapsed) / MANTLE_TIME) : 0;
  recoilPitch *= Math.exp(-dt * 13);
  aimCamera(camera, yaw, pitch + recoilPitch);
  if (torch) {
    torch.intensity = state.duel.light ? 28 : 0;
    torch.range = 8;
  }
  if (movementLocked() || self.mantle || !active) cancelCharge();
  if (pendingFire && now >= pendingFire.at) {
    fireWeapon(pendingFire.name);
    nextAuto = now + weapons[pendingFire.name].cooldown + 6;
    pendingFire = undefined;
  } else if (
    mode !== 'parkour' &&
    fireHeld &&
    weapons[selected].auto &&
    !pendingFire &&
    now >= nextAuto
  ) {
    if (fireWeapon(selected)) raiseUntil = now + 240;
    nextAuto = now + weapons[selected].cooldown + 6;
  }
  if (returnFromThrow && now >= returnFromThrow.at) {
    const { name } = returnFromThrow;
    returnFromThrow = undefined;
    if (selected === name && !serverSelf.ammo?.[name]) equip(lastWeapon);
  }
  const aimingScope =
    (scopeHeld || scopeLatched) && weapons[selected].scope && !serverSelf.reload && active;
  scopeBlend += (Number(!!aimingScope) - scopeBlend) * (1 - Math.exp(-dt * 20));
  const fov = 72 - 47 * scopeBlend;
  camera.fov = (fov * Math.PI) / 180;
  const scoped = scopeBlend > 0.76;
  $('scope').hidden = !scoped;
  $('crosshair').hidden = scoped;
  const charge = charging ? Math.min(1, (now - charging) / weapons.bow.charge) : 0;
  const reload = serverSelf.reload;
  const reloading = reload?.name === selected;
  const courseLauncher =
    mode === 'parkour' && ((state.parkour?.rockets ?? 0) > 0 || now < raiseUntil);
  $('crosshair').classList.toggle('rocket-reticle', courseLauncher);
  const showWeapon =
    weaponView && serverSelf.alive && !scoped && (mode !== 'parkour' || courseLauncher);
  if (showWeapon)
    weaponView.update(
      selected,
      mode === 'parkour' ? (state.parkour?.rockets ?? 0) : serverSelf.ammo?.[selected],
      charge,
      dt,
      now,
      stride,
      movement,
      Math.max(
        pull,
        self.input.run && !charging && now >= raiseUntil && !self.exhausted && !aimingScope
          ? 0.44
          : 0,
      ),
      Boolean(charging) || now < raiseUntil || reloading || scopeHeld,
      reloading ? 1 - reload.remaining / reload.duration : 0,
    );
  weaponEffects.update(
    state.shots ?? noShots,
    dt,
    now,
    state.pickups ?? noShots,
    state.smokes ?? noShots,
    camera.position,
  );
  const shown = new Set(state.players.map((p) => p.id));
  for (const [id, avatar] of avatars) {
    avatar.root.setEnabled(shown.has(id));
    if (!shown.has(id)) {
      avatar.hiddenSince ??= now;
      if (now - avatar.hiddenSince > 3000) {
        avatar.dispose();
        avatars.delete(id);
      }
    } else avatar.hiddenSince = undefined;
  }
  for (const p of state.players) {
    if (!avatars.has(p.id) && !creatingAvatars.has(p.id)) {
      creatingAvatars.add(p.id);
      const current = visual;
      void Avatar.create(current.assets, p)
        .then((avatar) => {
          if (current !== visual) {
            avatar.dispose();
            return;
          }
          avatars.set(p.id, avatar);
          for (const mesh of avatar.root.getChildMeshes()) {
            mesh.receiveShadows = true;
            current.shadow.addShadowCaster(mesh, false);
          }
        })
        .catch(console.error)
        .finally(() => creatingAvatars.delete(p.id));
    }
    const avatar = avatars.get(p.id);
    if (avatar) {
      avatar.update({ ...p, stair: physics.map.colliders.find((c) => c.id === p.stairs) }, dt);
      avatar.root.setEnabled(
        Math.hypot(
          avatar.root.position.x - camera.position.x,
          avatar.root.position.z - camera.position.z,
        ) > 0.55 || Math.abs(avatar.root.position.y - (camera.position.y - 1.6)) > 1.5,
      );
    }
  }
  const duel = state.duel;
  if (state.parkour)
    visual.updateParkour(
      state.parkour.collected,
      now,
      state.parkour.elapsed,
      state.parkour.itemsTaken,
      state.parkour.shots,
      !!state.parkour.trophyOwner,
    );
  if (duel?.core) {
    visual
      .marker('core', duel.core.x, duel.core.z, '#6ce0fa')
      .setEnabled(duel.possession === 'ground');
    visual.marker('drop', duel.drop.x, duel.drop.z, '#7fe3b4');
  }
  if (duel && !duel.skirmish) {
    if (routeKey !== duel.drop.name) {
      alternateRoute = false;
      routeKey = duel.drop.name;
    }
    const drop = alternateRoute && duel.alternate ? duel.alternate : duel.drop;
    const target = duel.possession === 'ground' ? duel.core : drop;
    const targetYaw = Math.atan2(self.x - target.x, self.z - target.z);
    const degrees = Math.round(((yaw - targetYaw) * 180) / Math.PI);
    $('route-arrow').style.transform = 'rotate(' + degrees + 'deg)';
    hud(
      'route-name',
      (duel.possession === 'ground' ? '核心' : '交付 · ' + drop.name + ' · T 换点') +
        ' · ' +
        Math.ceil(Math.hypot(target.x - self.x, target.z - self.z)) +
        ' m',
    );
  }
  drawHud({
    state,
    self,
    serverSelf,
    yaw,
    pitch: pitch + recoilPitch,
    eye: camera.position.y,
    scoped,
    props,
    mode,
    prompt: now < noticeUntil ? notice : interaction(),
    selected,
    weaponView,
    charging,
    charge,
    reloading,
    reload,
    torch,
  });
  if (active && elapsed > 0 && elapsed < 120 && !document.hidden) {
    frameWindow += elapsed;
    frameSamples++;
    if (frameWindow >= 1800) {
      const average = frameWindow / frameSamples;
      if (sampleTime && average > 23) resolutionScale = Math.max(0.7, resolutionScale - 0.1);
      if (sampleTime && average < 17.8) resolutionScale = Math.min(1, resolutionScale + 0.05);
      sampleTime = now;
      frameWindow = frameSamples = 0;
    }
  }
  const pixelRatio = renderRatio(devicePixelRatio, quality, resolutionScale);
  if (renderer.getHardwareScalingLevel() !== 1 / pixelRatio) {
    renderer.setHardwareScalingLevel(1 / pixelRatio);
    renderer.resize();
  }
  scene.render();
  if (showWeapon) weaponView.render();
  frame = requestAnimationFrame(draw);
}
$('open-editor').onclick = async () => {
  lobbyStage.active(false);
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem('maze-map-draft'));
  } catch {}
  try {
    const { openMapEditor } = await import('./editor/map-editor.ts');
    openMapEditor(
      draft,
      (map) =>
        connect({
          type: 'create',
          mode: 'parkour',
          arena: map.id,
          customMap: map,
          maxPlayers: Number($('max-players').value),
          aiCount: 0,
          doubleJump: $('double-jump').checked,
          airJumpHeight: Number($('air-jump-height').value),
        }),
      () => lobbyStage.active(true),
    );
  } catch (error) {
    console.error(error);
    status('地图工坊载入失败，请重试');
    lobbyStage.active(true);
  }
};
$('double-jump').onchange = () => {
  $('air-jump-height').disabled = !$('double-jump').checked;
};
$('create-room').onclick = () =>
  connect({
    type: 'create',
    mode: menu.selected(),
    arena: $('arena').value,
    blackout: $('blackout').checked,
    allowClimb: $('allow-climb').checked,
    maxPlayers: Number($('max-players').value),
    aiCount: menu.selected() === 'parkour' ? 0 : Number($('ai-count').value),
    doubleJump: $('double-jump').checked,
    airJumpHeight: Number($('air-jump-height').value),
  });
$('start').onclick = () => send({ type: 'start', difficulty: $('difficulty').value });
$('cancel-loading').onclick =
  $('leave').onclick =
  $('quit').onclick =
    () => {
      lobbyView();
      status('已返回联机大厅。');
      send({ type: 'leave' });
    };
let capturePending = false;
$('capture').onclick = async () => {
  if (!serverSelf?.alive || capturePending) return;
  capturePending = true;
  const canvas = renderer.getRenderingCanvas();
  try {
    const locked = await captureGameplayPointer(canvas, input.settings.immersive);
    if (!frame || !serverSelf?.alive) {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      return;
    }
    if (!locked) {
      input.suspend();
      $('capture').hidden = false;
      $('capture-label').textContent = '鼠标尚未锁定 · 点击重新进入';
      return;
    }
    input.pointerFallback = false;
    $('capture').hidden = true;
    sound.resume();
    await captureGameplayKeys(() => !!frame && document.pointerLockElement === canvas);
  } finally {
    capturePending = false;
  }
};
document.addEventListener('pointerlockchange', () => {
  $('capture').hidden = isActive();
  if (!isActive()) {
    input.suspend();
    cancelCharge();
    send({ type: 'input', yaw, ...inputs() });
  }
});
input = new InputController({
  playing: () => !!frame,
  paused: () => !isActive(),
  status: (message) => {
    $('controller-status').textContent = message;
  },
  look: (dx, dy) => {
    if (!frame || !isActive()) return;
    yaw = (yaw - dx * (1 - 0.57 * scopeBlend)) % (Math.PI * 2);
    pitch = Math.max(-1.45, Math.min(1.45, pitch - dy * (1 - 0.57 * scopeBlend)));
  },
  action: (action, down) => {
    if (!frame) return;
    if (action === 'activate' && down) {
      input.gamepadActive = true;
      $('capture').hidden = true;
      sound.resume();
      return;
    }
    if (action === 'pause' && down) {
      input.suspend();
      cancelCharge();
      if (document.pointerLockElement) document.exitPointerLock();
      $('capture').hidden = false;
      return;
    }
    if (action === 'fire' && !down) {
      fireHeld = false;
      return;
    }
    if (action === 'aim' && !down) {
      scopeHeld = false;
      if (charging) cancelCharge();
      return;
    }
    if (!down || !isActive() || movementLocked()) return;
    if (mode === 'parkour' && (action === 'fire' || action === 'grenade')) {
      fireHeld = action === 'fire';
      nextAuto = performance.now() + 220;
      send({ type: 'input', yaw, ...inputs() });
      send({ type: 'parkour-use', pitch });
      return;
    }
    if (action === 'jump') {
      jumpSeq++;
      return;
    }
    if (self.monster && action === 'fire') {
      send({ type: 'input', yaw, ...inputs() });
      send({ type: 'action' });
      return;
    }
    if (['interact', 'decoy', 'light'].includes(action)) {
      send({ type: 'input', yaw, ...inputs() });
      send({ type: { interact: 'action', decoy: 'decoy', light: 'light' }[action] });
      return;
    }
    if (action === 'route') {
      alternateRoute = !alternateRoute;
      return;
    }
    if (action === 'reload') {
      cancelCharge();
      send({ type: 'weapon-reload', weapon: selected });
      return;
    }
    const available = Object.keys(serverSelf.ammo ?? {});
    const weapon =
      action === 'cycle'
        ? available[(available.indexOf(selected) + 1) % available.length]
        : action === 'primary'
          ? mode === 'gungame'
            ? serverSelf.currentWeapon
            : harbor
              ? matchKit.primary
              : 'bow'
          : action === 'sidearm'
            ? harbor
              ? 'pistol'
              : 'cannon'
            : action === 'throwable' || action === 'grenade'
              ? harbor
                ? matchKit.throwable
                : 'flash'
              : null;
    if (weapon && available.includes(weapon)) {
      cancelCharge();
      equip(weapon);
      if (action === 'grenade') raiseAndFire(weapon);
      return;
    }
    if (!weaponView || serverSelf.reload || self.mantle) return;
    if (action === 'aim' && weapons[selected].projectile === 'bullet') {
      scopeHeld = true;
      return;
    }
    if (!serverSelf.ammo?.[selected]) {
      if (action === 'fire' && serverSelf.reserve?.[selected])
        send({ type: 'weapon-reload', weapon: selected });
      return;
    }
    if (selected === 'bow') {
      const now = performance.now();
      if (action === 'aim' && !charging && now >= bowReadyAt) {
        charging = now;
        sound.play(weaponSounds.bow.draw, 0.25);
        send({ type: 'weapon-ready', weapon: selected });
      }
      if (action === 'fire' && charging && now - charging >= bowMinDraw) {
        if (fireWeapon(selected)) {
          bowReadyAt = now + weapons.bow.cooldown + 40;
          raiseUntil = now + 260;
        }
        charging = 0;
      }
    } else if (action === 'fire') {
      fireHeld = !!weapons[selected].auto;
      raiseAndFire(selected);
    }
  },
});
bindControlSettings(input);
menu.connected(false);
const invite = new URLSearchParams(location.search).get('room');
connect();
addEventListener('resize', () => renderer?.resize());

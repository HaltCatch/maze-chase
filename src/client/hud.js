import { characters, characterPosture, weapons } from '../shared/arsenal.ts';
import { SPRINT_RESTART } from '../shared/world.js';

const $ = (id) => document.getElementById(id);
export const weaponSlots = [...document.querySelectorAll('[data-weapon]')];
export function hud(id, message) {
  const el = $(id);
  if (el.textContent !== message) el.textContent = message;
}

export function drawHud({
  state,
  self,
  serverSelf,
  yaw,
  pitch,
  eye,
  scoped,
  props,
  mode,
  prompt,
  selected,
  weaponView,
  charging,
  charge,
  reloading,
  reload,
  torch,
}) {
  const duel = state.duel;
  hud('action-feedback', prompt);
  $('parkour-board').hidden = !state.parkour;
  if (state.parkour) {
    const p = state.parkour;
    hud('parkour-height', p.height.toFixed(1));
    hud('parkour-best', `最高 ${p.highest.toFixed(1)} m / 终点 ${p.goalHeight.toFixed(1)} m`);
    hud('parkour-coins', `金币 ${p.coins} / ${p.coinTotal} · 路段 ${p.checkpoint} / ${p.total}`);
    const ranking = p.standings
      .map((r, i) => `${i + 1}. ${r.name} · ${r.highest.toFixed(1)} m · ${r.coins} 金币`)
      .join('\n');
    hud('parkour-ranks', ranking);
    hud(
      'parkour-items',
      `${p.shield ? '防撞护盾 ×1 · ' : ''}${p.rockets ? '冲击弹 ' + p.rockets + ' · 左键 / RT' : p.trophyOwner ? '奖杯已被领取 · 继续收集金币' : p.coins < p.coinTotal ? '收齐全部金币后可领取奖杯 · 顶部另有三发炮' : '金币已集齐 · 前往顶部领取奖杯'}`,
    );
  }
  // The server only includes a living opponent if the map permits sight. Keep the HUD near the aiming line.
  const enemy =
    duel &&
    state.players.find((p) => {
      const dx = p.x - self.x,
        dz = p.z - self.z,
        range = Math.hypot(dx, dz);
      if (p.downed || range <= 0.1 || range >= 19) return false;
      const posture = characterPosture(p.character, p.motion === 'crouch' || p.motion === 'hide');
      const targetPitch = Math.atan2((p.y ?? 0) + posture.height * 0.67 - eye, range);
      const facing = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / range;
      return (
        facing > (scoped ? 0.997 : 0.975) && Math.abs(pitch - targetPitch) < (scoped ? 0.15 : 0.3)
      );
    });
  $('enemy').hidden = !enemy || !serverSelf.alive || serverSelf.stunned;
  if (enemy && !$('enemy').hidden) {
    $('enemy-hp').value = enemy.health;
    hud(
      'enemy-label',
      (enemy.friendly ? '队友 · ' : enemy.bot ? 'AI · ' : '对手 · ') +
        (characters[enemy.character] ?? characters.operator) +
        '  ' +
        enemy.health,
    );
  }
  const powered = state.switches.filter((p) => p.on).length;
  for (const [i, device] of props.entries())
    device.set(i === state.switches.length ? powered === i : state.switches[i].on);
  const remaining = state.remaining;
  hud('clock', Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0'));
  hud(
    'objective',
    state.parkour
      ? `${state.parkour.jumpPickup ? (state.parkour.airJumpUnlocked ? '二段跳已解锁 · ' : '寻找弹簧以解锁二段跳 · ') : ''}路段 ${state.parkour.checkpoint} / ${state.parkour.total} · 坠落 ${state.parkour.falls} 次${state.parkour.finishedAt ? ' · 登顶 ' + (state.parkour.finishedAt / 1000).toFixed(2) + ' 秒' : ''}`
      : duel?.survival
        ? (duel.wave.pause
            ? '清波完成 · ' + duel.wave.next + ' 秒后补给并出发'
            : '第 ' +
              duel.wave.number +
              ' / ' +
              duel.wave.total +
              ' 波 · 剩余 ' +
              duel.wave.remaining +
              ' 名敌人') + (!serverSelf.alive ? ' · 等待救援或清波复活' : '')
        : duel
          ? (duel.overtime ? '加赛 · ' : '') +
            '你 ' +
            duel.scores[duel.side] +
            ' : ' +
            duel.scores[1 - duel.side] +
            ' 对手 · ' +
            (!serverSelf.alive
              ? '已倒下 · ' + Math.ceil(serverSelf.respawn / 1000) + ' 秒后复活'
              : serverSelf.stunned
                ? '视线受阻'
                : duel.gungame
                  ? '第 ' +
                    Math.min(3, Math.floor(duel.scores[duel.side] / 2) + 1) +
                    ' / 3 级 · ' +
                    weapons[serverSelf.currentWeapon].label +
                    ' · 再淘汰 ' +
                    (2 - (duel.scores[duel.side] % 2)) +
                    ' 次升级'
                  : duel.skirmish
                    ? '先拿下 ' + duel.goal + ' 次淘汰'
                    : duel.possession === 'self'
                      ? '去 ' + duel.drop.name + ' 或 ' + (duel.alternate?.name || duel.drop.name)
                      : duel.possession === 'opponent'
                        ? '拦截持芯者'
                        : '去抢核心' + (duel.returnIn ? ' · ' + duel.returnIn + ' 秒后回中场' : ''))
          : !serverSelf.alive
            ? '已被抓到'
            : serverSelf.stunned
              ? '视线受阻'
              : self.monster
                ? (powered === 2
                    ? '出口已通电 · 拦截逃生者'
                    : '电闸 ' + powered + '/2 · 巡逻 / 听脚步') + ' · E 抓捕'
                : '闸门供电 ' + powered + '/2',
  );

  $('squad-status').hidden = !duel?.survival;
  if (duel?.survival)
    hud(
      'squad-status',
      duel.wave.allies
        .filter((p) => !p.self)
        .map(
          (p) =>
            p.name +
            ' · ' +
            (p.alive
              ? p.health + ' HP'
              : p.rescueAvailable
                ? '倒下 · 靠近按 E / X 救援'
                : '倒下 · 清波后复活'),
        )
        .join('  /  '),
    );
  if (duel) {
    hud('health-label', duel.skirmish ? '生命' : '作战体力');
    hud('health', serverSelf.health + ' / 100');
    const healthMeter = $('health-meter');
    if (healthMeter.value !== serverSelf.health) {
      healthMeter.value = serverSelf.health;
      $('health-trail').style.width = serverSelf.health + '%';
    }
    $('vitals').classList.toggle('critical', serverSelf.health <= 25);
  }
  hud(
    'reload-label',
    reloading
      ? '正在换弹'
      : duel && weapons[selected].reload
        ? 'R 换弹' + (selected === 'sniper' ? ' · 右键开镜 / V 切换' : '')
        : '',
  );
  if (weaponView) {
    for (const slot of weaponSlots) {
      const name = slot.dataset.weapon;
      if (slot.hidden) continue;
      const rounds = serverSelf.ammo?.[name] ?? 0;
      const count = weapons[name].reload
        ? rounds + ' / ' + (serverSelf.reserve?.[name] ?? 0)
        : String(rounds);
      const output = slot.lastElementChild;
      if (output.textContent !== count) output.textContent = count;
      slot.classList.toggle('selected', name === selected);
    }
    const meter = $('bow-charge');
    meter.hidden = !charging;
    if (charging) meter.value = charge;
    hud('bow-controls', selected === 'bow' ? (charging ? '左键 · 放箭' : '按住右键 · 拉弓') : '');
    const reloadMeter = $('reload-progress');
    reloadMeter.hidden = !reloading;
    if (reloading) reloadMeter.value = 1 - reload.remaining / reload.duration;
  }
  const stamina = Math.max(0, Math.min(100, Math.round(serverSelf.energy * 100)));
  if ($('stamina').getAttribute('aria-valuenow') !== String(stamina)) {
    $('energy').style.width = stamina + '%';
    $('stamina').setAttribute('aria-valuenow', stamina);
  }
  $('stamina').classList.toggle('exhausted', !!serverSelf.exhausted);
  hud(
    'stamina-state',
    self.carrying
      ? '持芯 · 无法冲刺'
      : serverSelf.exhausted
        ? '喘息 · ' + stamina + ' / ' + Math.round(SPRINT_RESTART * 100) + '%'
        : serverSelf.recovery > 0 && !self.input.run
          ? '恢复中 · ' + stamina + '%'
          : stamina + '%',
  );
  hud(
    'torch',
    torch ? 'L · 手电 ' + (duel.light ? '开 ' : '关 ') + Math.round(duel.battery * 100) + '%' : '',
  );
  hud('decoy', duel ? (duel.hasDecoy ? 'Q · 声诱饵 ×1' : '声诱饵已用完') : '');
}

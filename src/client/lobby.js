import { arenas, docksMap } from '../shared/docks.js';
import { parkourMaps } from '../content/parkour-maps.ts';
import { modeCatalog, primaryModes } from '../shared/modes.ts';

export const labels = {
  ...Object.fromEntries(Object.entries(modeCatalog).map(([id, m]) => [id, m.name])),
  practice: '单人练习',
};
const $ = (id) => document.getElementById(id);
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function makeLobby({ join, reconnect, rename, selection }) {
  let selectedMode = 'survival';
  let previousAI = $('ai-count').value;
  let difficultyRoom;
  function directoryView(value) {
    $('server-browser').hidden = !value;
    $('operation-hub').hidden = value;
    $('mode-heading').hidden = value;
    $('friends-tab').setAttribute('aria-pressed', String(value));
    $('operations-tab').setAttribute('aria-pressed', String(!value));
  }
  $('friends-tab').onclick = () => directoryView(true);
  $('operations-tab').onclick = () => directoryView(false);
  const choices = $('choices');
  for (const id of primaryModes) {
    const mode = modeCatalog[id];
    const button = element('button', '', 'mode-card');
    button.dataset.mode = id;
    button.dataset.category = mode.category;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(icon.namespaceURI, 'use');
    use.setAttribute('href', '/icons.svg#' + mode.icon);
    icon.append(use);
    button.append(
      icon,
      element('small', mode.category + ' / ' + mode.tag),
      element('strong', mode.name),
      element('span', mode.description),
    );
    choices.append(button);
  }
  const selected = () => (selectedMode === 'skirmish' ? $('combat-variant').value : selectedMode);
  function brief() {
    const mode = modeCatalog[selected()];
    $('combat-variant-picker').hidden = selectedMode !== 'skirmish';
    selection?.(selected());
    for (const button of choices.children)
      button.setAttribute('aria-pressed', String(button.dataset.mode === selectedMode));
    $('brief-tag').textContent = mode.category + ' / ' + mode.tag;
    $('brief-title').textContent = mode.name;
    $('brief-description').textContent = mode.description;
    $('brief-win').textContent = mode.win;
    $('brief-duration').textContent = mode.duration;
    $('brief-tip').textContent = mode.tip;
    const maze = mode.category === '追逐',
      parkour = selectedMode === 'parkour';
    const catalog = parkour ? parkourMaps : arenas;
    if (!Object.hasOwn(catalog, $('arena').value))
      $('arena').replaceChildren(
        ...Object.entries(catalog).map(([id, m]) => new Option(m.name, id)),
      );
    if (parkour && !$('ai-count').disabled) {
      previousAI = $('ai-count').value;
      $('ai-count').value = '0';
    } else if (!parkour && $('ai-count').disabled) $('ai-count').value = previousAI;
    $('ai-count').disabled = parkour;
    $('ai-label').textContent = selectedMode === 'survival' ? 'AI 队友' : 'AI 数量';
    $('open-editor').hidden = !parkour;
    $('arena-picker').hidden = maze;
    $('blackout-picker').hidden = maze || parkour;
    $('climb-picker').hidden = !maze;
    const jumpPickup =
      parkour && catalog[$('arena').value].pickups?.some((p) => p.kind === 'double-jump');
    $('jump-settings').hidden = !!jumpPickup;
    $('double-jump').disabled = !!jumpPickup || (maze && !$('allow-climb').checked);
    if ($('double-jump').disabled) $('double-jump').checked = false;
    $('air-jump-height').disabled = !$('double-jump').checked;
    $('map-name').textContent = maze ? '随机砖厂 · 每局重排' : catalog[$('arena').value].name;
    $('map-preview').hidden = maze;
    $('maze-preview').hidden = !maze;
    if (parkour) {
      $('brief-duration').textContent = $('arena').value === 'ascent' ? '20 分钟' : '10 分钟';
      const map = catalog[$('arena').value],
        canvas = $('map-preview'),
        ctx = canvas.getContext('2d'),
        unit = canvas.width / map.size;
      ctx.fillStyle = '#14232a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const c of map.colliders) {
        ctx.fillStyle = '#799b9e';
        ctx.fillRect(
          (c.x - c.width / 2) * unit,
          (c.z - c.depth / 2) * unit,
          c.width * unit,
          c.depth * unit,
        );
      }
      for (const p of map.checkpoints) {
        ctx.fillStyle = '#ffcf79';
        ctx.beginPath();
        ctx.arc(p.x * unit, p.z * unit, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (!maze && !parkour) {
      const map = docksMap($('arena').value),
        canvas = $('map-preview'),
        ctx = canvas.getContext('2d');
      const unit = canvas.width / map.length;
      ctx.fillStyle = '#182722';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const [z, row] of map.entries())
        for (const [x, tile] of [...row].entries()) {
          ctx.fillStyle = tile === '#' ? '#8c9c8b' : tile === '+' ? '#d5ad76' : '#24382e';
          ctx.fillRect(x * unit + 1, z * unit + 1, unit - 2, unit - 2);
        }
      for (const [x, z, color] of [
        [12.5, 2.5, '#80d4bc'],
        [12.5, 22.5, '#df9f78'],
      ]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x * unit, z * unit, unit * 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  choices.onclick = (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) {
      selectedMode = button.dataset.mode;
      brief();
    }
  };
  $('arena').onchange = brief;
  $('combat-variant').onchange = brief;
  $('allow-climb').onchange = brief;
  $('mode-filters').onclick = (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    for (const filter of $('mode-filters').children)
      filter.setAttribute('aria-pressed', String(filter === button));
    for (const card of choices.children)
      card.hidden =
        button.dataset.category !== '全部' && card.dataset.category !== button.dataset.category;
    if (choices.querySelector('[aria-pressed="true"]')?.hidden) {
      selectedMode = [...choices.children].find((card) => !card.hidden).dataset.mode;
      brief();
    }
  };
  brief();
  let connected = false,
    busy = false,
    previous;
  function actions() {
    $('create-room').disabled = !connected || busy;
    for (const button of $('session-list').querySelectorAll('button[data-join]')) {
      button.disabled = !connected || busy;
    }
  }
  $('reconnect').onclick = reconnect;
  $('player-name').value = localStorage.getItem('maze-name') || '';
  $('player-name').onchange = () => {
    const name = $('player-name').value.trim();
    localStorage.setItem('maze-name', name);
    rename(name);
  };
  $('session-list').onclick = (event) => {
    const button = event.target.closest('button[data-join]');
    if (button) join(button.dataset.join);
  };
  return {
    selected,
    busy(value) {
      busy = value;
      actions();
    },
    connected(value) {
      connected = value;
      $('connection-state').textContent = value ? '已连接' : '连接已断开';
      $('connection-state').classList.toggle('online', value);
      $('reconnect').hidden = value;
      if (!value) {
        previous = undefined;
        $('online-count').textContent = '—';
        $('session-list').replaceChildren(
          element('p', '连接服务器后查看正在等待队友的房间。', 'empty-sessions'),
        );
      }
      actions();
    },
    welcome(name) {
      $('player-name').value = name;
    },
    directory(data) {
      $('online-count').textContent = data.online;
      $('lobby-online').textContent = data.online;
      const signature = JSON.stringify(data.rooms);
      if (signature === previous) return;
      previous = signature;
      const rows = data.rooms.map((room) => {
        const row = element('article', '', 'session-row');
        const badge = element(
          'span',
          modeCatalog[room.mode]?.category === '合作'
            ? '合'
            : modeCatalog[room.mode]?.category === '竞技'
              ? '竞'
              : '追',
          'session-badge',
        );
        const info = element('div', '', 'session-info');
        const title = element('strong', room.host + ' 的房间');
        const detail =
          labels[room.mode] +
          ' · ' +
          (arenas[room.arena]?.name ??
            parkourMaps[room.arena]?.name ??
            (room.mode === 'parkour' ? '自建地图' : '随机砖厂')) +
          (room.blackout ? ' · 断电' : '');
        info.append(title, element('span', detail));
        const count = element(
          'span',
          room.count + ' / ' + (room.maxPlayers || 2) + ' 人',
          'session-count',
        );
        const button = element(
          'button',
          room.joinable ? '加入对战 →' : room.playing ? '对战中' : '人数已满',
        );
        if (room.joinable) button.dataset.join = room.id;
        else button.disabled = true;
        row.append(badge, info, count, button);
        return row;
      });
      $('session-list').replaceChildren(
        ...(rows.length
          ? rows
          : [
              element(
                'p',
                '还没有房间。选择上方玩法创建一局，队友就能在这里加入。',
                'empty-sessions',
              ),
            ]),
      );
      $('room-count').textContent = data.rooms.length + ' 个房间';
      actions();
    },
    members(members, host, mode) {
      $('room-members').replaceChildren(
        ...members.map((member, i) => {
          const row = element('div', '', 'member');
          row.append(
            element('span', member.name + (i === 0 ? ' · 房主' : '')),
            element(
              'small',
              member.ready ? '已就绪' : '正在加载…',
              member.ready ? 'member-ready' : '',
            ),
          );
          return row;
        }),
      );
      if (members.length === 1) {
        const slot = element('div', '', 'member empty-member');
        slot.append(
          element('span', '等待队友加入'),
          element(
            'small',
            mode === 'parkour' ? '单人练习，或等待好友一起竞速' : '可单人开始，AI 数量由创建时选择',
          ),
        );
        $('room-members').append(slot);
      }
      $('room-hint').textContent = host
        ? '房间已出现在联机大厅，队友可直接加入。'
        : '选择装备，房主开始后即可进入对局。';
    },
    difficulty(m) {
      if (!m.host || difficultyRoom !== m.room) $('difficulty').value = m.difficulty;
      difficultyRoom = m.room;
    },
    room(value) {
      if (!value) difficultyRoom = undefined;
      $('lobby').classList.toggle('in-room', value);
      $('server-browser').hidden = true;
      $('friends-tab').disabled = value;
      $('operations-tab').disabled = value;
      $('friends-tab').setAttribute('aria-pressed', 'false');
      $('operations-tab').setAttribute('aria-pressed', 'true');
      $('mode-heading').hidden = value;
      $('room').hidden = !value;
      $('operation-hub').hidden = value;
      if (!value) brief();
      busy = false;
      actions();
    },
  };
}

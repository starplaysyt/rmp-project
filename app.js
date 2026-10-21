/* ══════════════════════════════════════════════════════════════════
   ВЕТКА СУДЬБЫ: НЕЙРО — app.js
   Движок: экраны, диалоги, проверки, ICE-взлом, магазины, сохранения.
   ══════════════════════════════════════════════════════════════════ */

(function () {
'use strict';

const S = window.STORY;
const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RUN_KEY  = 'neuro_run_v1';
const META_KEY = 'neuro_meta_v1';
const SLOT_KEY = n => 'neuro_slot_' + n;

const AVATARS = {
  kai:'◈', nicks:'◆', ren:'◉', iris:'✦', moro:'✚',
  silva:'▣', guard:'▲', voice:'◌', system:'▤', narrator:'│'
};

const DEFAULT_META = {
  settings: { speed: 80, font: 16, color: 'lime', sfx: 70, music: 40 },
  endings: {},
  runs: 0
};

const DEFAULT_STATE = () => ({
  started: false,
  finished: null,
  nodeId: 'd1_01',
  line: 0,
  day: 0,
  maxDay: 1,
  time: '08:14',
  scene: 'shelter',
  where: 'УБЕЖИЩЕ',
  location: 'shelter',
  force: 15, control: 62, memory: 78, hack: 3, chrome: 42,
  creds: 3200, humanity: 100,
  trust: { nicks: 71, ren: 48, iris: 22 },
  rep:   { street: 78, netrunners: 42, sylva: 12, relics: 0 },
  flags: {},
  items: [],
  implants: ['vetka', 'reflex'],
  audio: ['a1', 'a2'],
  archive: ['holod', 'rezon'],
  consequences: [],
  checkpoints: [],
  choices: [],
  rewinds: 0,
  cyberSeen: false,
  visited: {}
});

let state = DEFAULT_STATE();
let meta  = JSON.parse(JSON.stringify(DEFAULT_META));

const ui = {
  screen: 'screen-menu',
  stack: [],
  typing: false,
  typeTimer: null,
  fullText: '',
  skipType: false,
  ice: null,
  iceTimer: null,
  audioTimer: null,
  audioPlaying: false,
  audioSelected: 'a1',
  dice: null,
  lastChoice: null,
  menuOpen: false
};

/* ─────────────────────────────  УТИЛИТЫ  ───────────────────────────── */

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}

function deep(o) { return JSON.parse(JSON.stringify(o)); }

function toast(text, ms) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms || 2600);
}

/* Модальное окно подтверждения */
function confirmDialog(title, text, yesLabel, onYes) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML =
    '<div class="modal-panel">' +
      '<div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-text">' + esc(text) + '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-no>ОТМЕНА</button>' +
        '<button class="btn btn-danger" data-yes>' + esc(yesLabel || 'ПОДТВЕРДИТЬ') + '</button>' +
      '</div>' +
    '</div>';
  document.getElementById('app').appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target.closest('[data-yes]')) { ov.remove(); onYes && onYes(); }
    else if (e.target.closest('[data-no]') || e.target === ov) { ov.remove(); }
  });
  return ov;
}

/* ─────────────────────────────  СОХРАНЕНИЕ  ───────────────────────────── */

function saveRun() {
  try { localStorage.setItem(RUN_KEY, JSON.stringify(state)); } catch (e) {}
}
function loadRun() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    state = Object.assign(DEFAULT_STATE(), data);
    state.trust = Object.assign({ nicks:71, ren:48, iris:22 }, data.trust || {});
    state.rep   = Object.assign({ street:78, netrunners:42, sylva:12, relics:0 }, data.rep || {});
    return true;
  } catch (e) { return false; }
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
}
function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    meta = Object.assign(JSON.parse(JSON.stringify(DEFAULT_META)), data);
    meta.settings = Object.assign(DEFAULT_META.settings, data.settings || {});
  } catch (e) {}
}

function checkpoint(label) {
  if (!label) return;
  if (state.checkpoints.some(c => c.nodeId === state.nodeId)) return;
  // снимок БЕЗ вложенных якорей — иначе состояние растёт экспоненциально
  const snapshot = deep(Object.assign({}, state, { checkpoints: [] }));
  state.checkpoints.unshift({
    nodeId: state.nodeId,
    label: label,
    day: state.day,
    time: state.time,
    where: state.where,
    memory: state.memory,
    data: snapshot
  });
  state.checkpoints = state.checkpoints.slice(0, 6);
}

/* ─────────────────────────────  НАВИГАЦИЯ  ───────────────────────────── */

function showScreen(id) {
  const target = document.getElementById(id);
  if (!target) return;
  $$('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  ui.screen = id;
  target.scrollTop = 0;
}

function navigateTo(id, opts) {
  opts = opts || {};
  if (!opts.noStack && ui.screen !== id) {
    ui.stack.push(ui.screen);
    if (ui.stack.length > 25) ui.stack.shift();
  }
  showScreen(id);
  const render = {
    'screen-menu': renderMenu,
    'screen-chapters': renderChapters,
    'screen-reading': renderReading,
    'screen-choice': renderChoiceScreen,
    'screen-subject': renderSubject,
    'screen-ripperdoc': renderRipperdoc,
    'screen-market': renderMarket,
    'screen-links': renderLinks,
    'screen-factions': renderFactions,
    'screen-map': renderMap,
    'screen-system': renderSystem,
    'screen-endings': renderEndings,
    'screen-consequences': renderConsequences,
    'screen-returns': renderReturns,
    'screen-audio': renderAudio,
    'screen-archive': renderArchive,
    'screen-finale': renderFinale,
    'screen-cyberpsych': renderCyber
  }[id];
  if (render) render();
}

function goBack() {
  if (ui.audioPlaying) stopAudio();
  if (ui.stack.length) {
    const prev = ui.stack.pop();
    navigateTo(prev, { noStack: true });
  } else {
    navigateTo('screen-menu', { noStack: true });
  }
}

function toggleMenu() {
  const menu = $('#side-menu');
  ui.menuOpen = !ui.menuOpen;
  menu.classList.toggle('open', ui.menuOpen);
  document.getElementById('app').classList.toggle('menu-open', ui.menuOpen);
}

function closeMenu() {
  ui.menuOpen = false;
  $('#side-menu').classList.remove('open');
  document.getElementById('app').classList.remove('menu-open');
}

/* ─────────────────────────────  СТАТЫ  ───────────────────────────── */

const LIMITS = {
  force: [0, 999], control: [0, 100], memory: [0, 100], hack: [0, 99],
  chrome: [0, 100], creds: [0, 999999], humanity: [0, 100]
};
const STAT_NAMES = {
  force:'СИЛА', control:'КОНТРОЛЬ', memory:'ПАМЯТЬ', hack:'ВЗЛОМ',
  chrome:'ХРОМ', creds:'КРЕД', humanity:'ЧЕЛОВЕЧНОСТЬ'
};

function applyEffects(fx) {
  if (!fx) return [];
  const notes = [];
  Object.keys(LIMITS).forEach(k => {
    if (typeof fx[k] !== 'number') return;
    const lim = LIMITS[k];
    const before = state[k];
    state[k] = clamp(state[k] + fx[k], lim[0], lim[1]);
    const diff = state[k] - before;
    if (diff !== 0) notes.push((diff > 0 ? '+' : '') + diff + ' ' + STAT_NAMES[k]);
  });
  ['trust', 'rep'].forEach(group => {
    if (!fx[group]) return;
    Object.keys(fx[group]).forEach(k => {
      if (!(k in state[group])) state[group][k] = 0;
      const before = state[group][k];
      state[group][k] = clamp(before + fx[group][k], 0, 100);
      const diff = state[group][k] - before;
      if (diff !== 0) {
        const label = group === 'trust'
          ? ({ nicks:'НИКС', ren:'РЕН', iris:'АЙРИС', silva:'СИЛЬВА' }[k] || k.toUpperCase())
          : ({ street:'УЛИЦА', netrunners:'НЕТРАННЕРЫ', sylva:'«СИЛЬВА»', relics:'РЕЛИКТЫ' }[k] || k.toUpperCase());
        notes.push((diff > 0 ? '+' : '') + diff + ' ' + label);
      }
    });
  });
  if (fx.flags) Object.keys(fx.flags).forEach(k => { state.flags[k] = fx.flags[k]; });
  if (fx.item && !state.items.includes(fx.item)) state.items.push(fx.item);
  if (fx.removeItem) state.items = state.items.filter(i => i !== fx.removeItem);
  if (fx.archive && !state.archive.includes(fx.archive)) {
    state.archive.push(fx.archive);
    notes.push('+АРХИВ: ' + (S.archive[fx.archive] ? S.archive[fx.archive].title : fx.archive));
  }
  if (fx.unlockAudio) {
    const rec = S.audio.find(a => a.id === fx.unlockAudio);
    if (rec && !state.audio.includes(rec.id)) {
      state.audio.push(rec.id);
      notes.push('+АУДИО: ' + rec.title);
    }
  }
  if (fx.removeImplant) {
    state.implants = state.implants.filter(i => i !== fx.removeImplant);
  }
  if (typeof fx.day === 'number') {
    state.day = fx.day;
    state.maxDay = Math.max(state.maxDay, fx.day);
  }
  if (fx.location) state.location = fx.location;
  if (fx.cons) {
    state.consequences.unshift(fx.cons);
    state.consequences = state.consequences.slice(0, 60);
  }
  return notes;
}

function applyNodeMeta(node) {
  if (typeof node.day === 'number') {
    if (node.day > state.day) {
      const dayMeta = S.days.find(d => d.n === node.day);
      if (state.started && dayMeta) showDayCard(dayMeta);
    }
    state.day = Math.max(state.day, node.day);
    state.maxDay = Math.max(state.maxDay, node.day);
  }
  if (node.time) state.time = node.time;
  if (node.scene) state.scene = node.scene;
  if (node.where) state.where = node.where;
}

/* Карточка нового дня */
function showDayCard(dayMeta) {
  const app = $('#app');
  const card = document.createElement('div');
  card.className = 'day-card';
  card.innerHTML =
    '<div class="day-card-kicker">// ДЕНЬ ' + String(dayMeta.n).padStart(2, '0') + '</div>' +
    '<div class="day-card-title">' + esc(dayMeta.title) + '</div>' +
    '<div class="day-card-epi">' + esc(dayMeta.epigraph) + '</div>';
  app.appendChild(card);
  setTimeout(() => card.classList.add('out'), 2200);
  setTimeout(() => card.remove(), 3000);
}

/* ─────────────────────────────  МЕНЮ  ───────────────────────────── */

function renderMenu() {
  const resume = $('#menu-return');
  const label = $('#menu-return-label');
  if (state.started && !state.finished) {
    resume.style.display = 'block';
    label.textContent = 'ДЕНЬ ' + String(state.day).padStart(2, '0') + ' // ' +
      state.time + ' // ' + (state.where || '');
  } else {
    resume.style.display = 'none';
  }
}

function startGame() {
  const begin = () => {
    state = DEFAULT_STATE();
    state.started = true;
    meta.runs = (meta.runs || 0) + 1;
    saveMeta();
    saveRun();
    closeMenu();
    enterNode('d1_01');
    navigateTo('screen-reading');
  };
  if (state.started && !state.finished) {
    confirmDialog('НОВЫЙ ПРОХОД', 'Текущий прогресс будет потерян. Начать заново?', 'НАЧАТЬ', begin);
  } else begin();
}

function continueStory() {
  if (!state.started) { navigateTo('screen-chapters'); return; }
  if (state.finished) { navigateTo('screen-endings'); return; }
  navigateTo('screen-reading');
  renderReading();
}

/* ─────────────────────────────  ВЫБОР ДНЯ  ───────────────────────────── */

function renderChapters() {
  const box = $('#chapters-list');
  if (!box) return;
  box.innerHTML = S.days.map(d => {
    const unlocked = d.n <= state.maxDay || !!state.finished;
    const current = state.started && d.n === state.day && !state.finished ? ' active' : '';
    const done = state.maxDay > d.n || (state.started && d.n < state.day);
    let status = unlocked ? (done ? '// ПРОЙДЕНО' : '// АКТИВНО') : '// ЗАБЛОКИРОВАНО';
    if (state.finished && d.n === state.maxDay) status = '// ЗАВЕРШЕНО';
    return '<div class="chapter-item' + current + (unlocked ? '' : ' locked') + '" data-day="' + d.n + '">' +
      '<div class="chapter-num">ДЕНЬ ' + String(d.n).padStart(2, '0') + '</div>' +
      '<div class="chapter-title">' + esc(d.title) + '</div>' +
      '<div class="chapter-status">' + status + '</div>' +
      '<div class="chapter-epi">' + esc(d.epigraph) + '</div>' +
    '</div>';
  }).join('');
  $$('.chapter-item', box).forEach(el => {
    el.addEventListener('click', () => {
      const n = Number(el.dataset.day);
      if (n > state.maxDay && !state.finished) { toast('ДЕНЬ ЗАБЛОКИРОВАН // ПРОЙДИ ПРЕДЫДУЩИЙ'); return; }
      jumpToDay(n);
    });
  });
}

function jumpToDay(n) {
  const metaDay = S.days.find(d => d.n === n);
  if (!metaDay) return;
  const go = () => {
    if (!state.started) { state = DEFAULT_STATE(); state.started = true; }
    state.finished = null;
    state.day = n;
    state.maxDay = Math.max(state.maxDay, n);
    enterNode(metaDay.start);
    navigateTo('screen-reading');
    saveRun();
  };
  if (state.started) {
    confirmDialog('ПЕРЕЙТИ К ДНЮ ' + String(n).padStart(2, '0'), 'Текущий прогресс сохранится, но сцена начнётся с начала дня.', 'ПЕРЕЙТИ', go);
  } else go();
}

/* ─────────────────────────────  СОБЫТИЯ УЗЛА  ───────────────────────────── */

function enterNode(id, opts) {
  opts = opts || {};
  const node = S.nodes[id];
  if (!node) { toast('УЗЕЛ НЕ НАЙДЕН: ' + id); return; }
  state.nodeId = id;
  state.line = 0;
  applyNodeMeta(node);
  if (!opts.silent) {
    const notes = applyEffects(node.enter);
    if (notes.length) toast(notes.join(' · '));
    if (node.checkpoint) checkpoint(node.checkpoint);
  }
  state.visited[id] = (state.visited[id] || 0) + 1;
  const vkeys = Object.keys(state.visited);
  if (vkeys.length > 120) { delete state.visited[vkeys[0]]; }
  saveRun();

  if (node.cyber && !node.lines) {
    ui.cyberReturn = 'node';
    ui.cyberNext = node.next || null;
    renderCyber(node.cyber);
    showScreen('screen-cyberpsych');
    return;
  }
  if (!node.lines && node.hack) {
    showScreen('screen-reading');
    launchIce(node.hack, ok => enterNode(ok ? node.hack.success : node.hack.fail));
    return;
  }
  if (!node.lines && node.choice) {
    showScreen('screen-choice');
    renderChoiceScreen();
    maybeCyber();
    return;
  }
  if (!node.lines && node.ending) { finishGame(node.ending); return; }
  if (!node.lines && node.next) { enterNode(node.next); return; }

  showScreen('screen-reading');
  renderReading();
  maybeCyber();
}

function maybeCyber() {
  if (state.cyberSeen || state.finished) return;
  if (state.memory <= 20 || state.control <= 15) {
    state.cyberSeen = true;
    saveRun();
    ui.cyberReturn = 'screen';
    const generic = {
      sub: 'ПАМЯТЬ ' + state.memory + '% // КОНТРОЛЬ ' + state.control + '%',
      text: 'Мир теряет края. Ты слышишь свой пульс как чужой метроном и не можешь вспомнить, где оставил тело. Айрис говорит: «Дыши. Ты ещё здесь. Пока ещё здесь».',
      panels: [
        { cls:'danger', title:'СИСТЕМА // НЕЙРО-СХОД', desc:'Контроль утерян. Действие недоступно.' },
        { cls:'iris', title:'АЙРИС // IRIS_PROTOCOL', desc:'Позволь мне подержать тебя на этой стороне.' }
      ]
    };
    const node = S.nodes[state.nodeId];
    renderCyber(node && node.cyber ? node.cyber : generic);
    showScreen('screen-cyberpsych');
  }
}

function leaveCyber() {
  if (ui.cyberReturn === 'node' && ui.cyberNext) {
    enterNode(ui.cyberNext);
  } else {
    navigateTo('screen-reading', { noStack: true });
    renderReading();
  }
}

/* ─────────────────────────────  ЧТЕНИЕ  ───────────────────────────── */

function renderReading() {
  const node = S.nodes[state.nodeId];
  if (!node) return;

  const line = node.lines && node.lines[state.line];
  if (!line) { afterLastLine(node); return; }

  const who = line[0];
  const text = line[1];
  const char = S.characters[who] || S.characters.narrator;

  // статус-бар
  $('#stat-day').textContent = '[ ДЕНЬ ' + String(state.day).padStart(2, '0') + ' // ' + state.time + ' ]';
  $('#stat-chrome').textContent = 'ХРОМ ' + state.chrome + '%';
  $('#stat-memory').textContent = 'ПАМЯТЬ ' + state.memory + '%';
  $('#stat-day-2').textContent = '[ ДЕНЬ ' + String(state.day).padStart(2, '0') + ' // ' + state.time + ' ]';
  $('#stat-chrome-2').textContent = 'ХРОМ ' + state.chrome + '%';
  $('#stat-memory-2').textContent = 'ПАМЯТЬ ' + state.memory + '%';

  // фон сцены
  const bg = $('#reading-bg');
  bg.className = 'reading-bg scene-' + (node.scene || 'shelter');

  // портрет
  const portrait = $('#character-portrait');
  const colorVar = who === 'kai' ? 'var(--color-kai)'
    : who === 'nicks' ? 'var(--color-nicks)'
    : who === 'ren' ? 'var(--color-ren)'
    : who === 'iris' ? 'var(--color-iris)'
    : who === 'moro' ? 'var(--color-voice)'
    : who === 'silva' ? 'var(--color-iris)'
    : who === 'guard' ? 'var(--color-system)'
    : who === 'voice' ? 'var(--color-voice)'
    : 'var(--color-narrator)';
  portrait.className = 'character-portrait speaker-' + who;
  portrait.style.setProperty('--speaker-color', colorVar);
  portrait.innerHTML =
    '<div class="portrait-figure">' +
      '<div class="portrait-glyph">' + (AVATARS[who] || '◈') + '</div>' +
      '<div class="portrait-scan"></div>' +
    '</div>' +
    '<div class="portrait-name">' + esc(char.name) + '</div>' +
    '<div class="portrait-scene">' + esc(state.where || '') + '</div>';

  // диалоговое окно
  const container = $('#dialogue-container');
  container.className = 'dialogue-container ' + who;
  $('#speaker-avatar').textContent = AVATARS[who] || '◈';
  $('#speaker-name').textContent = char.name || 'ЛЕНТА';
  $('#speaker-role').textContent = char.role || '';

  // индикатор прогресса
  const total = node.lines.length;
  $('#dialogue-counter').textContent = (state.line + 1) + ' / ' + total;
  const dots = $('#dialogue-dots');
  dots.innerHTML = node.lines.map((_, i) =>
    '<span class="' + (i === state.line ? 'current' : (i < state.line ? 'active' : '')) + '"></span>'
  ).join('');

  // кнопка
  const last = state.line >= total - 1;
  let label = 'ПРОДОЛЖИТЬ ▶';
  if (last) {
    if (node.choice) label = 'СДЕЛАТЬ ВЫБОР ▶';
    else if (node.hack) label = 'НАЧАТЬ ВЗЛОМ ▶';
    else if (node.ending) label = 'ЗАВЕРШИТЬ ИСТОРИЮ ▶';
  }
  $('#continue-label').textContent = label;

  typeText($('#dialogue-text'), text);
}

function typeText(el, text) {
  clearInterval(ui.typeTimer);
  const speed = Number(meta.settings.speed);
  ui.fullText = text;
  ui.typing = true;
  el.textContent = '';
  el.classList.add('typing');

  if (speed >= 96) {
    el.textContent = text;
    ui.typing = false;
    el.classList.remove('typing');
    return;
  }
  const delay = Math.max(4, 42 - Math.round(speed * 0.38));
  let i = 0;
  ui.typeTimer = setInterval(() => {
    i += 1;
    el.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(ui.typeTimer);
      ui.typing = false;
      el.classList.remove('typing');
    }
  }, delay);
}

function skipTyping() {
  if (!ui.typing) return false;
  clearInterval(ui.typeTimer);
  ui.typing = false;
  const el = $('#dialogue-text');
  el.textContent = ui.fullText;
  el.classList.remove('typing');
  return true;
}

function nextScene() {
  if (skipTyping()) return;
  const node = S.nodes[state.nodeId];
  if (!node) return;
  if (node.lines && state.line < node.lines.length - 1) {
    state.line += 1;
    saveRun();
    renderReading();
    return;
  }
  afterLastLine(node);
}

function afterLastLine(node) {
  if (node.choice) { navigateTo('screen-choice', { noStack: true }); renderChoiceScreen(); return; }
  if (node.hack) {
    launchIce(node.hack, ok => enterNode(ok ? node.hack.success : node.hack.fail));
    return;
  }
  if (node.cyber) {
    ui.cyberReturn = 'node';
    ui.cyberNext = node.next || null;
    renderCyber(node.cyber);
    showScreen('screen-cyberpsych');
    return;
  }
  if (node.ending) { finishGame(node.ending); return; }
  if (node.next) { enterNode(node.next); return; }
  toast('КОНЕЦ ФРАГМЕНТА');
  navigateTo('screen-menu');
}

/* ─────────────────────────────  ВЫБОР  ───────────────────────────── */

function statBonus(stat) {
  const v = Number(state[stat] || 0);
  switch (stat) {
    case 'memory':  return Math.round((v - 50) * 0.5);
    case 'hack':    return Math.round(v * 4);
    case 'force':   return Math.round(v * 0.6);
    case 'control': return Math.round((v - 50) * 0.4);
    case 'humanity': return Math.round((v - 50) * 0.3);
    default: return 0;
  }
}

function chanceOf(opt) {
  if (!opt.check) return null;
  const base = Number(opt.base || 0);
  const bonus = statBonus(opt.stat);
  return clamp(Math.round(base + bonus), 2, 95);
}

function renderChoiceScreen() {
  const node = S.nodes[state.nodeId];
  if (!node || !node.choice) { goBack(); return; }
  const ch = node.choice;
  $('#stat-day-2').textContent = '[ ДЕНЬ ' + String(state.day).padStart(2, '0') + ' // ' + state.time + ' ]';
  $('#stat-chrome-2').textContent = 'ХРОМ ' + state.chrome + '%';
  $('#stat-memory-2').textContent = 'ПАМЯТЬ ' + state.memory + '%';
  $('#choice-header').textContent = ch.header || '◈ РАЗВИЛКА';
  $('#choice-question').textContent = ch.question || '';

  const list = $('#choice-list');
  list.innerHTML = '';
  ch.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    const chance = chanceOf(opt);
    let cls = 'choice-item ' + (opt.cls || '');
    if (opt.req && !reqMet(opt.req)) cls += ' choice-locked';
    btn.className = cls;
    btn.dataset.index = idx;

    let tag = opt.tag || '';
    if (opt.hack) tag = '[ ICE // ВЗЛОМ ]';
    let chanceHtml = '';
    if (chance !== null) chanceHtml = '<div class="choice-chance">ШАНС <span>' + chance + '%</span></div>';
    else if (opt.hack) chanceHtml = '<div class="choice-chance">МИНИ-ИГРА <span>ICE</span></div>';
    let reqHtml = '';
    if (opt.req && !reqMet(opt.req)) reqHtml = '<div class="choice-req">' + esc(opt.req.hint) + '</div>';

    btn.innerHTML =
      '<div class="choice-tag">' + esc(tag) + '</div>' +
      '<div class="choice-text">' + esc(opt.text) + '</div>' +
      chanceHtml + reqHtml;
    btn.addEventListener('click', () => handleChoice(idx));
    list.appendChild(btn);
  });

  const foot = $('#choice-foot');
  const reasons = ch.options.filter(o => o.check).length;
  foot.textContent = reasons
    ? '◈ ПРОВЕРКА: КУБИК 0–99. СТАТ ДОБАВЛЯЕТ ШАНС. ПРОВАЛ — ЭТО ТОЖЕ ВЕТКА.'
    : '◈ РЕШЕНИЕ НЕОБРАТИМО.';
}

function reqMet(req) {
  if (!req) return true;
  const val = Number(state[req.key] || 0);
  return val >= req.min;
}

function handleChoice(idx) {
  const node = S.nodes[state.nodeId];
  if (!node || !node.choice) return;
  const opt = node.choice.options[idx];
  if (!opt) return;

  if (opt.req && !reqMet(opt.req)) { toast(opt.req.hint); return; }

  checkpoint(node.checkpoint || node.choice.header || 'ВЫБОР');

  if (opt.hack) {
    const cfg = opt.hackCfg || node.hack;
    launchIce(cfg, ok => {
      const notes = applyEffects(opt.effects);
      if (notes.length) toast(notes.join(' · '));
      goToResult(ok ? opt.success : opt.fail, opt, idx, ok);
    });
    return;
  }

  const chance = chanceOf(opt);
  if (chance !== null) {
    performCheck(opt, chance, success => {
      const target = success ? opt.success : opt.fail;
      const notes = applyEffects(opt.effects);
      if (notes.length) toast(notes.join(' · '));
      goToResult(target, opt, idx, success);
    });
    return;
  }

  const notes = applyEffects(opt.effects);
  if (notes.length) toast(notes.join(' · '));
  state.choices.push({ node: state.nodeId, text: opt.text, success: true });
  const target = opt.next || opt.success;
  if (!target) { toast('ВЕТКА НЕ НАЙДЕНА'); return; }
  enterNode(target);
}

function goToResult(target, opt, idx, success) {
  state.choices.push({ node: state.nodeId, text: opt.text, success: success });
  if (!target) { toast('ВЕТКА НЕ НАЙДЕНА'); return; }
  enterNode(target);
}

/* ─────────────────────────────  БРОСОК КУБИКА  ───────────────────────────── */

function performCheck(opt, chance, done) {
  const ov = $('#dice-overlay');
  ui.dice = { chance: chance, done: done, opt: opt, rewound: 0 };
  $('#dice-title').textContent = 'ПРОВЕРКА // ' + (opt.stat ? ({ memory:'ПАМЯТЬ', hack:'ВЗЛОМ', force:'СИЛА', control:'КОНТРОЛЬ', humanity:'ЧЕЛОВЕЧНОСТЬ' }[opt.stat] || opt.stat.toUpperCase()) : 'РЕШЕНИЕ');
  $('#dice-chance').textContent = 'ШАНС ' + chance + '%';
  $('#dice-value').textContent = '00';
  $('#dice-value').className = 'dice-value';
  $('#dice-result').textContent = 'РАСЧЁТ ВЕРОЯТНОСТИ...';
  $('#dice-result').className = 'dice-result';
  $('#dice-fill').style.width = '0%';
  ov.classList.add('active');
  setTimeout(() => { $('#dice-fill').style.width = chance + '%'; }, 60);

  let ticks = 0;
  const rollTimer = setInterval(() => {
    $('#dice-value').textContent = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    ticks++;
    if (ticks > 14) {
      clearInterval(rollTimer);
      resolveDiceRoll(chance);
    }
  }, 55);
}

function resolveDiceRoll(chance) {
  if (!ui.dice) return;
  const roll = Math.floor(Math.random() * 100);
  const success = roll < chance;
  ui.dice.lastRoll = roll;
  ui.dice.lastSuccess = success;
  $('#dice-value').textContent = String(roll).padStart(2, '0');
  $('#dice-value').className = 'dice-value ' + (success ? 'ok' : 'fail');
  $('#dice-result').textContent = success ? 'УСПЕХ // ВЕТКА ОТКРЫТА' : 'ПРОВАЛ // ВЕТКА ЗАКРЫТА';
  $('#dice-result').className = 'dice-result ' + (success ? 'ok' : 'fail');
  renderDiceActions();
}

function renderDiceActions() {
  const ov = $('#dice-overlay');
  let actions = $('.dice-actions', ov);
  if (actions) actions.remove();
  actions = document.createElement('div');
  actions.className = 'dice-actions';

  if (ui.dice.lastSuccess) {
    const b = document.createElement('button');
    b.className = 'btn btn-primary';
    b.textContent = 'ПРОДОЛЖИТЬ ▶';
    b.addEventListener('click', closeDiceAndContinue);
    actions.appendChild(b);
  } else {
    const canRewind = state.implants.includes('vetka') && state.memory >= 20;
    if (canRewind) {
      const r = document.createElement('button');
      r.className = 'btn btn-ghost dice-rewind';
      r.innerHTML = '◈ ОТКАТ ВЕТКИ <span>−5 ПАМЯТЬ // +15%</span>';
      r.addEventListener('click', rewindDice);
      actions.appendChild(r);
    }
    const b = document.createElement('button');
    b.className = 'btn btn-danger';
    b.textContent = 'ПРИНЯТЬ РЕЗУЛЬТАТ';
    b.addEventListener('click', closeDiceAndContinue);
    actions.appendChild(b);
  }
  ov.querySelector('.dice-panel').appendChild(actions);
}

function rewindDice() {
  if (!state.implants.includes('vetka') || state.memory < 20) return;
  state.memory = clamp(state.memory - 5, 0, 100);
  state.rewinds = (state.rewinds || 0) + 1;
  ui.dice.chance = clamp(ui.dice.chance + 15, 2, 95);
  ui.dice.rewound += 1;
  $('#dice-chance').textContent = 'ШАНС ' + ui.dice.chance + '% // ОТКАТ ' + ui.dice.rewound;
  $('#dice-fill').style.width = ui.dice.chance + '%';
  $('#dice-result').textContent = 'ВЕТКА СГЛАЖИВАЕТ ПРОВАЛ...';
  $('#dice-result').className = 'dice-result';
  $('#dice-value').textContent = '··';
  toast('ВЕТКА: −5 ПАМЯТЬ // ВОСПОМИНАНИЕ УТРАЧЕНО');
  const actions = $('.dice-actions');
  if (actions) actions.remove();
  let ticks = 0;
  const t = setInterval(() => {
    $('#dice-value').textContent = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    ticks++;
    if (ticks > 14) { clearInterval(t); resolveDiceRoll(ui.dice.chance); }
  }, 55);
  saveRun();
}

function closeDiceAndContinue() {
  const ov = $('#dice-overlay');
  ov.classList.remove('active');
  const success = ui.dice.lastSuccess;
  const done = ui.dice.done;
  ui.dice = null;
  if (done) done(success);
}

/* ─────────────────────────────  ICE / ВЗЛОМ  ───────────────────────────── */

function hexLabel(used) {
  const hex = '0123456789ABCDEF';
  let s;
  do {
    s = hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
  } while (used.has(s));
  return s;
}

function launchIce(cfg, done) {
  if (!cfg) { done && done(true); return; }
  const targets = cfg.targets || ['A7', 'C2', '77', 'F6', '42'];
  const size = 16;
  const grid = [];
  for (let i = 0; i < size; i++) grid.push(i);

  // случайный самонепересекающийся путь
  let path = null;
  for (let attempt = 0; attempt < 300 && !path; attempt++) {
    const tryPath = [];
    const startRow = Math.floor(Math.random() * 4);
    const startCol = Math.floor(Math.random() * 4);
    tryPath.push(startRow * 4 + startCol);
    while (tryPath.length < targets.length) {
      const cur = tryPath[tryPath.length - 1];
      const r = Math.floor(cur / 4), c = cur % 4;
      const neigh = [];
      if (r > 0) neigh.push(cur - 4);
      if (r < 3) neigh.push(cur + 4);
      if (c > 0) neigh.push(cur - 1);
      if (c < 3) neigh.push(cur + 1);
      const free = neigh.filter(n => !tryPath.includes(n));
      if (!free.length) break;
      tryPath.push(free[Math.floor(Math.random() * free.length)]);
    }
    if (tryPath.length === targets.length) path = tryPath;
  }
  if (!path) { path = [0, 1, 2, 3, 4]; }

  const labels = {};
  const used = new Set(targets);
  path.forEach((cell, i) => { labels[cell] = targets[i]; });
  for (let i = 0; i < size; i++) {
    if (!(i in labels)) { const lab = hexLabel(used); labels[i] = lab; used.add(lab); }
  }

  const gridEl = $('#ice-grid');
  gridEl.innerHTML = '';
  for (let i = 0; i < size; i++) {
    const b = document.createElement('button');
    b.className = 'ice-cell';
    b.dataset.id = labels[i];
    b.dataset.cell = i;
    b.textContent = labels[i];
    b.addEventListener('click', () => onIceClick(i));
    gridEl.appendChild(b);
  }

  $('#ice-sub').textContent = cfg.sub || 'НЕЙРО-ЗАЩИТА // ICE';
  $('#ice-target').textContent = targets.join(' → ');
  $('#ice-next').textContent = targets[0];
  $('#ice-status-desc').textContent = 'Выбирай соседний узел по горизонтали или вертикали. Диагональные переходы запрещены.';
  const time = Number(cfg.time || 25);
  $('#ice-timer-label').textContent = '00:' + String(time).padStart(2, '0');
  $('#ice-timer-fill').style.width = '100%';
  $('#ice-timer-fill').classList.remove('warning');
  $('#ice-overlay').classList.add('active');

  clearInterval(ui.iceTimer);
  ui.ice = {
    path: path, labels: labels, step: 0, targets: targets, done: done,
    timeLeft: time, totalTime: time, finished: false, cfg: cfg
  };

  ui.iceTimer = setInterval(() => {
    if (!ui.ice || ui.ice.finished) return;
    ui.ice.timeLeft -= 1;
    const left = Math.max(0, ui.ice.timeLeft);
    $('#ice-timer-label').textContent = '00:' + String(left).padStart(2, '0');
    $('#ice-timer-fill').style.width = (left / ui.ice.totalTime * 100) + '%';
    if (left <= 5) $('#ice-timer-fill').classList.add('warning');
    if (left <= 0) failIce();
  }, 1000);
}

function onIceClick(cell) {
  if (!ui.ice || ui.ice.finished) return;
  const ice = ui.ice;
  const expected = ice.path[ice.step];
  const el = $('.ice-cell[data-cell="' + cell + '"]');

  if (cell === expected) {
    el.classList.add('success');
    ice.step += 1;
    if (ice.step >= ice.path.length) { winIce(); return; }
    $('#ice-next').textContent = ice.targets[ice.step];
    $('#ice-status-desc').textContent = 'УЗЕЛ ПРИНЯТ // ДО ЦЕЛИ: ' + (ice.path.length - ice.step) + ' ПЕРЕХОД(А)';
  } else {
    el.classList.add('fail');
    setTimeout(() => el.classList.remove('fail'), 300);
    ice.timeLeft = Math.max(0, ice.timeLeft - 3);
    $('#ice-status-desc').textContent = 'ЛОВУШКА // ТАЙМЕР −3 СЕК';
    $('#ice-timer-label').textContent = '00:' + String(ice.timeLeft).padStart(2, '0');
    if (ice.timeLeft <= 0) failIce();
  }
}

function winIce() {
  if (!ui.ice || ui.ice.finished) return;
  ui.ice.finished = true;
  clearInterval(ui.iceTimer);
  $('#ice-status-desc').textContent = 'ДОСТУП ПОЛУЧЕН // ЗАЩИТА ПРОЙДЕНА';
  $('#ice-next').textContent = 'OK';
  $('#ice-timer-fill').style.width = '100%';
  $('#ice-timer-fill').classList.remove('warning');
  const done = ui.ice.done;
  setTimeout(() => {
    $('#ice-overlay').classList.remove('active');
    ui.ice = null;
    if (done) done(true);
  }, 750);
}

function failIce() {
  if (!ui.ice || ui.ice.finished) return;
  ui.ice.finished = true;
  clearInterval(ui.iceTimer);
  $('#ice-status-desc').textContent = 'ВЗЛОМ ПРОВАЛЕН // СЛЕД ЗАФИКСИРОВАН';
  $('#ice-next').textContent = '!!';
  $('#ice-timer-fill').style.width = '0%';
  const done = ui.ice.done;
  setTimeout(() => {
    $('#ice-overlay').classList.remove('active');
    ui.ice = null;
    if (done) done(false);
  }, 900);
}

function cancelIce() {
  if (!ui.ice) { $('#ice-overlay').classList.remove('active'); return; }
  const done = ui.ice.done;
  ui.ice.finished = true;
  clearInterval(ui.iceTimer);
  ui.ice = null;
  $('#ice-overlay').classList.remove('active');
  toast('ВЗЛОМ ПРЕРВАН');
  if (done) done(false);
}

/* ─────────────────────────────  СУБЪЕКТ  ───────────────────────────── */

function renderBars() {
  const set = (id, val, valId, suffix) => {
    const bar = $('#' + id);
    const label = $('#' + valId);
    if (bar) bar.style.width = clamp(val, 0, 100) + '%';
    if (label) label.textContent = val + (suffix || '');
  };
  set('bar-force', state.force, 'val-force', '');
  set('bar-control', state.control, 'val-control', '');
  set('bar-memory', state.memory, 'val-memory', '%');
  set('bar-hack', Math.min(100, state.hack * 5), 'val-hack', '');
  set('bar-chrome', state.chrome, 'val-chrome', '%');
  const bl = $('#balance-label');
  if (bl) bl.textContent = 'КРЕДИТЫ // ' + fmt(state.creds);
  const mb = $('#market-balance');
  if (mb) mb.textContent = fmt(state.creds);
}

function renderSubject() {
  const label = $('#implant-label');
  if (label) label.textContent = 'ИМПЛАНТЫ // ' + state.implants.length + '/9';
  const grid = $('#implant-grid');
  if (grid) {
    grid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'implant-slot' + (i < state.implants.length ? ' active' : '');
      d.textContent = i < state.implants.length ? '◈' : '';
      d.title = i < state.implants.length ? state.implants[i] : 'СВОБОДНЫЙ СЛОТ';
      grid.appendChild(d);
    }
  }
  renderBars();

  const inv = $('#subject-inventory');
  if (inv) {
    inv.innerHTML = state.items.length
      ? state.items.map(i => '<div class="inv-item">◈ ' + esc(i) + '</div>').join('')
      : '<div class="inv-item dim">ИНВЕНТАРЬ ПУСТ</div>';
  }

  const effects = $('#effects-list');
  if (effects) {
    const cards = [];
    if (state.implants.includes('vetka')) {
      cards.push({
        cls: 'cyan',
        title: 'Имплант «Ветка»',
        desc: 'Откат выбора: −5% Память, +15% к шансу проверки. Айрис поглощает утраченные воспоминания. Откатов до потери себя: ' + Math.max(0, 12 - (state.rewinds || 0))
      });
    }
    if (state.flags.vetkaRemoved) {
      cards.push({ cls: 'lime', title: '«Ветка» удалена', desc: 'Корень вырезан. Откат недоступен, память восстанавливается. Айрис больше не может тебя подстраховать.' });
    }
    if (state.flags.keepVetka) {
      cards.push({ cls: 'magenta', title: '«Ветка» растёт', desc: 'Имплант остался по твоему выбору. Память уходит быстрее, но Айрис рядом.' });
    }
    if (state.implants.includes('berserk')) {
      cards.push({ cls: 'magenta', title: 'BERSERK', desc: 'Болевой порог отключён. Контроль снижен. Драться легко, останавливаться — нет.' });
    }
    if (state.trust.iris >= 50) {
      cards.push({ cls: 'magenta', title: 'Айрис // доверие', desc: 'Протокол открыл тебе доступ к собственным стёртым фрагментам. Проверки Памяти получают бонус.' });
    }
    effects.innerHTML = cards.map(c =>
      '<div class="effect-card ' + c.cls + '">' +
        '<div class="effect-title">' + esc(c.title) + '</div>' +
        '<div class="effect-desc">' + esc(c.desc) + '</div>' +
      '</div>').join('') || '<div class="effect-card"><div class="effect-desc">ЭФФЕКТОВ НЕТ</div></div>';
  }
}

/* ─────────────────────────────  РИППЕРДОК  ───────────────────────────── */

function renderRipperdoc() {
  const count = state.implants.length;
  const sl = $('#schema-label');
  if (sl) sl.textContent = 'ХРОМ ' + state.chrome + '% // ' + count + ' ИМПЛАНТА';
  const fig = $('#schema-figure');
  if (fig) {
    fig.innerHTML = state.implants.slice(0, 9).map((_, i) =>
      '<span class="schema-dot" style="top:' + (10 + i * 9) + '%"></span>').join('') +
      '<span class="schema-core"></span>';
  }
  const note = $('#ripper-note');
  if (note) note.textContent = '// КЛИНИКА «ПРОВОД» // БАЛАНС: ' + fmt(state.creds) + ' КРЕД';

  const store = $('#implant-store');
  if (!store) return;
  store.innerHTML = '';
  S.implantStore.forEach(imp => {
    const installed = state.implants.includes(imp.id);
    const card = document.createElement('div');
    card.className = 'implant-card' + (installed ? ' installed' : '');
    card.innerHTML =
      '<div class="implant-card-header"><span>' + esc(imp.name) + '</span><span class="implant-brand">' + esc(imp.brand) + '</span></div>' +
      '<div class="implant-name">' + esc(imp.brand) + '</div>' +
      '<div class="implant-type">' + esc(imp.type) + ' // ' + fmt(imp.price) + ' КРЕД</div>' +
      '<div class="implant-stats">' + imp.stats.map(s =>
        '<div class="stat-line ' + (s[0] === '-' ? 'negative' : 'positive') + '">' + esc(s) + '</div>').join('') + '</div>' +
      '<div class="implant-note">' + esc(imp.note) + '</div>' +
      '<button class="btn ' + (installed ? 'btn-ghost' : 'btn-primary') + '" ' + (installed ? 'disabled' : '') + '>' +
        (installed ? 'УСТАНОВЛЕНО' : (state.creds < imp.price ? 'НЕДОСТАТОЧНО СРЕДСТВ' : 'ВСТАВИТЬ')) +
      '</button>';
    const btn = $('button', card);
    if (!installed) btn.addEventListener('click', () => installImplant(imp.id));
    store.appendChild(card);
  });
}

function installImplant(id) {
  const imp = S.implantStore.find(i => i.id === id);
  if (!imp) return;
  if (state.implants.includes(id)) { toast('ИМПЛАНТ УЖЕ УСТАНОВЛЕН'); return; }
  if (state.implants.length >= 9) { toast('СЛОТЫ ИМПЛАНТОВ ЗАПОЛНЕНЫ // 9/9'); return; }
  if (state.creds < imp.price) { toast('НЕДОСТАТОЧНО СРЕДСТВ // НУЖНО ' + fmt(imp.price) + ' КРЕД'); return; }
  const chromeAfter = state.chrome + (imp.effects.chrome || 0);
  if (chromeAfter > 100) {
    confirmDialog('КРИТИЧЕСКИЙ ХРОМ', 'Установка поднимет хром до ' + chromeAfter + '%. Это выше безопасного порога. Продолжить?', 'РИСКНУТЬ', () => doInstall(imp));
    return;
  }
  doInstall(imp);
}

function doInstall(imp) {
  state.creds -= imp.price;
  state.implants.push(imp.id);
  const notes = applyEffects(imp.effects);
  state.consequences.unshift({
    time: state.time, cls: 'cyan',
    title: 'Установлен имплант ' + imp.brand,
    effects: notes.join(' // '),
    desc: 'Доктор Моро закрыл чемоданчик и сказал: «Не благодари. Просто не сдохни в первые сутки».'
  });
  saveRun();
  renderRipperdoc();
  renderBars();
  toast(notes.join(' · ') || 'ИМПЛАНТ УСТАНОВЛЕН');
}

/* ─────────────────────────────  РЫНОК  ───────────────────────────── */

function renderMarket() {
  renderBars();
  const body = $('#market-body');
  if (!body) return;
  body.innerHTML = '<div class="market-sub">ЧЁРНЫЙ РЫНОК // СЕКТОР ДЕЛЬТА // БАЛАНС ' + fmt(state.creds) + ' КРЕД</div>';
  S.market.forEach(item => {
    const bought = state.flags['bought_' + item.id];
    const soldOut = item.once && bought;
    const lockedPass = item.requiresLow && state.trust.ren < 50;
    const div = document.createElement('div');
    div.className = 'market-item' + (soldOut ? ' locked' : '');
    let note = '';
    if (item.id === 'pass' && lockedPass) note = '<div class="market-req">НУЖНО ДОВЕРИЕ РЕНА 50% // СЕЙЧАС ' + state.trust.ren + '%</div>';
    if (item.id === 'info' && bought) note = '<div class="market-req">ФРАГМЕНТ УЖЕ В АРХИВЕ</div>';
    div.innerHTML =
      '<div class="market-title">' + esc(item.title) + '</div>' +
      '<div class="market-price">' + fmt(item.price) + ' КРЕД</div>' +
      '<div class="market-desc">' + esc(item.desc) + '</div>' + note +
      '<button class="btn ' + (soldOut ? 'btn-ghost' : 'btn-primary') + '" ' + (soldOut ? 'disabled' : '') + '>' +
        (soldOut ? 'ПРОДАНО' : 'КУПИТЬ') + '</button>';
    const btn = $('button', div);
    if (!soldOut) btn.addEventListener('click', () => buyItem(item.id));
    body.appendChild(div);
  });
}

function buyItem(id) {
  const item = S.market.find(i => i.id === id);
  if (!item) return;
  if (item.once && state.flags['bought_' + id]) { toast('УЖЕ КУПЛЕНО'); return; }
  if (item.requiresLow && state.trust.ren < 50) { toast('РЕН НЕ ОТКРЫЛ ДОСТУП // ДОВЕРИЕ ' + state.trust.ren + '%'); return; }
  if (state.creds < item.price) { toast('НЕДОСТАТОЧНО СРЕДСТВ'); return; }
  state.creds -= item.price;
  const notes = applyEffects(item.effects);
  if (item.effects && item.effects.flag) state.flags[item.effects.flag] = true;
  if (item.effects && item.effects.archive && !state.archive.includes(item.effects.archive)) {
    state.archive.push(item.effects.archive);
  }
  state.flags['bought_' + id] = true;
  state.consequences.unshift({
    time: state.time, cls: 'cyan',
    title: 'Покупка: ' + item.title,
    effects: '-' + fmt(item.price) + ' КРЕД' + (notes.length ? ' // ' + notes.join(' // ') : ''),
    desc: 'Сделка заняла сорок секунд. Продавец не спросил имени — здесь это считается вежливостью.'
  });
  saveRun();
  renderMarket();
  toast('КУПЛЕНО: ' + item.title.toUpperCase());
}

/* ─────────────────────────────  СВЯЗЬ  ───────────────────────────── */

function renderLinks() {
  const body = $('#links-body');
  if (!body) return;
  const people = [
    { id:'nicks', name:'Никс', role:'Арт-хакер / 28', cls:'link-lime', color:'var(--color-nicks)', bar:'bar-lime' },
    { id:'ren', name:'Рен', role:'Корпоративный наследник / 21', cls:'link-cyan', color:'var(--color-ren)', bar:'' },
    { id:'iris', name:'Айрис', role:'Протокол Айрис / 22', cls:'link-magenta', color:'var(--color-iris)', bar:'' }
  ];
  body.innerHTML = people.map(p => {
    const trust = state.trust[p.id];
    const locked = p.id === 'ren' && trust < 30;
    const status = locked
      ? 'Канал закрыт. Доверие ниже 30%.'
      : trust >= 70 ? 'Связь активна. Канал зашифрован. Готов помочь.'
      : trust >= 40 ? 'Связь активна. Отвечает через второго посредника.'
      : 'Связь нестабильна. Возможен обмен только данными.';
    return '<div class="link-card ' + p.cls + '">' +
      '<div class="link-avatar" style="color:' + p.color + '">' + AVATARS[p.id] + '</div>' +
      '<div class="link-info">' +
        '<div class="link-name">' + p.name + '</div>' +
        '<div class="link-role">' + esc(p.role) + '</div>' +
        '<div class="link-trust">ДОВЕРИЕ <span>' + trust + '%</span></div>' +
        '<div class="bar ' + p.bar + '"><div class="bar-fill" style="width:' + trust + '%' + (p.id === 'iris' ? ';background:var(--magenta)' : '') + '"></div></div>' +
        '<div class="link-status">' + esc(status) + '</div>' +
      '</div>' +
    '</div>';
  }).join('') +
  '<div class="link-note">' +
    '<div class="link-note-title">КАК РАСТЁТ ДОВЕРИЕ</div>' +
    '<div class="link-note-desc">Никс ценит честность и дисциплину. Рен — обещания, которые ты держишь. Айрис — решения, в которых ты остаёшься собой. Доверие открывает каналы и финальные ветки.</div>' +
  '</div>';
}

/* ─────────────────────────────  ФРАКЦИИ  ───────────────────────────── */

function renderFactions() {
  const body = $('#factions-body');
  if (!body) return;
  const list = [
    { id:'street', name:'УЛИЧНЫЕ', cls:'faction-lime', bar:'bar-lime', desc:'Свои в переулках. Доступ к убежищам и уличным контрактам.' },
    { id:'netrunners', name:'НЕТРАННЕРЫ', cls:'faction-cyan', bar:'', desc:'Обмен данными. Помощь при проверках взлома.' },
    { id:'sylva', name:'«СИЛЬВА»', cls:'faction-magenta', bar:'', desc:'Корпорация контролирует сознание через нейро-интерфейсы.' },
    { id:'relics', name:'РЕЛИКТЫ', cls:'faction-dim', bar:'', desc:'Первый контакт ещё не установлен.' }
  ];
  const top = list.slice().sort((a, b) => state.rep[b.id] - state.rep[a.id])[0];
  body.innerHTML = list.map(f => {
    const val = state.rep[f.id] || 0;
    return '<div class="faction-item ' + f.cls + '">' +
      '<div class="faction-header"><span>' + f.name + '</span><span>' + val + '%</span></div>' +
      '<div class="bar ' + f.bar + '"><div class="bar-fill" style="width:' + val + '%' + (f.id === 'sylva' ? ';background:var(--magenta)' : '') + '"></div></div>' +
      '<div class="faction-desc">' + esc(f.desc) + '</div>' +
    '</div>';
  }).join('') +
  '<div class="faction-bonus">' +
    '<div class="faction-bonus-tag">ПОДСКАЗКА // ' + top.name + ' ' + (state.rep[top.id] || 0) + '</div>' +
    '<div class="faction-bonus-title">Сильнейшая фракция</div>' +
    '<div class="faction-bonus-desc">' +
      (top.id === 'street'
        ? 'Уличные дают +2 к проверкам убеждения на своей территории. Репутация влияет на доступные заказы.'
        : top.id === 'netrunners'
          ? 'Нетраннеры снижают сложность ICE на один узел. Если попросишь — помогут.'
          : top.id === 'sylva'
            ? '«Сильва» пока считает тебя управляемым. Это открывает двери, но закрывает выходы.'
            : 'Реликты не выходят на связь. Пока.') +
    '</div>' +
  '</div>';
}

/* ─────────────────────────────  КАРТА  ───────────────────────────── */

const OBJECTIVES = {
  1: { title:'ПРОТОКОЛ АЙРИС', desc:'Доставить чип «АРБОР-2» наверх, в башню «Сильвы». До 21:00.', reward:'3 000 КРЕД', target:'tower' },
  2: { title:'СТЕРЕТЬ СЛЕД', desc:'Вскрыть реле «Сильвы» на Восьмой и удалить журнал курьера К-7.', reward:'—', target:'relay' },
  3: { title:'КОМНАТА СЕМЬ', desc:'Прийти на сорок второй этаж. Одному. Выслушать предложение.', reward:'ПРАВДА', target:'tower' },
  4: { title:'ОБНОВЛЕНИЕ 06:00', desc:'Успеть в комнату семь до запуска «Арбор».', reward:'ВЫБОР', target:'tower' }
};

function renderMap() {
  const wrap = $('#map-nodes');
  if (!wrap) return;
  const current = state.location || 'shelter';
  wrap.innerHTML = S.locations.map(loc =>
    '<div class="map-node' + (loc.id === current ? ' active' : '') + (loc.id === 'tower' && state.day >= 3 ? ' hotspot' : '') + '" ' +
      'style="top:' + loc.y + '%;left:' + loc.x + '%" data-loc="' + loc.id + '">' + esc(loc.name) + '</div>'
  ).join('');
  $$('.map-node', wrap).forEach(el => {
    el.addEventListener('click', () => {
      const loc = S.locations.find(l => l.id === el.dataset.loc);
      if (loc) toast(loc.name + ' // ВЕТКА: ' + (loc.id === current ? 'ТЫ ЗДЕСЬ' : 'ДОСТУПНА ПО СЮЖЕТУ'));
    });
  });

  const lines = $('#map-lines');
  if (lines) {
    lines.innerHTML = '';
    const order = ['shelter', 'relic', 'market', 'clinic', 'relay', 'tower'];
    for (let i = 0; i < order.length - 1; i++) {
      const a = S.locations.find(l => l.id === order[i]);
      const b = S.locations.find(l => l.id === order[i + 1]);
      if (!a || !b) continue;
      lines.innerHTML += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#2A2D38" stroke-width="0.4" stroke-dasharray="1.5 1.5" />';
    }
  }

  const obj = OBJECTIVES[state.day] || OBJECTIVES[1];
  const contract = $('#map-contract');
  if (contract) {
    contract.innerHTML =
      '<div class="map-contract-title">' + esc(state.finished ? 'ИСХОД ЗАФИКСИРОВАН' : obj.title) + '</div>' +
      '<div class="map-contract-desc">' + esc(state.finished ? (S.endings[state.finished] ? S.endings[state.finished].title : 'ПРОХОД ЗАВЕРШЁН') : obj.desc) + '</div>' +
      '<div class="map-contract-reward">' + esc(state.finished ? '// АРХИВ ИСХОДОВ' : obj.reward) + '</div>';
  }
  const travel = $('#map-travel');
  if (travel) {
    travel.textContent = state.started && !state.finished ? 'ВЕРНУТЬСЯ К СЮЖЕТУ ▶' : 'В ГЛАВНОЕ МЕНЮ';
  }
}

function travel() {
  if (state.started && !state.finished) {
    navigateTo('screen-reading');
  } else {
    navigateTo('screen-menu');
  }
}

/* ─────────────────────────────  СИСТЕМА  ───────────────────────────── */

function applySettings() {
  const st = meta.settings;
  document.documentElement.setAttribute('data-theme', st.color || 'lime');
  document.documentElement.style.setProperty('--dialogue-size', (st.font || 16) + 'px');
}

function renderSystem() {
  const st = meta.settings;
  const s = (id, v) => { const e = $('#' + id); if (e) e.value = v; };
  s('sys-speed', st.speed);
  s('sys-font', st.font);
  s('sys-sfx', st.sfx);
  s('sys-music', st.music);
  $$('.color-btn').forEach(b => b.classList.toggle('active', b.dataset.color === st.color));
  renderSaveSlots();
}

function renderSaveSlots() {
  const box = $('#save-slots');
  if (!box) return;
  box.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SLOT_KEY(i)) || 'null'); } catch (e) {}
    const row = document.createElement('div');
    row.className = 'save-row';
    row.innerHTML =
      '<div class="save-info">' +
        '<div class="save-title">СЛОТ ' + i + '</div>' +
        '<div class="save-sub">' + (data
          ? 'ДЕНЬ ' + String(data.day).padStart(2, '0') + ' // ' + esc(data.time || '') + ' // ' + esc(data.where || '')
          : 'ПУСТО') + '</div>' +
      '</div>' +
      '<div class="save-actions">' +
        '<button class="btn btn-ghost" data-save>ЗАПИСАТЬ</button>' +
        (data ? '<button class="btn btn-primary" data-load>ЗАГРУЗИТЬ</button>' : '') +
      '</div>';
    row.querySelector('[data-save]').addEventListener('click', () => {
      if (!state.started) { toast('НЕТ АКТИВНОГО ПРОХОДА'); return; }
      try {
        localStorage.setItem(SLOT_KEY(i), JSON.stringify({
          day: state.day, time: state.time, where: state.where, data: deep(state)
        }));
        toast('СОХРАНЕНО В СЛОТ ' + i);
        renderSaveSlots();
      } catch (e) { toast('ОШИБКА СОХРАНЕНИЯ'); }
    });
    if (data) {
      row.querySelector('[data-load]').addEventListener('click', () => {
        confirmDialog('ЗАГРУЗИТЬ СЛОТ ' + i, 'Текущий прогресс будет заменён сохранением.', 'ЗАГРУЗИТЬ', () => {
          state = Object.assign(DEFAULT_STATE(), data.data);
          state.started = true;
          state.finished = null;
          saveRun();
          navigateTo('screen-reading');
        });
      });
    }
    box.appendChild(row);
  }
}

function resetGame() {
  confirmDialog('СБРОС ПРОГРЕССА', 'Весь текущий проход, сохранения и точки возврата будут удалены. Архив исходов и настройки сохранятся.', 'СБРОСИТЬ', () => {
    try {
      localStorage.removeItem(RUN_KEY);
      for (let i = 1; i <= 3; i++) localStorage.removeItem(SLOT_KEY(i));
    } catch (e) {}
    state = DEFAULT_STATE();
    saveRun();
    toast('ПРОГРЕСС СБРОШЕН');
    navigateTo('screen-menu', { noStack: true });
  });
}

/* ─────────────────────────────  ТОЧКИ ВОЗВРАТА  ───────────────────────────── */

function renderReturns() {
  const box = $('#returns-body');
  if (!box) return;
  const cp = state.checkpoints || [];
  const counter = $('#returns-counter');
  if (counter) counter.textContent = cp.length + ' ' + (cp.length === 1 ? 'ЗАПИСЬ' : 'ЗАПИСЕЙ');
  if (!cp.length) {
    box.innerHTML = '<div class="empty-state">ТОЧЕК ВОЗВРАТА ПОКА НЕТ.<br>ОНИ ПОЯВЛЯЮТСЯ НА КЛЮЧЕВЫХ РАЗВИЛКАХ.</div>';
    return;
  }
  box.innerHTML = cp.map((c, i) =>
    '<div class="return-card ' + (i === 0 ? 'return-lime' : 'return-magenta') + '">' +
      '<div class="return-title">День ' + String(c.day).padStart(2, '0') + ' / ' + esc(c.time) + '</div>' +
      '<div class="return-stats">' + esc(c.label) + ' · Память: ' + c.memory + '% · ' + esc(c.where) + '</div>' +
      '<div class="bar ' + (i === 0 ? 'bar-lime' : '') + '"><div class="bar-fill" style="width:' + c.memory + '%' + (i > 0 ? ';background:var(--magenta)' : '') + '"></div></div>' +
      '<button class="btn btn-ghost">[ ЗАГРУЗИТЬ ]</button>' +
    '</div>'
  ).join('') +
  '<div class="return-warning">' +
    '<div class="return-warning-tag">АРХИВ // ПРЕДУПРЕЖДЕНИЕ</div>' +
    '<div class="return-warning-title">Возврат изменит текущую ветку</div>' +
    '<div class="return-warning-desc">Несохранённые воспоминания после якоря будут утеряны. Каждый возврат — это тоже ветка.</div>' +
  '</div>';
  $$('.return-card', box).forEach((el, i) => {
    el.addEventListener('click', () => loadReturn(i));
  });
}

function loadReturn(idx) {
  const cp = state.checkpoints[idx];
  if (!cp) return;
  confirmDialog('ЗАГРУЗИТЬ ЯКОРЬ', 'Вернуться к точке «' + cp.label + '»? Текущая ветка будет перезаписана.', 'ВЕРНУТЬСЯ', () => {
    const anchors = deep(state.checkpoints);
    state = Object.assign(DEFAULT_STATE(), deep(cp.data));
    state.started = true;
    state.finished = null;
    state.checkpoints = anchors;
    saveRun();
    navigateTo('screen-reading');
    toast('ЯКОРЬ ЗАГРУЖЕН // ' + cp.label);
  });
}

function deleteAllReturns() {
  confirmDialog('УДАЛИТЬ ВСЁ', 'Удалить все точки возврата? Это необратимо.', 'УДАЛИТЬ', () => {
    state.checkpoints = [];
    saveRun();
    renderReturns();
    toast('ТОЧКИ ВОЗВРАТА УДАЛЕНЫ');
  });
}

/* ─────────────────────────────  АУДИО  ───────────────────────────── */

function renderAudio() {
  stopAudio();
  const listBox = $('#audio-list');
  if (!listBox) return;
  const unlocked = S.audio.filter(a => state.audio.includes(a.id));
  if (!unlocked.some(a => a.id === ui.audioSelected)) ui.audioSelected = unlocked[0] ? unlocked[0].id : null;

  listBox.innerHTML = S.audio.map(a => {
    const open = state.audio.includes(a.id);
    return '<div class="audio-item' + (a.id === ui.audioSelected && open ? ' active' : '') + (open ? '' : ' locked') + '" data-audio="' + a.id + '">' +
      '<div class="audio-item-title">' + (open ? '• ' : '◦ ') + esc(a.title) + (open ? '' : ' — НЕ ОТКРЫТО') + '</div>' +
      '<div class="audio-item-dur">' + (open ? a.dur : '--:--') + '</div>' +
    '</div>';
  }).join('');

  $$('.audio-item', listBox).forEach(el => {
    el.addEventListener('click', () => {
      const rec = S.audio.find(a => a.id === el.dataset.audio);
      if (!rec) return;
      if (!state.audio.includes(rec.id)) { toast('ЗАПИСЬ ЗАБЛОКИРОВАНА // ПРОДОЛЖАЙ СЮЖЕТ'); return; }
      ui.audioSelected = rec.id;
      renderAudio();
    });
  });

  const rec = S.audio.find(a => a.id === ui.audioSelected);
  const count = $('#audio-count');
  if (count) count.textContent = 'АРХИВ ГОЛОСОВ / ' + state.audio.length + ' ИЗ ' + S.audio.length;
  if (rec) {
    $('#audio-title').textContent = rec.title;
    $('#audio-transcript-text').textContent = rec.text;
    $('#audio-transcript-foot').textContent = rec.foot;
    $('#audio-transcript-tag').textContent = 'РАСШИФРОВКА // 00:24';
    $('#audio-time').textContent = 'ПАУЗА // 00:00 / ' + rec.dur;
    $('#audio-btn').textContent = 'ВОСПРОИЗВЕСТИ';
    $('#audio-wave').classList.remove('playing');
    ui.audioPos = 0;
  }
}

function parseDur(dur) {
  const p = String(dur || '0:00').split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function toggleAudio() {
  const rec = S.audio.find(a => a.id === ui.audioSelected);
  if (!rec) return;
  if (!state.audio.includes(rec.id)) { toast('ЗАПИСЬ НЕ ДОСТУПНА'); return; }
  const wave = $('#audio-wave');
  const btn = $('#audio-btn');

  if (ui.audioPlaying) { stopAudio(); return; }

  ui.audioPlaying = true;
  ui.audioPos = ui.audioPos || 0;
  wave.classList.add('playing');
  btn.textContent = 'ПАУЗА';
  const total = parseDur(rec.dur);

  clearInterval(ui.audioTimer);
  ui.audioTimer = setInterval(() => {
    ui.audioPos += 1;
    if (ui.audioPos >= total) { stopAudio(); ui.audioPos = total; }
    const t = ui.audioPos;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    $('#audio-time').textContent = 'ВОСПРОИЗВЕДЕНИЕ // ' + mm + ':' + ss + ' / ' + rec.dur;
  }, 1000);
  $('#audio-time').textContent = 'ВОСПРОИЗВЕДЕНИЕ // 00:00 / ' + rec.dur;
}

function stopAudio() {
  clearInterval(ui.audioTimer);
  ui.audioPlaying = false;
  const wave = $('#audio-wave');
  const btn = $('#audio-btn');
  if (wave) wave.classList.remove('playing');
  if (btn) btn.textContent = 'ВОСПРОИЗВЕСТИ';
}

/* ─────────────────────────────  АРХИВ  ───────────────────────────── */

function renderArchive() {
  const box = $('#archive-list');
  if (!box) return;
  const q = ($('#archive-search') ? $('#archive-search').value : '').toLowerCase().trim();
  const keys = Object.keys(S.archive);
  const count = $('#archive-count');
  if (count) count.textContent = state.archive.length + ' / ' + keys.length + ' ФРАГМЕНТОВ';

  const rows = keys.map((key, i) => {
    const rec = S.archive[key];
    const open = state.archive.includes(key);
    const tag = open ? rec.tag : '◦ ФРАГМЕНТ / НЕ ОТКРЫТ';
    const title = open ? rec.title : 'ЗАШИФРОВАНО // ' + String(i + 1).padStart(2, '0');
    return { key, rec, open, tag, title };
  }).filter(r => !q || (r.title + ' ' + r.tag).toLowerCase().includes(q));

  box.innerHTML = rows.map(r =>
    '<div class="archive-item' + (r.open ? ' archive-lime' : ' archive-locked') + (r.key === ui.archiveKey ? ' active' : '') + '" data-key="' + r.key + '">' +
      '<div class="archive-title">' + esc(r.title) + '</div>' +
      '<div class="archive-tag">' + esc(r.tag) + '</div>' +
    '</div>'
  ).join('') || '<div class="empty-state">НИЧЕГО НЕ НАЙДЕНО</div>';

  $$('.archive-item', box).forEach(el => {
    el.addEventListener('click', () => openArchive(el.dataset.key));
  });
}

function openArchive(key) {
  const rec = S.archive[key];
  if (!rec) return;
  if (!state.archive.includes(key)) { toast('ФРАГМЕНТ НЕ ОТКРЫТ // ИЩИ В СЮЖЕТЕ'); return; }
  ui.archiveKey = key;
  $('#archive-detail-title').textContent = rec.title;
  $('#archive-detail-text').textContent = rec.text;
  $('#archive-detail-foot').textContent = 'АРХИВ ИСХОДОВ // ' + rec.tag;
  renderArchive();
}

/* ─────────────────────────────  ИСХОДЫ  ───────────────────────────── */

function renderEndings() {
  const box = $('#endings-body');
  if (!box) return;
  const keys = Object.keys(S.endings);
  const unlocked = keys.filter(k => meta.endings[k]).length;
  box.innerHTML = keys.map(key => {
    const e = S.endings[key];
    const open = !!meta.endings[key];
    const when = open ? new Date(meta.endings[key]) : null;
    const date = when ? when.toLocaleDateString('ru-RU') : '';
    return '<div class="ending-card ' + (open ? 'ending-open ending-' + e.color : 'locked') + '" data-ending="' + key + '">' +
      '<div class="ending-tag">' + (open ? e.tag : '// ЗАБЛОКИРОВАНО') + '</div>' +
      '<div class="ending-title">' + (open ? esc(e.title) : 'НЕИЗВЕСТНЫЙ ИСХОД') + '</div>' +
      '<div class="ending-desc">' + esc(open ? (date ? 'ОТКРЫТО ' + date : 'ОТКРЫТО') : e.hint) + '</div>' +
      '<div class="ending-cta">' + (open ? 'ОТКРЫТЬ АРХИВ →' : 'НЕДОСТУПНО') + '</div>' +
    '</div>';
  }).join('') +
  '<div class="endings-progress">ОТКРЫТО ' + unlocked + ' ИЗ ' + keys.length + ' ИСХОДОВ // ПРОХОДОВ: ' + (meta.runs || 0) + '</div>';

  $$('.ending-card', box).forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.ending;
      if (!meta.endings[key]) { toast('ИСХОД НЕ ОТКРЫТ // ' + S.endings[key].hint); return; }
      showEndingArchive(key);
    });
  });
}

function showEndingArchive(key) {
  const e = S.endings[key];
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML =
    '<div class="modal-panel ending-modal">' +
      '<div class="ending-tag">' + esc(e.tag) + '</div>' +
      '<div class="modal-title">' + esc(e.title) + '</div>' +
      '<div class="ending-modal-text">' + e.text.map(p => '<p>' + esc(p) + '</p>').join('') + '</div>' +
      '<div class="ending-modal-epi">' + esc(e.epilogue) + '</div>' +
      '<div class="modal-actions"><button class="btn btn-ghost">ЗАКРЫТЬ</button></div>' +
    '</div>';
  document.getElementById('app').appendChild(ov);
  ov.addEventListener('click', ev => {
    if (ev.target.closest('button') || ev.target === ov) ov.remove();
  });
}

/* ─────────────────────────────  ПОСЛЕДСТВИЯ  ───────────────────────────── */

function renderConsequences() {
  const box = $('#conseq-list');
  if (!box) return;
  if (!state.consequences.length) {
    box.innerHTML = '<div class="empty-state">ПОСЛЕДСТВИЙ ПОКА НЕТ.<br>КАЖДЫЙ ВЫБОР ЗАПИСЫВАЕТСЯ В ЛЕНТУ.</div>';
    return;
  }
  box.innerHTML = state.consequences.map(c =>
    '<div class="conseq-item ' + (c.cls || 'lime') + '">' +
      '<div class="conseq-time">// ' + esc(c.time || '') + '</div>' +
      '<div class="conseq-title">' + esc(c.title || '') + '</div>' +
      '<div class="conseq-effects">' + esc(c.effects || '') + '</div>' +
      '<div class="conseq-desc">' + esc(c.desc || '') + '</div>' +
    '</div>'
  ).join('');
}

/* ─────────────────────────────  КИБЕРПСИХ  ───────────────────────────── */

function renderCyber(cfg) {
  const node = S.nodes[state.nodeId];
  const c = cfg || (node && node.cyber) || {
    sub: 'ПАМЯТЬ ' + state.memory + '% // КОНТРОЛЬ ' + state.control + '%',
    text: 'Ты теряешь себя. Айрис говорит: держись.',
    panels: [
      { cls:'danger', title:'НЕЙРО-СХОД', desc:'Контроль утерян. Действие недоступно.' },
      { cls:'iris', title:'АЙРИС // IRIS_PROTOCOL', desc:'Позволь мне подержать тебя на этой стороне.' }
    ]
  };
  $('#cyber-sub').textContent = c.sub || '';
  $('#cyber-text').textContent = c.text || '';
  $('#cyber-panels').innerHTML = (c.panels || []).map(p =>
    '<div class="cyber-panel ' + (p.cls || 'danger') + '">' +
      '<div class="cyber-panel-title">' + esc(p.title) + '</div>' +
      '<div class="cyber-panel-desc">' + esc(p.desc) + '</div>' +
    '</div>').join('');
  const portrait = $('#cyber-portrait');
  if (portrait) {
    portrait.innerHTML = '<div class="cyber-noise"></div><div class="cyber-glyph">✦</div>';
  }
}

/* ─────────────────────────────  ФИНАЛ  ───────────────────────────── */

function finishGame(endingId) {
  const e = S.endings[endingId];
  if (!e) { toast('ИСХОД НЕ НАЙДЕН'); return; }
  state.finished = endingId;
  meta.endings[endingId] = Date.now();
  state.maxDay = 4;
  saveMeta();
  saveRun();
  ui.finaleId = endingId;
  showScreen('screen-finale');
  renderFinale();
}

function renderFinale() {
  const id = ui.finaleId || state.finished;
  const e = S.endings[id];
  if (!e) { navigateTo('screen-endings'); return; }
  $('#finale-tag').textContent = e.tag;
  $('#finale-title').textContent = e.title;
  $('#finale-sub').textContent = e.epilogue;
  $('#finale-text').innerHTML = e.text.map(p => '<p>' + esc(p) + '</p>').join('');
  const decisions = state.choices.length;
  const avgTrust = Math.round((state.trust.nicks + state.trust.ren + state.trust.iris) / 3);
  $('#finale-stats').innerHTML =
    '<div class="finale-stat"><span>ПАМЯТЬ</span><span>' + state.memory + '%</span></div>' +
    '<div class="finale-stat"><span>ВЗЛОМ</span><span>' + state.hack + '</span></div>' +
    '<div class="finale-stat"><span>СРЕДНЕЕ ДОВЕРИЕ</span><span>' + avgTrust + '%</span></div>' +
    '<div class="finale-stat"><span>РЕШЕНИЙ ПРИНЯТО</span><span>' + decisions + '</span></div>' +
    '<div class="finale-stat"><span>ХРОМ</span><span>' + state.chrome + '%</span></div>' +
    '<div class="finale-stat"><span>КРЕДИТЫ</span><span>' + fmt(state.creds) + '</span></div>';
}

/* ─────────────────────────────  СТАРТ  ───────────────────────────── */

function bindStatic() {
  const speed = $('#sys-speed');
  if (speed) speed.addEventListener('input', e => {
    meta.settings.speed = Number(e.target.value); saveMeta();
  });
  const font = $('#sys-font');
  if (font) font.addEventListener('input', e => {
    meta.settings.font = Number(e.target.value);
    applySettings(); saveMeta();
  });
  const sfx = $('#sys-sfx');
  if (sfx) sfx.addEventListener('input', e => { meta.settings.sfx = Number(e.target.value); saveMeta(); });
  const music = $('#sys-music');
  if (music) music.addEventListener('input', e => { meta.settings.music = Number(e.target.value); saveMeta(); });
  $$('.color-btn').forEach(btn => btn.addEventListener('click', () => {
    meta.settings.color = btn.dataset.color;
    applySettings(); saveMeta(); renderSystem();
    toast('ЦВЕТ ИНТЕРФЕЙСА: ' + btn.dataset.color.toUpperCase());
  }));

  const dlg = $('#dialogue-text');
  if (dlg) dlg.addEventListener('click', skipTyping);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#dice-overlay').classList.contains('active')) return;
      if (ui.menuOpen) { toggleMenu(); return; }
      if (ui.screen === 'screen-reading' || ui.screen === 'screen-choice') navigateTo('screen-menu');
    }
    if ((e.key === 'Enter' || e.key === ' ') && ui.screen === 'screen-reading' &&
        !$('#dice-overlay').classList.contains('active') && !$('#ice-overlay').classList.contains('active')) {
      e.preventDefault();
      nextScene();
    }
  });

  // клик по затемнённому фону закрывает меню
  document.addEventListener('click', e => {
    if (ui.menuOpen && !e.target.closest('#side-menu') && !e.target.closest('[onclick*="toggleMenu"]')) {
      closeMenu();
    }
  });
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.addEventListener('click', e => {
      if (ui.menuOpen && e.target === appEl) closeMenu();
    });
  }
}

function boot() {
  loadMeta();
  loadRun();
  applySettings();
  bindStatic();
  renderMenu();
  showScreen('screen-menu');
  if (state.started && !state.finished) {
    // восстановить экран, если открывали посреди сцены
    const node = S.nodes[state.nodeId];
    if (node) {
      state.line = clamp(state.line, 0, Math.max(0, (node.lines || []).length - 1));
    }
  } else if (state.finished) {
    ui.finaleId = state.finished;
  }
}

/* экспорт для inline-обработчиков */
Object.assign(window, {
  startGame, continueStory, navigateTo, goBack, toggleMenu, nextScene,
  installImplant, buyItem, cancelIce, resetGame, deleteAllReturns, loadReturn,
  leaveCyber, travel, renderArchive, toggleAudio, openArchive, jumpToDay,
  handleChoice, renderReading, skipTyping
});

/* отладочный доступ к состоянию (не влияет на игру) */
window.__NEURO__ = {
  state: () => state,
  meta: () => meta
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();

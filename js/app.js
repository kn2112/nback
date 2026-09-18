// App entry: wires views, settings, history, theme, reminders and the service worker.

import { clampN, trialCount, suggestNextLevel, MIN_N, MAX_N } from './game.js';
import * as audio from './audio.js';
import * as storage from './storage.js';
import { drawChart } from './chart.js';
import * as reminders from './reminders.js';
import { createPlayView } from './play.js';

const APP_VERSION = '1.0.0';
const THEME_COLORS = { light: '#f5f5f7', dark: '#121316' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let settings = storage.loadSettings();
let history = storage.loadHistory();
let chartRange = 20;

/* ---------- Toast ---------- */

let toastTimer = null;
function hideToast() {
  $('#toast').hidden = true;
}
function showToast(message, { action, onAction, sticky = false } = {}) {
  const t = $('#toast');
  t.textContent = '';
  const span = document.createElement('span');
  span.textContent = message;
  t.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.addEventListener('click', () => { hideToast(); if (onAction) onAction(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(hideToast, 3200);
}

/* ---------- Theme ---------- */

const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');

function isDark() {
  return settings.theme === 'dark' || (settings.theme === 'system' && darkMedia.matches);
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.setAttribute('data-theme', settings.theme);
  else root.removeAttribute('data-theme');
  $('#theme-color').setAttribute('content', isDark() ? THEME_COLORS.dark : THEME_COLORS.light);
  $$('#theme-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme)));
  if (!views.history.hidden) renderChart();
}

try {
  darkMedia.addEventListener('change', applyTheme);
} catch {
  darkMedia.addListener(applyTheme); // Safari < 14
}

/* ---------- Views ---------- */

const views = {
  home: $('#view-home'),
  game: $('#view-game'),
  results: $('#view-results'),
  history: $('#view-history'),
  settings: $('#view-settings'),
};
const tabFor = { home: 'home', game: 'home', results: 'home', history: 'history', settings: 'settings' };

function showView(name) {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  document.body.classList.toggle('in-game', name === 'game');
  $$('.tabbar button').forEach((b) => {
    if (b.dataset.view === tabFor[name]) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}

$$('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------- Home ---------- */

function renderHome() {
  $('#n-value').textContent = String(settings.n);
  $('#n-down').disabled = settings.n <= MIN_N;
  $('#n-up').disabled = settings.n >= MAX_N;
  $('#round-info').textContent = `${trialCount(settings.n)} trials · ${(settings.paceMs / 1000).toFixed(1)} s each`;
}

function setN(n) {
  settings.n = clampN(n);
  storage.saveSettings(settings);
  renderHome();
}

$('#n-down').addEventListener('click', () => setN(settings.n - 1));
$('#n-up').addEventListener('click', () => setN(settings.n + 1));
$('#start-btn').addEventListener('click', startRound);

function startRound() {
  hideToast();
  showView('game');
  play.start(settings.n);
}

/* ---------- Play ---------- */

const play = createPlayView({
  getSettings: () => settings,
  onFinish: handleRoundFinished,
  onAbort: () => {
    showView('home');
    showToast('Round ended early — not saved');
  },
});

function pickStats(s) {
  return { hits: s.hits, misses: s.misses, falseAlarms: s.falseAlarms, correctRejections: s.correctRejections };
}

function handleRoundFinished(summary) {
  const record = {
    id: Date.now(),
    ts: new Date().toISOString(),
    n: summary.n,
    paceMs: settings.paceMs,
    position: summary.position.accuracy,
    letter: summary.letter.accuracy,
    combined: summary.combined,
    stats: { position: pickStats(summary.position), letter: pickStats(summary.letter) },
  };
  const result = storage.addRecord(record);
  history = result.history;
  renderResults(summary);
  showView('results');
  if (!result.saved) showToast("Couldn't save this round — storage unavailable");
}

/* ---------- Results ---------- */

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function streamDetail(s) {
  return `${plural(s.hits, 'hit', 'hits')} · ${plural(s.misses, 'miss', 'misses')} · ${plural(s.falseAlarms, 'false alarm', 'false alarms')}`;
}

function renderResults(summary) {
  $('#res-title').textContent = `Round complete · n = ${summary.n}`;
  $('#res-pos').textContent = `${summary.position.accuracy}%`;
  $('#res-pos-detail').textContent = streamDetail(summary.position);
  $('#res-let').textContent = `${summary.letter.accuracy}%`;
  $('#res-let-detail').textContent = streamDetail(summary.letter);
  $('#res-comb').textContent = `${summary.combined}%`;
  $('#res-comb-detail').textContent = `${summary.scorable} scored trials · ${(settings.paceMs / 1000).toFixed(1)} s pace`;

  const box = $('#suggestion');
  const sug = suggestNextLevel(summary.n, summary.combined);
  if (!sug) {
    box.hidden = true;
    return;
  }
  $('#sugg-text').textContent = sug.direction === 'up'
    ? `Strong round at n=${summary.n} — try n=${sug.target} next?`
    : `Tough round at n=${summary.n} — try n=${sug.target} next?`;
  const accept = $('#sugg-accept');
  accept.textContent = `Try n=${sug.target}`;
  accept.onclick = () => {
    setN(sug.target);
    box.hidden = true;
    showToast(`Next round set to n=${sug.target}`);
  };
  box.hidden = false;
}

$('#sugg-dismiss').addEventListener('click', () => { $('#suggestion').hidden = true; });
$('#again-btn').addEventListener('click', startRound);
$('#done-btn').addEventListener('click', () => showView('home'));

/* ---------- History ---------- */

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function hasPlayedToday() {
  const now = new Date();
  return history.some((r) => sameLocalDay(new Date(r.ts), now));
}

function renderChart() {
  drawChart($('#chart'), history, { range: chartRange });
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  return {
    day: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

function renderHistory() {
  const count = history.length;
  $('#stat-sessions').textContent = String(count);
  $('#stat-best').textContent = count ? String(Math.max(...history.map((r) => r.n))) : '–';
  const last = history.slice(-10);
  $('#stat-avg').textContent = count
    ? `${Math.round(last.reduce((a, r) => a + r.combined, 0) / last.length)}%`
    : '–';

  renderChart();

  const list = $('#history-list');
  list.textContent = '';
  $('#history-empty').hidden = count > 0;
  const frag = document.createDocumentFragment();
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    const { day, time } = fmtDate(r.ts);
    const li = document.createElement('li');
    li.className = 'history-item';

    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = day;
    const sub = document.createElement('small');
    sub.textContent = `${time} · ${(r.paceMs / 1000).toFixed(1)} s pace`;
    when.appendChild(sub);

    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = `n=${r.n}`;

    const acc = document.createElement('div');
    acc.className = 'acc';
    const strong = document.createElement('strong');
    strong.textContent = `${r.combined}%`;
    const detail = document.createElement('small');
    detail.textContent = `P ${r.position}% · L ${r.letter}%`;
    acc.appendChild(strong);
    acc.appendChild(detail);

    li.append(when, n, acc);
    frag.appendChild(li);
  }
  list.appendChild(frag);
}

$('#chart-range').addEventListener('change', (e) => {
  chartRange = Number(e.target.value) || 0;
  renderChart();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!views.history.hidden) renderChart(); }, 120);
});

/* ---------- Settings ---------- */

function fmtPace(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function initSettingsUI() {
  const pace = $('#pace');
  pace.min = String(storage.PACE_MIN);
  pace.max = String(storage.PACE_MAX);
  pace.step = String(storage.PACE_STEP);
  pace.value = String(settings.paceMs);
  $('#pace-value').textContent = fmtPace(settings.paceMs);
  pace.addEventListener('input', () => {
    settings.paceMs = storage.clampPace(pace.value);
    $('#pace-value').textContent = fmtPace(settings.paceMs);
  });
  pace.addEventListener('change', () => {
    settings.paceMs = storage.clampPace(pace.value);
    storage.saveSettings(settings);
    renderHome();
  });

  $$('#theme-seg button').forEach((b) => {
    b.addEventListener('click', () => {
      settings.theme = b.dataset.theme;
      storage.saveSettings(settings);
      applyTheme();
    });
  });

  const feedback = $('#feedback');
  feedback.checked = settings.feedback;
  feedback.addEventListener('change', () => {
    settings.feedback = feedback.checked;
    storage.saveSettings(settings);
  });

  $('#test-audio').addEventListener('click', () => {
    if (!audio.isSupported()) {
      showToast('Speech synthesis is not available in this browser');
      return;
    }
    audio.unlock();
    audio.speak('K');
  });

  // Reminders
  const reminder = $('#reminder');
  const reminderTime = $('#reminder-time');
  reminder.checked = settings.reminder && reminders.permission() === 'granted';
  reminderTime.value = settings.reminderTime;
  reminder.addEventListener('change', async () => {
    if (reminder.checked) {
      const perm = await reminders.requestPermission();
      if (perm !== 'granted') {
        reminder.checked = false;
        settings.reminder = false;
        storage.saveSettings(settings);
        showToast(perm === 'denied' ? 'Notifications are blocked for this site' : 'Notification permission was not granted');
        renderReminderNote();
        return;
      }
      settings.reminder = true;
      storage.saveSettings(settings);
      scheduleReminder();
      showToast(`Daily reminder set for ${settings.reminderTime}`);
    } else {
      settings.reminder = false;
      storage.saveSettings(settings);
      scheduleReminder();
    }
    renderReminderNote();
  });
  reminderTime.addEventListener('change', () => {
    if (/^\d{2}:\d{2}$/.test(reminderTime.value)) {
      settings.reminderTime = reminderTime.value;
      storage.saveSettings(settings);
      scheduleReminder();
    }
  });
  $('#test-notification').addEventListener('click', async () => {
    if (!reminders.isSupported()) {
      showToast('Notifications are not supported here');
      return;
    }
    let perm = reminders.permission();
    if (perm !== 'granted') perm = await reminders.requestPermission();
    renderReminderNote();
    if (perm !== 'granted') {
      showToast('Notification permission was not granted');
      return;
    }
    const ok = await reminders.show('Dual N-Back', 'Test notification — reminders work in this browser.');
    showToast(ok ? 'Test notification sent' : 'Could not show a notification');
  });
  renderReminderNote();

  // Install
  $('#install-btn').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch { /* ignore */ }
    installEvent = null;
    renderInstall();
  });
  renderInstall();

  // Data
  $('#clear-history').addEventListener('click', () => {
    if (!history.length) {
      showToast('History is already empty');
      return;
    }
    if (!window.confirm(`Delete all ${history.length} saved rounds? This cannot be undone.`)) return;
    history = storage.clearHistory();
    showToast('History cleared');
  });

  $('#version').textContent = `v${APP_VERSION}`;
}

function renderReminderNote() {
  const note = $('#reminder-note');
  const toggle = $('#reminder');
  const perm = reminders.permission();
  const limitation = 'Web apps can’t schedule a notification while they’re closed, so this reminder ' +
    'only fires if the app is open (or in a background tab) at the set time, or when you next open it ' +
    'after that time on a day you haven’t practised. On iPhone it also requires the app to be added ' +
    'to the Home Screen (iOS 16.4+).';
  if (perm === 'unsupported') {
    toggle.disabled = true;
    toggle.checked = false;
    note.textContent = 'Notifications aren’t supported in this browser. On iPhone, add the app to the Home Screen first (iOS 16.4+).';
    return;
  }
  toggle.disabled = false;
  if (perm === 'denied') {
    note.textContent = 'Notifications are blocked for this site. Allow them in your browser or system settings to use reminders. ' + limitation;
    return;
  }
  note.textContent = limitation;
}

function scheduleReminder() {
  reminders.schedule({ enabled: settings.reminder, time: settings.reminderTime, hasPlayedToday });
}

/* ---------- Install prompt ---------- */

let installEvent = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function renderInstall() {
  const btn = $('#install-btn');
  const note = $('#install-note');
  if (isStandalone()) {
    btn.hidden = true;
    note.textContent = 'Installed — running as an app.';
  } else if (installEvent) {
    btn.hidden = false;
    note.textContent = 'Install for a home-screen icon and full offline use.';
  } else if (isIOS()) {
    btn.hidden = true;
    note.textContent = 'On iPhone or iPad: open this page in Safari, tap Share, then “Add to Home Screen”.';
  } else {
    btn.hidden = true;
    note.textContent = 'Use your browser’s “Install app” or “Add to Home Screen” option. Everything is cached for offline use after the first load.';
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  renderInstall();
  showToast('Installed');
});

/* ---------- Service worker ---------- */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  try {
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    const promptUpdate = () => {
      if (!reg.waiting) return;
      showToast('Update available', {
        action: 'Reload',
        sticky: true,
        onAction: () => reg.waiting && reg.waiting.postMessage({ type: 'SKIP_WAITING' }),
      });
    };
    if (reg.waiting && hadController) promptUpdate();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate();
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading || play.isActive()) return;
      reloading = true;
      window.location.reload();
    });
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

/* ---------- Init ---------- */

function init() {
  applyTheme();
  renderHome();
  initSettingsUI();
  showView('home');

  audio.init();
  if (!audio.isSupported()) $('#audio-warning').hidden = false;
  if (!storage.isAvailable()) $('#storage-warning').hidden = false;

  registerServiceWorker();

  scheduleReminder();
  reminders.checkMissed({ enabled: settings.reminder, time: settings.reminderTime, hasPlayedToday });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      reminders.checkMissed({ enabled: settings.reminder, time: settings.reminderTime, hasPlayedToday });
    }
  });
}

init();

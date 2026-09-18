// Game screen controller: renders the grid, plays stimuli, handles taps and keys.
// Timing and scoring live in game.js.

import { Round, GRID_CELLS } from './game.js';
import * as audio from './audio.js';

const $ = (sel) => document.querySelector(sel);

export function createPlayView({ getSettings, onFinish, onAbort }) {
  const el = {
    status: $('#game-status'),
    grid: $('#grid'),
    overlay: $('#game-overlay'),
    fallback: $('#letter-fallback'),
    hint: $('#game-hint'),
    btnPos: $('#btn-position'),
    btnLet: $('#btn-letter'),
    stop: $('#stop-btn'),
  };

  const cells = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    el.grid.appendChild(c);
    cells.push(c);
  }

  let round = null;
  let settings = null;
  let highlightTimer = null;
  let countdownTimer = null;
  let wakeLock = null;
  const missedTimers = { position: null, letter: null };

  function buttonFor(stream) {
    return stream === 'position' ? el.btnPos : el.btnLet;
  }

  function setButtonsEnabled(on) {
    el.btnPos.disabled = !on;
    el.btnLet.disabled = !on;
  }

  function clearButtonState() {
    for (const b of [el.btnPos, el.btnLet]) b.classList.remove('pressed', 'correct', 'wrong');
  }

  function clearHighlight() {
    clearTimeout(highlightTimer);
    highlightTimer = null;
    for (const c of cells) c.classList.remove('active');
    el.fallback.hidden = true;
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch { /* not critical */ }
  }

  async function releaseWakeLock() {
    try { if (wakeLock) await wakeLock.release(); } catch { /* ignore */ }
    wakeLock = null;
  }

  function start(n) {
    settings = getSettings();
    cleanup(false);
    round = new Round({
      n,
      paceMs: settings.paceMs,
      hooks: { onTrial, onTrialEnd, onFinish: handleFinish },
    });
    clearHighlight();
    clearButtonState();
    setButtonsEnabled(false);
    el.status.textContent = `n = ${round.n} · ${round.total} trials`;
    el.hint.textContent = '';
    el.overlay.hidden = false;
    audio.unlock();
    requestWakeLock();
    countdownTimer = setTimeout(() => {
      countdownTimer = null;
      el.overlay.hidden = true;
      if (round) round.start();
    }, 1500);
  }

  function onTrial(i, trial, r) {
    clearHighlight();
    clearButtonState();
    const scorable = i >= r.n;
    setButtonsEnabled(scorable);
    el.status.textContent = `n = ${r.n} · ${i + 1} / ${r.total}`;
    if (scorable) el.hint.textContent = '';
    else if (i + 1 === r.n) el.hint.textContent = 'Responses start on the next trial';
    else el.hint.textContent = `Memorize the first ${r.n}`;

    const showMs = Math.min(1000, Math.round(r.paceMs * 0.4));
    cells[trial.pos].classList.add('active');
    if (!audio.speak(trial.letter)) {
      el.fallback.textContent = trial.letter;
      el.fallback.hidden = false;
    }
    highlightTimer = setTimeout(clearHighlight, showMs);
  }

  function onTrialEnd(i, info) {
    if (!settings || !settings.feedback || !info.scorable) return;
    if (info.missedPosition) flashMissed('position');
    if (info.missedLetter) flashMissed('letter');
  }

  function flashMissed(stream) {
    const btn = buttonFor(stream);
    clearTimeout(missedTimers[stream]);
    btn.classList.remove('missed');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('missed');
    missedTimers[stream] = setTimeout(() => btn.classList.remove('missed'), 750);
  }

  function respond(stream) {
    if (!round) return;
    const res = round.respond(stream);
    if (!res) return;
    const btn = buttonFor(stream);
    btn.classList.add('pressed');
    if (settings.feedback) btn.classList.add(res.correct ? 'correct' : 'wrong');
  }

  function handleFinish(summary, finishedRound) {
    cleanup(true);
    onFinish(summary, finishedRound);
  }

  function abort() {
    if (!round) return;
    const r = round;
    cleanup(true);
    r.stop();
    onAbort();
  }

  function cleanup(releaseLock) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
    clearHighlight();
    setButtonsEnabled(false);
    el.overlay.hidden = true;
    audio.cancel();
    if (releaseLock) releaseWakeLock();
    round = null;
  }

  el.btnPos.addEventListener('click', () => respond('position'));
  el.btnLet.addEventListener('click', () => respond('letter'));
  el.stop.addEventListener('click', abort);

  window.addEventListener('keydown', (e) => {
    if (!round || !round.running || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'a') { e.preventDefault(); respond('position'); }
    else if (k === 'l') { e.preventDefault(); respond('letter'); }
  });

  // Timers are throttled or paused in the background, which would corrupt the
  // round's timing, so a round ends if the app is hidden mid-way.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (round) abort();
    } else if (round) {
      requestWakeLock();
    }
  });

  return { start, abort, isActive: () => !!round };
}

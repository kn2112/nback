// Persistence via localStorage. Everything stays on this device.

import { clampN } from './game.js';

const SETTINGS_KEY = 'nback.settings';
const HISTORY_KEY = 'nback.history';
const MAX_RECORDS = 2000;

export const PACE_MIN = 1500;
export const PACE_MAX = 4000;
export const PACE_STEP = 100;

export const DEFAULT_SETTINGS = Object.freeze({
  n: 2,
  paceMs: 2500,
  theme: 'system',      // 'system' | 'light' | 'dark'
  feedback: true,
  reminder: false,
  reminderTime: '09:00',
});

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function isAvailable() {
  try {
    const k = 'nback.__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function clampPace(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.paceMs;
  const stepped = Math.round(v / PACE_STEP) * PACE_STEP;
  return Math.min(PACE_MAX, Math.max(PACE_MIN, stepped));
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY, {});
  const s = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  s.n = clampN(s.n);
  s.paceMs = clampPace(s.paceMs);
  if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = 'system';
  s.feedback = s.feedback !== false;
  s.reminder = s.reminder === true;
  if (!/^\d{2}:\d{2}$/.test(String(s.reminderTime))) s.reminderTime = DEFAULT_SETTINGS.reminderTime;
  return s;
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, settings);
}

function isRecord(r) {
  return r && typeof r === 'object' && typeof r.ts === 'string' &&
    Number.isFinite(r.n) && Number.isFinite(r.combined);
}

/** Chronological (oldest first). */
export function loadHistory() {
  const h = read(HISTORY_KEY, []);
  if (!Array.isArray(h)) return [];
  return h.filter(isRecord).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/** Appends a record and returns the updated history. `saved` is false if the write failed. */
export function addRecord(record) {
  const history = loadHistory();
  history.push(record);
  if (history.length > MAX_RECORDS) history.splice(0, history.length - MAX_RECORDS);
  const saved = write(HISTORY_KEY, history);
  return { history, saved };
}

export function clearHistory() {
  write(HISTORY_KEY, []);
  return [];
}

// Daily practice reminder using the Notifications API.
//
// Honest limitation: a web app cannot schedule a notification for a future time
// while it is closed (that needs a push server, which this app deliberately
// doesn't have). So this module does the best a local-only app can:
//   1. While the app is open (foreground or background tab), a timer fires the
//      reminder at the chosen time.
//   2. When the app is opened/resumed after the chosen time on a day with no
//      completed round, it fires the reminder then.
// The Settings screen explains this to the user.

const LAST_FIRED_KEY = 'nback.reminderLastFired';
const TITLE = 'Dual N-Back';
const BODY = "Time for today's n-back round.";

let timer = null;

export function isSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permission() {
  return isSupported() ? Notification.permission : 'unsupported';
}

export function requestPermission() {
  if (!isSupported()) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    try {
      // Older Safari uses the callback form and returns undefined.
      const p = Notification.requestPermission((r) => resolve(r));
      if (p && typeof p.then === 'function') p.then(resolve, () => resolve(Notification.permission));
    } catch {
      resolve(Notification.permission);
    }
  });
}

export async function show(title = TITLE, body = BODY) {
  if (!isSupported() || Notification.permission !== 'granted') return false;
  const options = { body, icon: 'icons/icon-192.png', tag: 'nback-daily-reminder' };
  // Android Chrome only allows notifications through a service worker registration.
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return true;
      }
    }
  } catch { /* fall through */ }
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

function pad2(v) { return String(v).padStart(2, '0'); }

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseTime(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || ''));
  if (!m) return { h: 9, m: 0 };
  return {
    h: Math.min(23, Math.max(0, Number(m[1]))),
    m: Math.min(59, Math.max(0, Number(m[2]))),
  };
}

function dueToday(timeStr, now = new Date()) {
  const { h, m } = parseTime(timeStr);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

function getLastFired() {
  try { return localStorage.getItem(LAST_FIRED_KEY) || ''; } catch { return ''; }
}
function setLastFired(key) {
  try { localStorage.setItem(LAST_FIRED_KEY, key); } catch { /* ignore */ }
}

async function fire(hasPlayedToday) {
  const today = dayKey();
  if (getLastFired() === today) return false;
  setLastFired(today); // mark first so we never double-fire
  if (typeof hasPlayedToday === 'function' && hasPlayedToday()) return false;
  return show();
}

/**
 * (Re)arm the in-app timer. Safe to call repeatedly; it replaces any pending timer.
 * @param {{enabled:boolean, time:string, hasPlayedToday:() => boolean}} cfg
 */
export function schedule(cfg) {
  clearTimeout(timer);
  timer = null;
  if (!cfg || !cfg.enabled || permission() !== 'granted') return;

  const now = new Date();
  let next = dueToday(cfg.time, now);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = Math.min(next.getTime() - now.getTime(), 0x7fffffff);
  timer = setTimeout(async () => {
    await fire(cfg.hasPlayedToday);
    schedule(cfg);
  }, Math.max(1000, delay));
}

/** Fire now if today's reminder time has passed and nothing was played/fired yet. */
export function checkMissed(cfg) {
  if (!cfg || !cfg.enabled || permission() !== 'granted') return;
  const now = new Date();
  if (now >= dueToday(cfg.time, now) && getLastFired() !== dayKey(now)) {
    fire(cfg.hasPlayedToday);
  }
}

export function cancel() {
  clearTimeout(timer);
  timer = null;
}

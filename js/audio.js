// Letter audio via the Web Speech API (SpeechSynthesis). No audio files needed,
// so it keeps working offline as long as the device has a local voice.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voice = null;
let unlocked = false;

export function isSupported() {
  return !!synth && typeof window.SpeechSynthesisUtterance === 'function';
}

function pickVoice() {
  if (!synth) return null;
  let voices = [];
  try { voices = synth.getVoices() || []; } catch { return null; }
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  return (
    en.find((v) => v.default) ||
    en.find((v) => v.localService) ||
    en[0] ||
    voices.find((v) => v.default) ||
    voices[0]
  );
}

export function init() {
  if (!isSupported()) return;
  voice = pickVoice();
  // Chrome and Android load voices asynchronously.
  try {
    synth.addEventListener('voiceschanged', () => { voice = pickVoice(); });
  } catch { /* older engines without addEventListener */ }
}

/**
 * iOS and some Android browsers only allow speech that was first started from a
 * user gesture. Call this from the Start button's click handler.
 */
export function unlock() {
  if (!isSupported() || unlocked) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
    unlocked = true;
  } catch { /* ignore */ }
}

/** Speak a letter. Returns false when speech is unavailable so the UI can fall back. */
export function speak(text) {
  if (!isSupported()) return false;
  try {
    // Letters are short, so this rarely triggers; it stops a backlog forming if
    // the engine is slow.
    if (synth.speaking) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || 'en-US';
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function cancel() {
  if (!isSupported()) return;
  try { synth.cancel(); } catch { /* ignore */ }
}

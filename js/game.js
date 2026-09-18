// Pure game logic: sequence generation, scoring, level suggestions, and the
// timed round runner. No DOM access here, so it is easy to test in isolation.

export const LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
export const GRID_CELLS = 9;
export const BASE_TRIALS = 20;   // a round is BASE_TRIALS + n trials
export const MIN_N = 1;
export const MAX_N = 9;
export const MATCH_RATE = 0.3;   // share of scorable trials that are matches, per stream
export const SUGGEST_UP_AT = 90;      // combined % at/above which we suggest n + 1
export const SUGGEST_DOWN_BELOW = 50; // combined % below which we suggest n - 1

export function clampN(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 2;
  return Math.min(MAX_N, Math.max(MIN_N, Math.round(v)));
}

export function trialCount(n) {
  return BASE_TRIALS + clampN(n);
}

function randInt(max, rng) {
  return Math.floor(rng() * max);
}

// Random integer in [0, max) that is never `exclude`.
function randIntExcluding(max, exclude, rng) {
  const r = randInt(max - 1, rng);
  return r >= exclude ? r + 1 : r;
}

// `count` distinct integers from [0, max), in random order.
function pickDistinct(count, max, rng) {
  const arr = Array.from({ length: max }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1, rng);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

/**
 * Build the trial list for a round. Each trial: { index, pos, letter, posMatch, letterMatch }.
 * Match flags are only ever true for trials with index >= n, and each stream gets
 * a fixed number of matches (about 30% of scorable trials) placed at random.
 */
export function generateSequence(n, rng = Math.random) {
  n = clampN(n);
  const total = trialCount(n);
  const scorable = total - n;
  const matches = Math.max(1, Math.round(scorable * MATCH_RATE));
  const posMatchIdx = new Set(pickDistinct(matches, scorable, rng).map((i) => i + n));
  const letterMatchIdx = new Set(pickDistinct(matches, scorable, rng).map((i) => i + n));

  const trials = [];
  for (let i = 0; i < total; i++) {
    if (i < n) {
      trials.push({
        index: i,
        pos: randInt(GRID_CELLS, rng),
        letter: LETTERS[randInt(LETTERS.length, rng)],
        posMatch: false,
        letterMatch: false,
      });
      continue;
    }
    const ref = trials[i - n];
    const posMatch = posMatchIdx.has(i);
    const letterMatch = letterMatchIdx.has(i);
    const pos = posMatch ? ref.pos : randIntExcluding(GRID_CELLS, ref.pos, rng);
    const letter = letterMatch
      ? ref.letter
      : LETTERS[randIntExcluding(LETTERS.length, LETTERS.indexOf(ref.letter), rng)];
    trials.push({ index: i, pos, letter, posMatch, letterMatch });
  }
  return trials;
}

/**
 * Score one stream ('position' | 'letter') over the scorable trials.
 * Accuracy follows the usual dual n-back convention:
 *   hits / (hits + misses + falseAlarms)
 * Correct rejections are tracked but do not add to the score, so never
 * responding does not produce a good percentage.
 */
export function scoreStream(trials, responses, n, stream) {
  const key = stream === 'position' ? 'posMatch' : 'letterMatch';
  let hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0;
  for (let i = n; i < trials.length; i++) {
    const isMatch = !!trials[i][key];
    const said = !!(responses[i] && responses[i][stream]);
    if (isMatch && said) hits++;
    else if (isMatch) misses++;
    else if (said) falseAlarms++;
    else correctRejections++;
  }
  const denom = hits + misses + falseAlarms;
  const accuracy = denom === 0 ? 100 : Math.round((hits / denom) * 100);
  return { hits, misses, falseAlarms, correctRejections, accuracy };
}

export function summarizeRound(trials, responses, n) {
  const position = scoreStream(trials, responses, n, 'position');
  const letter = scoreStream(trials, responses, n, 'letter');
  const combined = Math.round((position.accuracy + letter.accuracy) / 2);
  return { n, trials: trials.length, scorable: trials.length - n, position, letter, combined };
}

/** Advisory only: never changes n by itself. */
export function suggestNextLevel(n, combined) {
  n = clampN(n);
  if (combined >= SUGGEST_UP_AT && n < MAX_N) return { direction: 'up', target: n + 1 };
  if (combined < SUGGEST_DOWN_BELOW && n > MIN_N) return { direction: 'down', target: n - 1 };
  return null;
}

/**
 * Runs a round on a timer. Hooks:
 *   onTrial(index, trial, round)        - a new stimulus should be presented
 *   onTrialEnd(index, info, round)      - the response window for `index` closed
 *   onFinish(summary, round)            - the last trial ended
 *   onAbort(round)                      - stop() was called mid-round
 */
export class Round {
  constructor({ n, paceMs, trials, hooks = {}, rng = Math.random }) {
    this.n = clampN(n);
    this.paceMs = Math.max(500, Number(paceMs) || 2500);
    this.trials = trials || generateSequence(this.n, rng);
    this.hooks = hooks;
    this.responses = this.trials.map(() => ({ position: false, letter: false }));
    this.current = -1;
    this.running = false;
    this.finished = false;
    this._timer = null;
  }

  get total() { return this.trials.length; }

  start() {
    if (this.running || this.finished) return;
    this.running = true;
    this._runTrial(0);
  }

  stop() {
    if (!this.running) return;
    clearTimeout(this._timer);
    this._timer = null;
    this.running = false;
    if (this.hooks.onAbort) this.hooks.onAbort(this);
  }

  /** Record a response for the current trial. Returns null if it doesn't count. */
  respond(stream) {
    if (!this.running || this.current < this.n) return null;
    const r = this.responses[this.current];
    if (r[stream]) return null; // already committed this trial
    r[stream] = true;
    const t = this.trials[this.current];
    const isMatch = stream === 'position' ? t.posMatch : t.letterMatch;
    return { trial: this.current, stream, correct: isMatch };
  }

  _runTrial(i) {
    this.current = i;
    if (this.hooks.onTrial) this.hooks.onTrial(i, this.trials[i], this);
    this._timer = setTimeout(() => this._endTrial(i), this.paceMs);
  }

  _endTrial(i) {
    if (!this.running) return;
    const trial = this.trials[i];
    const response = this.responses[i];
    const scorable = i >= this.n;
    if (this.hooks.onTrialEnd) {
      this.hooks.onTrialEnd(i, {
        trial,
        response,
        scorable,
        missedPosition: scorable && trial.posMatch && !response.position,
        missedLetter: scorable && trial.letterMatch && !response.letter,
      }, this);
    }
    if (i + 1 < this.total) {
      this._runTrial(i + 1);
    } else {
      this.running = false;
      this.finished = true;
      if (this.hooks.onFinish) {
        this.hooks.onFinish(summarizeRound(this.trials, this.responses, this.n), this);
      }
    }
  }
}

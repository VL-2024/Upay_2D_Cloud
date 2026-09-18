export const SCENARIOS = Object.freeze({
  ZERO_0: 'ZERO_0',
  ZERO_1: 'ZERO_1',
  ONE: 'ONE',
  TWO: 'TWO',
  THREE: 'THREE',
  FIVE: 'FIVE',
  TWENTYFIVE: 'TWENTYFIVE',
  FIVEHUNDRED: 'FIVEHUNDRED',
});

// stage1Hits: how many of the first 3 strikes land.
// stage2Hits: how many of the next 3 strikes land (only reachable if stage1Hits === 3).
// khanHit: whether the final strike lands on Khan (only reachable if stage2Hits === 3).
const RULES = Object.freeze({
  [SCENARIOS.ZERO_0]: { stage1Hits: 0, stage2Hits: null, khanHit: null, multiplier: 0, result: 'Выбито 0 чуко. Выигрыш ×0' },
  [SCENARIOS.ZERO_1]: { stage1Hits: 1, stage2Hits: null, khanHit: null, multiplier: 0, result: 'Выбито 1 чуко. Выигрыш ×0' },
  [SCENARIOS.ONE]: { stage1Hits: 2, stage2Hits: null, khanHit: null, multiplier: 1, result: 'Выбито 2 чуко. Выигрыш ×1' },
  [SCENARIOS.TWO]: { stage1Hits: 3, stage2Hits: 0, khanHit: null, multiplier: 2, result: '1 УПАЙ собран! Всего 3 чуко. Выигрыш ×2' },
  [SCENARIOS.THREE]: { stage1Hits: 3, stage2Hits: 1, khanHit: null, multiplier: 3, result: 'Всего 4 чуко. Выигрыш ×3' },
  [SCENARIOS.FIVE]: { stage1Hits: 3, stage2Hits: 2, khanHit: null, multiplier: 5, result: 'Всего 5 чуко. Выигрыш ×5' },
  [SCENARIOS.TWENTYFIVE]: { stage1Hits: 3, stage2Hits: 3, khanHit: false, multiplier: 25, result: '2 УПАЙ собран! Хан устоял. Выигрыш ×25' },
  [SCENARIOS.FIVEHUNDRED]: { stage1Hits: 3, stage2Hits: 3, khanHit: true, multiplier: 500, result: 'ХАН ВЫБИТ! Главный выигрыш ×500' },
});

function buildHitPattern(hitCount, total) {
  const arr = Array.from({ length: total }, (_, i) => i < hitCount);
  return shuffle(arr);
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class ScenarioEngine {
  constructor() {
    this.order = [
      SCENARIOS.ZERO_0,
      SCENARIOS.ZERO_1,
      SCENARIOS.ONE,
      SCENARIOS.TWO,
      SCENARIOS.THREE,
      SCENARIOS.FIVE,
      SCENARIOS.TWENTYFIVE,
      SCENARIOS.FIVEHUNDRED,
    ];
    this.demoIndex = 0;
    this.current = this.order[0];
    this._initRound();
  }

  rule() { return RULES[this.current]; }

  reset({ advanceDemo = false } = {}) {
    if (advanceDemo) this.demoIndex = (this.demoIndex + 1) % this.order.length;
    this.current = this.order[this.demoIndex];
    this._initRound();
    return this.snapshot();
  }

  setScenario(code) {
    if (!RULES[code]) throw new Error(`Unknown scenario: ${code}`);
    this.current = code;
    this.demoIndex = Math.max(0, this.order.indexOf(code));
    this._initRound();
    return this.snapshot();
  }

  _initRound() {
    const r = this.rule();
    this.stage1Pattern = buildHitPattern(r.stage1Hits, 3);
    this.stage2Pattern = r.stage1Hits === 3 ? buildHitPattern(r.stage2Hits, 3) : null;
    this.stage = 'stage1';
    this.strikeIndex = 0;
    this.stage1Total = 0;
    this.stage2Total = 0;
    this.khanHit = false;
    this.finished = false;
  }

  // Will the NEXT strike (about to be thrown) land?
  peekHit() {
    if (this.finished) return false;
    if (this.stage === 'stage1') return this.stage1Pattern[this.strikeIndex];
    if (this.stage === 'stage2') return this.stage2Pattern[this.strikeIndex];
    if (this.stage === 'khan') return !!this.rule().khanHit;
    return false;
  }

  // Commits the pending strike and advances the state machine.
  resolveStrike() {
    if (this.finished) return { hit: false };
    const hit = this.peekHit();

    if (this.stage === 'khan') {
      this.khanHit = hit;
      this.finished = true;
      return { hit };
    }

    if (hit) {
      if (this.stage === 'stage1') this.stage1Total++;
      else this.stage2Total++;
    }
    this.strikeIndex++;

    if (this.strikeIndex >= 3) {
      if (this.stage === 'stage1') {
        if (this.stage1Total === 3) {
          this.stage = 'stage2';
          this.strikeIndex = 0;
        } else {
          this.finished = true;
        }
      } else if (this.stage === 'stage2') {
        if (this.stage2Total === 3) {
          this.stage = 'khan';
          this.strikeIndex = 0;
        } else {
          this.finished = true;
        }
      }
    }
    return { hit };
  }

  totalHits() { return this.stage1Total + this.stage2Total; }

  snapshot() {
    const r = this.rule();
    return {
      scenario: this.current,
      stage: this.stage,
      strikeIndex: this.strikeIndex,
      stage1Pattern: [...this.stage1Pattern],
      stage2Pattern: this.stage2Pattern ? [...this.stage2Pattern] : null,
      stage1Total: this.stage1Total,
      stage2Total: this.stage2Total,
      totalHits: this.totalHits(),
      khanHit: this.khanHit,
      finished: this.finished,
      multiplier: r.multiplier,
    };
  }

  resultText() { return this.rule().result; }
}

export const SCENARIOS = Object.freeze({
  ZERO_B: 'ZERO_B',
  ZERO_A: 'ZERO_A',
  ONE: 'ONE',
  ONE_PLUS: 'ONE_PLUS',
  TWO: 'TWO',
  KHAN: 'KHAN',
  TWO_KHAN: 'TWO_KHAN',
  ALTYN: 'ALTYN',
});

const RULES = Object.freeze({
  [SCENARIOS.ZERO_B]: { normalLimit: 1, khanRequired: false, failAfterLimit: true, result: 'Не выбит. Собрано 1/3 УПАЙ' },
  [SCENARIOS.ZERO_A]: { normalLimit: 2, khanRequired: false, failAfterLimit: true, result: 'Не выбит. Собрано 2/3 УПАЙ' },
  [SCENARIOS.ONE]: { normalLimit: 3, khanRequired: false, result: 'Билет завершён: 1 УПАЙ' },
  [SCENARIOS.ONE_PLUS]: { normalLimit: 5, khanRequired: false, result: 'Билет завершён: 1 УПАЙ + 2/3' },
  [SCENARIOS.TWO]: { normalLimit: 6, khanRequired: false, result: 'Билет завершён: 2 УПАЙ' },
  [SCENARIOS.KHAN]: { normalLimit: 3, khanRequired: true, result: 'ХАН! Билет завершён' },
  [SCENARIOS.TWO_KHAN]: { normalLimit: 6, khanRequired: true, result: '2 УПАЙ + ХАН!' },
  [SCENARIOS.ALTYN]: { normalLimit: 6, khanRequired: true, result: 'АЛТЫН УПАЙ!' },
});

export class ScenarioEngine {
  constructor() {
    this.order = [
      SCENARIOS.ZERO_B,
      SCENARIOS.ZERO_A,
      SCENARIOS.ONE,
      SCENARIOS.ONE_PLUS,
      SCENARIOS.TWO,
      SCENARIOS.KHAN,
      SCENARIOS.TWO_KHAN,
      SCENARIOS.ALTYN,
    ];
    this.demoIndex = 0;
    this.current = this.order[0];
    this.collected = 0;
    this.khanHit = false;
    this.failedStrike = false;
    this.finished = false;
  }

  rule() { return RULES[this.current]; }

  reset({ advanceDemo = false } = {}) {
    if (advanceDemo) this.demoIndex = (this.demoIndex + 1) % this.order.length;
    this.current = this.order[this.demoIndex];
    this.collected = 0;
    this.khanHit = false;
    this.failedStrike = false;
    this.finished = false;
    return this.snapshot();
  }

  setScenario(code) {
    if (!RULES[code]) throw new Error(`Unknown scenario: ${code}`);
    this.current = code;
    this.demoIndex = Math.max(0, this.order.indexOf(code));
    this.collected = 0;
    this.khanHit = false;
    this.failedStrike = false;
    this.finished = false;
    return this.snapshot();
  }

  needsFailedStrike() {
    const r = this.rule();
    return !this.finished && !!r.failAfterLimit && this.collected >= r.normalLimit && !this.failedStrike;
  }

  canCollectNormal() {
    return !this.finished && !this.khanActive() && !this.needsFailedStrike() && this.collected < this.rule().normalLimit;
  }

  registerCollection() {
    if (!this.canCollectNormal()) return this.snapshot();
    this.collected++;
    const r = this.rule();
    if (this.collected >= r.normalLimit && !r.khanRequired && !r.failAfterLimit) this.finished = true;
    return this.snapshot();
  }

  registerFailedStrike() {
    if (!this.needsFailedStrike()) return this.snapshot();
    this.failedStrike = true;
    this.finished = true;
    return this.snapshot();
  }

  khanActive() {
    const r = this.rule();
    return !this.finished && r.khanRequired && this.collected >= r.normalLimit && !this.khanHit;
  }

  registerKhanHit() {
    if (!this.khanActive()) return this.snapshot();
    this.khanHit = true;
    this.finished = true;
    return this.snapshot();
  }

  snapshot() {
    const r = this.rule();
    return {
      scenario: this.current,
      collected: this.collected,
      normalLimit: r.normalLimit,
      remaining: Math.max(0, r.normalLimit - this.collected),
      khanRequired: r.khanRequired,
      khanActive: this.khanActive(),
      failedStrikeRequired: this.needsFailedStrike(),
      failedStrike: this.failedStrike,
      khanHit: this.khanHit,
      finished: this.finished,
    };
  }

  resultText() { return this.rule().result; }
}

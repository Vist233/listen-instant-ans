/** Fixed behaviour knobs. Deliberately constants, not environment variables. */
export const tuning = {
  /** Each lane (A, B) fires once per period. */
  lanePeriodMs: 10_000,
  /** Lane B fires this long after lane A, so a request starts every 5 seconds overall. */
  laneStaggerMs: 5_000,
  runTimeoutMs: 30_000,
  /** Character-bigram Dice similarity at or above this counts as the same question. */
  dedupeThreshold: 0.9,
  /** A new question is only compared with questions shown in this recent window. */
  dedupeWindowMs: 60_000,
  /** Backstop for answers; the prompt asks for 100 characters. */
  answerHardLimit: 150,
  maxOutputTokens: 600,
}

export type Tuning = typeof tuning

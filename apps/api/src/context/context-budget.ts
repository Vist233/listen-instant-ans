export interface ContextBudget {
  readonly contextWindowTokens: number
  readonly compactionThreshold: number
}

export function shouldCompact(estimatedTokens: number, budget: ContextBudget): boolean {
  if (budget.contextWindowTokens <= 0) {
    throw new Error('contextWindowTokens must be positive')
  }
  if (budget.compactionThreshold <= 0 || budget.compactionThreshold >= 1) {
    throw new Error('compactionThreshold must be between 0 and 1')
  }
  return estimatedTokens >= budget.contextWindowTokens * budget.compactionThreshold
}

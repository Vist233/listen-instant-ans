import type { AgentSlot } from '@listen-instant-ans/contracts'
import { historyTranscriptVersionFor, type SessionState } from './session-state.js'

export const EMPTY_QA_MINIMUM_INTERVAL_MS = 5_000

export interface TurnDecision {
  readonly slot: AgentSlot
  readonly delayMs: number
}

export function nextSlot(previousSlot: AgentSlot | null): AgentSlot {
  return previousSlot === 'A' ? 'B' : 'A'
}

export function decideNextTurn(
  state: SessionState,
  previousSlot: AgentSlot | null,
  nowMs: number,
): TurnDecision | null {
  const slot = nextSlot(previousSlot)
  if (state.activeAgent !== null || state.transcriptVersion <= historyTranscriptVersionFor(state, slot)) {
    return null
  }
  const delayMs = state.consecutiveEmptyQa === 0
    ? 0
    : Math.max(0, state.lastAgentRequestAtMs + EMPTY_QA_MINIMUM_INTERVAL_MS - nowMs)
  return { slot, delayMs }
}

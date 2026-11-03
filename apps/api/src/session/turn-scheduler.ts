import type { AgentSlot } from '@listen-instant-ans/contracts'
import { historyTranscriptVersionFor, type SessionState } from './session-state.js'

export const EMPTY_QA_MINIMUM_INTERVAL_MS = 5_000
export const FAILURE_BACKOFF_MAX_MS = 60_000

export interface TurnDecision {
  readonly slot: AgentSlot
  readonly delayMs: number
}

export function nextSlot(previousSlot: AgentSlot | null): AgentSlot {
  return previousSlot === 'A' ? 'B' : 'A'
}

/** 5s, 10s, 20s ... capped at 60s after consecutive agent failures. */
export function failureBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0
  return Math.min(EMPTY_QA_MINIMUM_INTERVAL_MS * 2 ** (consecutiveFailures - 1), FAILURE_BACKOFF_MAX_MS)
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
  // The first ignore still hands over immediately; only repeated ignores are throttled.
  const emptyWaitMs = state.consecutiveEmptyQa >= 2 ? EMPTY_QA_MINIMUM_INTERVAL_MS : 0
  const waitMs = Math.max(emptyWaitMs, failureBackoffMs(state.consecutiveFailures))
  const delayMs = waitMs === 0 ? 0 : Math.max(0, state.lastAgentRequestAtMs + waitMs - nowMs)
  return { slot, delayMs }
}

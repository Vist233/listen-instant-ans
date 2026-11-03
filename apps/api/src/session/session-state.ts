import type { AgentSlot, QaResult } from '@listen-instant-ans/contracts'

export interface PreparedQa {
  readonly runId: string
  readonly result: QaResult
}

export interface SessionState {
  readonly id: string
  readonly language: string
  readonly transcriptVersion: number
  readonly handoffVersion: number
  readonly historyTranscriptVersionA: number
  readonly historyTranscriptVersionB: number
  readonly activeAgent: AgentSlot | null
  readonly preparedQaForA: PreparedQa | null
  readonly preparedQaForB: PreparedQa | null
  readonly lastAgentRequestAtMs: number
  readonly consecutiveEmptyQa: number
  readonly consecutiveFailures: number
  readonly lastCompletedSlot: AgentSlot | null
}

export function historyTranscriptVersionFor(state: SessionState, slot: AgentSlot): number {
  return slot === 'A' ? state.historyTranscriptVersionA : state.historyTranscriptVersionB
}

export function oppositeSlot(slot: AgentSlot): AgentSlot {
  return slot === 'A' ? 'B' : 'A'
}

export function preparedQaFor(state: SessionState, slot: AgentSlot): PreparedQa | null {
  return slot === 'A' ? state.preparedQaForA : state.preparedQaForB
}

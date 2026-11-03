import type { AgentSlot, QaResult, TranscriptFinal } from '@listen-instant-ans/contracts'

/** One finished turn of this slot: what it was given and what it answered. */
export interface QaPastTurn {
  readonly transcripts: readonly TranscriptFinal[]
  readonly peerQas: readonly QaResult[]
  readonly result: QaResult
}

export interface QaUsage {
  readonly inputTokens?: number
  readonly cachedInputTokens?: number
  readonly firstTokenMs?: number
}

export interface QaRunInput {
  readonly sessionId: string
  readonly slot: AgentSlot
  readonly runId: string
  /** Earlier turns of this slot, replayed byte-for-byte so the model prefix stays stable. */
  readonly past: readonly QaPastTurn[]
  /** Final speech this slot has not seen yet. */
  readonly transcripts: readonly TranscriptFinal[]
  /** Peer QAs this slot has not seen yet. */
  readonly peerQas: readonly QaResult[]
  readonly onUsage?: (usage: QaUsage) => void
}

export interface QaRunner {
  run(input: QaRunInput, signal: AbortSignal): AsyncIterable<Partial<QaResult>>
}

export class UnconfiguredQaRunner implements QaRunner {
  async *run(): AsyncIterable<Partial<QaResult>> {
    throw new Error('MIMO_API_KEY is not configured, so the QA agents cannot run.')
  }
}

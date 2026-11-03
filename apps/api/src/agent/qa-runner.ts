import type { AgentSlot, QaResult, TranscriptFinal } from '@listen-instant-ans/contracts'

export interface QaRunInput {
  readonly sessionId: string
  readonly slot: AgentSlot
  readonly runId: string
  readonly transcripts: readonly TranscriptFinal[]
  readonly historyTranscripts: readonly TranscriptFinal[]
  readonly peerQas: readonly QaResult[]
}

export interface QaRunner {
  run(input: QaRunInput, signal: AbortSignal): AsyncIterable<Partial<QaResult>>
}

export class UnconfiguredQaRunner implements QaRunner {
  async *run(): AsyncIterable<Partial<QaResult>> {
    throw new Error('The local OpenCode Go Mastra runner is not configured yet.')
  }
}

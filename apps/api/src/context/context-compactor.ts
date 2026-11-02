export interface ContextSnapshot {
  readonly agentSlot: 'A' | 'B'
  readonly startsAfterTranscriptVersion: number
  readonly endsAtTranscriptVersion: number
  readonly content: string
  readonly contentHash: string
}

export interface ContextCompactor {
  compact(input: {
    readonly agentSlot: 'A' | 'B'
    readonly transcriptText: string
    readonly startsAfterTranscriptVersion: number
    readonly endsAtTranscriptVersion: number
  }): Promise<ContextSnapshot>
}

export class UnconfiguredContextCompactor implements ContextCompactor {
  async compact(): Promise<ContextSnapshot> {
    throw new Error('Context compaction is not configured. It must not run during normal handoff.')
  }
}

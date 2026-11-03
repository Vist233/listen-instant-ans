import type { AgentSlot } from '@listen-instant-ans/contracts'
import type { QaChatMessage } from './qa-prompt.js'

export interface QaUsage {
  readonly inputTokens?: number
  readonly cachedInputTokens?: number
  readonly firstTokenMs?: number
}

export interface QaRunInput {
  readonly sessionId: string
  readonly slot: AgentSlot
  readonly runId: string
  readonly messages: readonly QaChatMessage[]
  readonly onUsage?: (usage: QaUsage) => void
}

/** Streams the model's answer as text deltas. */
export interface QaRunner {
  run(input: QaRunInput, signal: AbortSignal): AsyncIterable<string>
}

import type { Agent } from '@mastra/core/agent'
import type { AppConfig } from '../config/env.js'
import { tuning } from '../config/tuning.js'
import { createMiMoQaAgents } from './mimo-mastra-agents.js'
import type { QaRunInput, QaRunner } from './qa-runner.js'

type QaAgent = Pick<Agent, 'stream'>

/**
 * One long-lived Mastra Agent per lane. The full message list is sent on every
 * request; a stable prefix is what lets the upstream cache hit.
 */
export class MastraQaRunner implements QaRunner {
  readonly #agents = new Map<string, Readonly<Record<'A' | 'B', QaAgent>>>()

  constructor(private readonly config: AppConfig['mimo']) {}

  private agentsFor(sessionId: string): Readonly<Record<'A' | 'B', QaAgent>> {
    let agents = this.#agents.get(sessionId)
    if (agents === undefined) {
      agents = createMiMoQaAgents(this.config, sessionId)
      this.#agents.set(sessionId, agents)
    }
    return agents
  }

  async *run(input: QaRunInput, signal: AbortSignal): AsyncIterable<string> {
    const startedAt = performance.now()
    const output = await this.agentsFor(input.sessionId)[input.slot].stream(
      [...input.messages],
      {
        runId: input.runId,
        abortSignal: signal,
        modelSettings: { maxOutputTokens: tuning.maxOutputTokens, temperature: 0.2 },
      },
    )
    let firstTokenMs: number | undefined
    for await (const delta of output.textStream) {
      if (delta === '') continue
      firstTokenMs ??= Math.round(performance.now() - startedAt)
      yield delta
    }
    if (output.error !== undefined) {
      throw output.error
    }
    const usage = await output.usage
    input.onUsage?.({ inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, firstTokenMs })
  }
}

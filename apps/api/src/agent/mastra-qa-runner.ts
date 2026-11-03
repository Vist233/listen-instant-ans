import type { Agent } from '@mastra/core/agent'
import type { QaResult } from '@listen-instant-ans/contracts'
import { buildQaPrompt, qaSystemInstructions } from './qa-prompt.js'
import type { QaRunInput, QaRunner } from './qa-runner.js'
import type { AppConfig } from '../config/env.js'
import { createOpenCodeQaAgents } from './opencode-mastra-agents.js'

type QaAgent = Pick<Agent, 'stream'>

/**
 * The two slots use two long-lived Mastra Agent instances. Their model sessions
 * are deliberately not recreated here: a stable agent and prompt prefix give
 * the upstream model cache the best chance to reuse its prefix.
 */
export class MastraQaRunner implements QaRunner {
  readonly #agents = new Map<string, Readonly<Record<'A' | 'B', QaAgent>>>()

  constructor(private readonly config: AppConfig['opencode']) {}

  private agentsFor(sessionId: string): Readonly<Record<'A' | 'B', QaAgent>> {
    let agents = this.#agents.get(sessionId)
    if (agents === undefined) {
      agents = createOpenCodeQaAgents(this.config, sessionId)
      this.#agents.set(sessionId, agents)
    }
    return agents
  }

  async *run(input: QaRunInput, signal: AbortSignal): AsyncIterable<Partial<QaResult>> {
    const output = await this.agentsFor(input.sessionId)[input.slot].stream(
      [{ role: 'user', content: buildQaPrompt(input) }],
      {
        runId: input.runId,
        abortSignal: signal,
        instructions: qaSystemInstructions,
        structuredOutput: {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ignore', 'answer', 'needs_clarification'] },
              question: { type: ['string', 'null'] },
              answer: { type: ['string', 'null'] },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    url: { type: 'string' },
                  },
                  required: ['title', 'url'],
                },
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['status', 'question', 'answer', 'sources', 'confidence'],
            additionalProperties: false,
          },
        },
      },
    )
    for await (const partial of output.objectStream) {
      yield partial as Partial<QaResult>
    }
    if (output.error !== undefined) {
      throw output.error
    }
  }
}

import { Agent } from '@mastra/core/agent'
import type { AppConfig } from '../config/env.js'
import { qaSystemInstructions } from './qa-prompt.js'

export function createOpenCodeQaAgents(config: AppConfig['opencode'], sessionId: string): Record<'A' | 'B', Agent> {
  if (config.apiKey === undefined || config.apiKey === '') {
    throw new Error('OPENCODE_API_KEY is required to create the QA agents.')
  }
  return {
    A: createAgent('A', config, sessionId),
    B: createAgent('B', config, sessionId),
  }
}

function createAgent(slot: 'A' | 'B', config: AppConfig['opencode'], sessionId: string): Agent {
  return new Agent({
    id: `listen-instant-ans-${slot.toLowerCase()}`,
    name: `ListenInstantAns ${slot}`,
    instructions: qaSystemInstructions,
    model: {
      providerId: 'opencode-go',
      modelId: config.model,
      url: config.baseUrl,
      apiKey: config.apiKey,
      api: 'chat',
      headers: {
        // Stable within one business session and slot; never shared across sessions.
        'x-opencode-session': `listen-instant-ans:${sessionId}:${slot.toLowerCase()}:0`,
      },
    },
  })
}

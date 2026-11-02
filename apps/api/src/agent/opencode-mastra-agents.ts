import { Agent } from '@mastra/core/agent'
import type { AppConfig } from '../config/env.js'
import { qaSystemInstructions } from './qa-prompt.js'

export function createOpenCodeQaAgents(config: AppConfig['opencode']): Record<'A' | 'B', Agent> {
  if (config.apiKey === undefined || config.apiKey === '') {
    throw new Error('OPENCODE_API_KEY is required to create the QA agents.')
  }
  return {
    A: createAgent('A', config),
    B: createAgent('B', config),
  }
}

function createAgent(slot: 'A' | 'B', config: AppConfig['opencode']): Agent {
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
        // A stable session label lets the upstream service identify this long-lived slot.
        'x-opencode-session': `listen-instant-ans-${slot.toLowerCase()}`,
      },
    },
  })
}

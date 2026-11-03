import type { AppConfig } from '../config/env.js'
import { MastraQaRunner } from '../agent/mastra-qa-runner.js'
import { UnconfiguredQaRunner, type QaRunner } from '../agent/qa-runner.js'

export function createConfiguredRunner(config: AppConfig): QaRunner {
  return config.opencode.apiKey === undefined
    ? new UnconfiguredQaRunner()
    : new MastraQaRunner(config.opencode)
}

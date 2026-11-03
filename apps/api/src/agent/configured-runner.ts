import type { AppConfig } from '../config/env.js'
import { SettingsError } from '../config/settings-store.js'
import { MastraQaRunner } from './mastra-qa-runner.js'
import type { QaRunInput, QaRunner } from './qa-runner.js'

/**
 * Follows the settings: it builds the real runner on first use and again
 * whenever the key, model or address changes, so no restart is needed.
 */
export class ReloadableQaRunner implements QaRunner {
  #key = ''
  #inner: QaRunner | null = null

  constructor(
    private readonly currentMimo: () => AppConfig['mimo'],
    private readonly create: (mimo: AppConfig['mimo']) => QaRunner = (mimo) => new MastraQaRunner(mimo),
  ) {}

  async *run(input: QaRunInput, signal: AbortSignal): AsyncIterable<string> {
    const mimo = this.currentMimo()
    if (!mimo.apiKey) {
      throw new SettingsError('MiMo API Key 未设置，请在“设置”里填写。')
    }
    const key = JSON.stringify([mimo.apiKey, mimo.model, mimo.baseUrl])
    if (this.#inner === null || key !== this.#key) {
      this.#inner = this.create(mimo)
      this.#key = key
    }
    yield* this.#inner.run(input, signal)
  }
}

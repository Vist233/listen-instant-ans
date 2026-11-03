import type { QaRunInput, QaRunner } from './qa-runner.js'

export type TurnOutcome =
  | { readonly kind: 'completed'; readonly text: string }
  | { readonly kind: 'timeout'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string; readonly message: string }

export interface RunTurnOptions {
  readonly controller: AbortController
  readonly timeoutMs: number
  /** Called for every streamed delta, until the turn times out. */
  readonly onDelta: (delta: string) => void
}

/**
 * Runs one request to the model. It never throws and does not touch storage or
 * events: it only reports how the request ended and the text received so far.
 */
export async function runTurn(runner: QaRunner, input: QaRunInput, options: RunTurnOptions): Promise<TurnOutcome> {
  let text = ''
  let timedOut = false
  const run = (async (): Promise<void> => {
    for await (const delta of runner.run(input, options.controller.signal)) {
      text += delta
      if (!timedOut) options.onDelta(delta)
    }
  })()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), options.timeoutMs)
  })
  try {
    const outcome = await Promise.race([run.then(() => 'done' as const), timeout])
    if (outcome === 'timeout') {
      timedOut = true
      options.controller.abort()
      void run.catch(() => undefined)
      return { kind: 'timeout', text }
    }
    return { kind: 'completed', text }
  } catch (error) {
    return { kind: 'error', text, message: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

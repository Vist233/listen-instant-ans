import type { SessionEvent } from '@listen-instant-ans/contracts'
import type { QaRunInput, QaRunner } from '../src/agent/qa-runner.js'
import { createApplication, type Application } from '../src/bootstrap.js'
import type { Tuning } from '../src/config/tuning.js'
import type { EventHub } from '../src/events/event-hub.js'
import type { VoiceSessionFactory } from '../src/runtime/session-runtime-manager.js'
import type { MicrophoneList } from '../src/voice/ffmpeg-microphone.js'

export type Script = (input: QaRunInput, call: number, signal: AbortSignal) => AsyncIterable<string>

/** A model that streams whatever the test script says, and records every request. */
export class ScriptedRunner implements QaRunner {
  readonly inputs: QaRunInput[] = []
  constructor(private readonly script: Script) {}
  run(input: QaRunInput, signal: AbortSignal): AsyncIterable<string> {
    const call = this.inputs.length
    this.inputs.push(input)
    return this.script(input, call, signal)
  }
}

export async function* say(...chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk
}

/** Blocks until the signal is aborted, like a model that never answers. */
export function hang(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
}

export function qaText(...pairs: Array<[string, string]>): string {
  return pairs.map(([question, answer]) => `Q: ${question}\nA: ${answer}\n`).join('')
}

export function waitFor(events: EventHub, predicate: (event: SessionEvent) => boolean, timeoutMs = 2000): Promise<SessionEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Timed out waiting for an event')) }, timeoutMs)
    const unsubscribe = events.subscribe((event) => {
      if (!predicate(event)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
  })
}

export function record(events: EventHub): SessionEvent[] {
  const seen: SessionEvent[] = []
  events.subscribe((event) => seen.push(event))
  return seen
}

export interface TestAppOptions {
  readonly tuning?: Partial<Tuning>
  readonly now?: () => number
  readonly autoStartLanes?: boolean
  readonly voiceSessionFactory?: VoiceSessionFactory
  readonly microphones?: () => Promise<MicrophoneList>
  readonly env?: NodeJS.ProcessEnv
}

export function createTestApp(runner: QaRunner, options: TestAppOptions = {}): Application {
  return createApplication({
    env: options.env ?? {},
    settingsPath: null,
    runner,
    databasePath: ':memory:',
    voiceSessionFactory: options.voiceSessionFactory,
    microphones: options.microphones,
    controller: { autoStartLanes: options.autoStartLanes ?? false, now: options.now, tuning: options.tuning },
  })
}

export function say1(app: Application, sessionId: string, text: string): void {
  app.controller.appendFinalTranscript(sessionId, { startedAtMs: 0, endedAtMs: 1, text, confidence: 1 })
}

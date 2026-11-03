import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { VoiceSession, type Microphone } from '../src/runtime/voice-session.js'
import type { VoiceProvider, VoiceSessionConfig } from '../src/voice/voice-provider.js'
import { ScriptedRunner, createTestApp, record, say } from './helpers.js'

class StubMicrophone implements Microphone {
  started = false
  stopped = false
  #audio: Array<(audio: Uint8Array) => void> = []
  #errors: Array<(error: Error) => void> = []
  start(): void { this.started = true }
  stop(): void { this.stopped = true }
  onAudio(listener: (audio: Uint8Array) => void): () => void { this.#audio.push(listener); return () => undefined }
  onError(listener: (error: Error) => void): () => void { this.#errors.push(listener); return () => undefined }
  emitAudio(audio: Uint8Array): void { this.#audio.forEach((listener) => listener(audio)) }
  emitError(error: Error): void { this.#errors.forEach((listener) => listener(error)) }
}

class StubProvider implements VoiceProvider {
  opened: VoiceSessionConfig | null = null
  sent: Uint8Array[] = []
  finalized = 0
  closed = 0
  throwOnSend = false
  #partial: Array<(text: string) => void> = []
  #final: Array<(event: { startedAtMs: number; endedAtMs: number; text: string; confidence: number | null }) => void> = []
  #error: Array<(error: Error) => void> = []
  async open(config: VoiceSessionConfig): Promise<void> { this.opened = config }
  sendAudio(chunk: Uint8Array): void { if (this.throwOnSend) throw new Error('socket closed'); this.sent.push(chunk) }
  async finalize(): Promise<void> { this.finalized++ }
  async close(): Promise<void> { this.closed++ }
  onPartial(listener: (text: string) => void): () => void { this.#partial.push(listener); return () => undefined }
  onFinal(listener: (event: { startedAtMs: number; endedAtMs: number; text: string; confidence: number | null }) => void): () => void { this.#final.push(listener); return () => undefined }
  onError(listener: (error: Error) => void): () => void { this.#error.push(listener); return () => undefined }
  emitPartial(text: string): void { this.#partial.forEach((listener) => listener(text)) }
  emitFinal(text: string): void { this.#final.forEach((listener) => listener({ startedAtMs: 0, endedAtMs: 1, text, confidence: 1 })) }
  emitError(error: Error): void { this.#error.forEach((listener) => listener(error)) }
}

function setup() {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  app.controller.start('s', 'zh-CN')
  const microphone = new StubMicrophone()
  const provider = new StubProvider()
  const fatal: Error[] = []
  const session = new VoiceSession('s', app.controller, microphone, provider, '0', (error) => fatal.push(error))
  return { app, microphone, provider, fatal, session }
}

test('audio goes to the transcriber, finals are stored, partials are only published', async () => {
  const { app, microphone, provider, session } = setup()
  const seen = record(app.events)
  await session.start()
  assert.deepEqual([provider.opened?.sampleRateHz, microphone.started], [16_000, true])
  microphone.emitAudio(new Uint8Array([1, 2]))
  provider.emitPartial('你好')
  provider.emitFinal('你好。')
  assert.deepEqual(provider.sent, [new Uint8Array([1, 2])])
  assert.deepEqual(app.sessions.transcripts('s').map((item) => [item.sequence, item.text]), [[1, '你好。']])
  assert.deepEqual(seen.map((event) => event.type), ['transcript.partial', 'transcript.final'])
  app.controller.stop('s')
})

test('starting listening again on the same session continues the sequence instead of colliding', async () => {
  const { app, provider, session } = setup()
  await session.start()
  provider.emitFinal('第一场的一句')
  await session.stop()

  const microphone = new StubMicrophone()
  const secondProvider = new StubProvider()
  const second = new VoiceSession('s', app.controller, microphone, secondProvider, '0', () => undefined)
  await second.start()
  secondProvider.emitFinal('第二场的一句')
  assert.deepEqual(app.sessions.transcripts('s').map((item) => [item.sequence, item.text]), [[1, '第一场的一句'], [2, '第二场的一句']])
  app.controller.stop('s')
})

test('a transcript that cannot be stored does not crash the voice session', async () => {
  const { provider, session } = setup()
  await session.start()
  assert.doesNotThrow(() => provider.emitFinal('   '))
})

test('a microphone or transcriber failure is reported once', async () => {
  const { microphone, provider, fatal, session } = setup()
  await session.start()
  microphone.emitError(new Error('ffmpeg died'))
  provider.emitError(new Error('also broken'))
  assert.deepEqual(fatal.map((error) => error.message), ['ffmpeg died'])
})

test('a send failure is reported as fatal', async () => {
  const { microphone, provider, fatal, session } = setup()
  await session.start()
  provider.throwOnSend = true
  microphone.emitAudio(new Uint8Array([1]))
  assert.deepEqual(fatal.map((error) => error.message), ['socket closed'])
})

test('stop silences the microphone, finalizes and closes the transcriber, and stops the lanes', async () => {
  const { app, microphone, provider, fatal, session } = setup()
  await session.start()
  provider.emitFinal('一句')
  const stopLanes = mock.method(app.controller, 'stop')
  await session.stop()
  assert.deepEqual([microphone.stopped, provider.finalized, provider.closed], [true, 1, 1])
  assert.deepEqual(stopLanes.mock.calls.map((call) => call.arguments), [['s']])
  microphone.emitAudio(new Uint8Array([1]))
  microphone.emitError(new Error('late noise'))
  assert.equal(provider.sent.length, 0)
  assert.deepEqual(fatal, [])
})

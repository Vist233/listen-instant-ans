import assert from 'node:assert/strict'
import test, { after, before, beforeEach } from 'node:test'
import { AliyunRealtimeTranscriber } from '../src/voice/aliyun-realtime-transcriber.js'

class FakeWebSocket extends EventTarget {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  static refuse = 0
  static autoComplete = true
  readyState = 0
  sent: Array<string | Uint8Array> = []

  constructor(readonly url: URL) {
    super()
    FakeWebSocket.instances.push(this)
    setTimeout(() => {
      if (FakeWebSocket.refuse > 0) {
        FakeWebSocket.refuse--
        this.readyState = 3
        this.dispatchEvent(new Event('error'))
        this.dispatchEvent(new Event('close'))
        return
      }
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    }, 0)
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
    if (typeof data !== 'string') return
    const name = JSON.parse(data).header.name
    if (name === 'StartTranscription') setTimeout(() => this.receive('TranscriptionStarted'), 0)
    if (name === 'StopTranscription' && FakeWebSocket.autoComplete) setTimeout(() => this.receive('TranscriptionCompleted'), 0)
  }

  receive(name: string, payload: object = {}): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ header: { name }, payload }) }))
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

const original = globalThis.WebSocket
before(() => { globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket })
after(() => { globalThis.WebSocket = original })
beforeEach(() => {
  FakeWebSocket.instances = []
  FakeWebSocket.refuse = 0
  FakeWebSocket.autoComplete = true
})

const credentials = { appKey: 'app', token: 'tok', endpoint: 'wss://example.invalid/ws' }
const timings = { reconnectAttempts: 3, reconnectBaseDelayMs: 5, finalizeWaitMs: 40 }
const config = { language: 'zh-CN', sampleRateHz: 16_000, endpointingMs: 800 } as const

async function until(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

test('open sends StartTranscription with the app key and token, and waits for TranscriptionStarted', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  await transcriber.open(config)
  const [socket] = FakeWebSocket.instances
  assert.equal(socket.url.searchParams.get('token'), 'tok')
  const start = JSON.parse(socket.sent[0] as string)
  assert.equal(start.header.name, 'StartTranscription')
  assert.equal(start.header.appkey, 'app')
  assert.equal(start.payload.sample_rate, 16_000)
  assert.equal(start.payload.max_sentence_silence, 800)
  await transcriber.close()
})

test('partial and final results are reported; empty ones are ignored', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  const partials: string[] = []
  const finals: string[] = []
  transcriber.onPartial((text) => partials.push(text))
  transcriber.onFinal((event) => finals.push(event.text))
  await transcriber.open(config)
  const [socket] = FakeWebSocket.instances
  socket.receive('TranscriptionResultChanged', { result: '你好' })
  socket.receive('TranscriptionResultChanged', { result: '  ' })
  socket.receive('SentenceEnd', { result: '你好。', begin_time: 1, time: 2, confidence: 0.9 })
  assert.deepEqual([partials, finals], [['你好'], ['你好。']])
  await transcriber.close()
})

test('audio is sent while open and dropped, not thrown, while closed', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  assert.doesNotThrow(() => transcriber.sendAudio(new Uint8Array([1])))
  assert.equal(transcriber.droppedAudioChunks, 1)
  await transcriber.open(config)
  transcriber.sendAudio(new Uint8Array([1, 2, 3]))
  assert.deepEqual(FakeWebSocket.instances[0].sent.at(-1), new Uint8Array([1, 2, 3]))
  assert.equal(transcriber.droppedAudioChunks, 1)
  await transcriber.close()
})

test('a dropped connection is re-established, and audio during the gap is dropped', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  const errors: Error[] = []
  transcriber.onError((error) => errors.push(error))
  await transcriber.open(config)
  FakeWebSocket.instances[0].close()
  transcriber.sendAudio(new Uint8Array([9]))
  assert.equal(transcriber.droppedAudioChunks, 1)
  await until(() => FakeWebSocket.instances.length === 2 && FakeWebSocket.instances[1].sent.length > 0)
  await new Promise((resolve) => setTimeout(resolve, 5))
  transcriber.sendAudio(new Uint8Array([7]))
  assert.deepEqual(FakeWebSocket.instances[1].sent.at(-1), new Uint8Array([7]))
  assert.equal(JSON.parse(FakeWebSocket.instances[1].sent[0] as string).header.name, 'StartTranscription')
  assert.deepEqual(errors, [])
  await transcriber.close()
})

test('after the retries run out, one error is reported', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  const errors: Error[] = []
  transcriber.onError((error) => errors.push(error))
  await transcriber.open(config)
  FakeWebSocket.refuse = 100
  FakeWebSocket.instances[0].close()
  await until(() => errors.length === 1)
  assert.equal(FakeWebSocket.instances.length, 1 + timings.reconnectAttempts)
  assert.match(errors[0].message, /could not be restored/)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(errors.length, 1)
})

test('a failed first connection rejects open without starting a reconnect loop', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  FakeWebSocket.refuse = 1
  await assert.rejects(transcriber.open(config), /Unable to open/)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(FakeWebSocket.instances.length, 1)
})

test('after close() a dropped connection is not re-established', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  await transcriber.open(config)
  await transcriber.close()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(FakeWebSocket.instances.length, 1)
})

test('finalize waits for TranscriptionCompleted so the last sentence is not lost', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  const finals: string[] = []
  transcriber.onFinal((event) => finals.push(event.text))
  await transcriber.open(config)
  const [socket] = FakeWebSocket.instances
  FakeWebSocket.autoComplete = false
  const finalizing = transcriber.finalize()
  setTimeout(() => { socket.receive('SentenceEnd', { result: '最后一句' }); socket.receive('TranscriptionCompleted') }, 10)
  const startedAt = Date.now()
  await finalizing
  assert.deepEqual(finals, ['最后一句'])
  assert.ok(Date.now() - startedAt < timings.finalizeWaitMs)
  assert.equal(JSON.parse(socket.sent.at(-1) as string).header.name, 'StopTranscription')
  await transcriber.close()
})

test('finalize gives up after the wait if the service never completes', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  await transcriber.open(config)
  FakeWebSocket.autoComplete = false
  const startedAt = Date.now()
  await transcriber.finalize()
  assert.ok(Date.now() - startedAt >= timings.finalizeWaitMs - 5)
  await transcriber.close()
})

test('TaskFailed is reported as an error', async () => {
  const transcriber = new AliyunRealtimeTranscriber(credentials, timings)
  const errors: Error[] = []
  transcriber.onError((error) => errors.push(error))
  await transcriber.open(config)
  FakeWebSocket.instances[0].receive('TaskFailed')
  assert.equal(errors.length, 1)
  await transcriber.close()
})

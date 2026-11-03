import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { QaResult } from '@listen-instant-ans/contracts'
import { EventHub } from '../src/events/event-hub.js'
import type { QaRunner } from '../src/agent/qa-runner.js'
import { SessionController } from '../src/session/session-controller.js'
import { EMPTY_QA_MINIMUM_INTERVAL_MS, decideNextTurn, failureBackoffMs } from '../src/session/turn-scheduler.js'
import { buildQaMessages } from '../src/agent/qa-prompt.js'
import { openDatabase } from '../src/storage/database.js'
import { SessionRepository } from '../src/storage/session-repository.js'

const answer: QaResult = {
  status: 'answer',
  question: '牛顿第二定律是什么？',
  answer: '合力等于质量乘以加速度。',
  sources: [],
  confidence: 0.95,
}

class FixedRunner implements QaRunner {
  constructor(private readonly result: QaResult) {}

  async *run(): AsyncIterable<Partial<QaResult>> {
    yield this.result
  }
}

class CapturingRunner implements QaRunner {
  readonly inputs: Parameters<QaRunner['run']>[0][] = []
  async *run(input: Parameters<QaRunner['run']>[0]): AsyncIterable<Partial<QaResult>> {
    this.inputs.push(input)
    yield answer
  }
}

function createRepository(): SessionRepository {
  return new SessionRepository(openDatabase(':memory:'))
}

test('realtime QA E2E dataset has the required reproducible cases', () => {
  const path = join(import.meta.dirname, 'fixtures', 'realtime-qa-e2e.json')
  const dataset = JSON.parse(readFileSync(path, 'utf8')) as { version: number; cases: Array<{ id: string; transcripts: string[]; expects: string[] }> }
  assert.equal(dataset.version, 1)
  assert.deepEqual(dataset.cases.map((item) => item.id), ['single-question', 'two-questions', 'timeout-retention', 'answer-display-limit'])
  assert.ok(dataset.cases.every((item) => item.transcripts.length > 0 && item.expects.length > 0))
})

test('successful QA advances the transcript handoff and prepares only the peer slot', async () => {
  const repository = createRepository()
  const events = new EventHub()
  const controller = new SessionController(repository, new FixedRunner(answer), events, () => 100)
  controller.start('session-1', 'zh-CN')

  const completed = new Promise<void>((resolve) => {
    events.subscribe((event) => {
      if (event.type === 'qa.completed') resolve()
    })
  })
  controller.appendFinalTranscript('session-1', {
    sequence: 1,
    startedAtMs: 0,
    endedAtMs: 100,
    text: '老师问牛顿第二定律是什么？',
    confidence: 0.99,
  })
  await completed

  const state = repository.get('session-1')
  assert.equal(state.handoffVersion, 1)
  assert.equal(state.preparedQaForA, null)
  assert.deepEqual(state.preparedQaForB?.result, answer)
  assert.equal(state.lastCompletedSlot, 'A')
})

test('the first ignore hands over immediately and only repeated ignores are throttled', () => {
  const repository = createRepository()
  repository.create('session-2', 'zh-CN', 0)
  for (const sequence of [1, 2]) {
    repository.appendTranscript('session-2', {
      sequence, startedAtMs: 0, endedAtMs: 100, text: '嗯……', confidence: 0.9,
    }, 100)
  }
  const ignore: QaResult = { status: 'ignore', question: null, answer: null, sources: [], confidence: 0.9 }
  repository.markRunStarted('session-2', 'A', 'run-1', 1, 100)
  repository.completeRun('session-2', 'A', 'run-1', ignore, 1, 200)
  repository.advanceAgentHistory('session-2', 'A', 1, 200)

  let state = repository.get('session-2')
  assert.equal(state.handoffVersion, 0)
  assert.equal(state.consecutiveEmptyQa, 1)
  assert.deepEqual(decideNextTurn(state, state.lastCompletedSlot, 201), { slot: 'B', delayMs: 0 })

  repository.markRunStarted('session-2', 'B', 'run-2', 2, 300)
  repository.completeRun('session-2', 'B', 'run-2', ignore, 2, 400)
  repository.advanceAgentHistory('session-2', 'B', 2, 400)
  repository.appendTranscript('session-2', { sequence: 3, startedAtMs: 0, endedAtMs: 100, text: '嗯', confidence: 0.9 }, 410)
  state = repository.get('session-2')
  assert.equal(state.consecutiveEmptyQa, 2)
  assert.deepEqual(
    decideNextTurn(state, state.lastCompletedSlot, 401),
    { slot: 'A', delayMs: 300 + EMPTY_QA_MINIMUM_INTERVAL_MS - 401 },
  )
})

test('failure backoff doubles from 5s and is capped at 60s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(failureBackoffMs), [0, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000])
})

test('message list is append-only so earlier turns stay a byte-identical prefix', () => {
  const first = { transcripts: [{ sequence: 1, startedAtMs: 0, endedAtMs: 1, text: '第一句', confidence: 1 }], peerQas: [] }
  const second = { transcripts: [{ sequence: 2, startedAtMs: 0, endedAtMs: 1, text: '第二句', confidence: 1 }], peerQas: [answer] }
  const turn1 = buildQaMessages([], first)
  const turn2 = buildQaMessages([{ ...first, result: answer }], second)
  assert.deepEqual(turn2.slice(0, turn1.length), turn1)
  assert.equal(turn2[1].role, 'assistant')
  assert.equal(turn2.length, 3)
  assert.match(turn2[2].content, /第二句/)
  assert.match(turn2[2].content, /牛顿第二定律/)
})

test('each agent is given its own past turns, only unseen speech, and only unseen peer QAs', async () => {
  const repository = createRepository()
  const events = new EventHub()
  const runner = new CapturingRunner()
  const controller = new SessionController(repository, runner, events, () => 100)
  controller.start('session-3', 'zh-CN')
  const completedSlots: string[] = []
  const waitFor = (count: number) => new Promise<void>((resolve) => {
    const check = () => { if (completedSlots.length >= count) resolve() }
    events.subscribe((event) => { if (event.type === 'qa.completed') { completedSlots.push(event.slot); check() } })
  })
  const first = waitFor(2)
  controller.appendFinalTranscript('session-3', { sequence: 1, startedAtMs: 0, endedAtMs: 1, text: '第一句', confidence: 1 })
  await first
  assert.equal(runner.inputs.length, 2)
  assert.deepEqual(runner.inputs[0].past, [])
  assert.deepEqual(runner.inputs[0].transcripts.map((item) => item.text), ['第一句'])
  assert.equal(runner.inputs[0].peerQas.length, 0)
  assert.deepEqual(runner.inputs[1].past, [])
  assert.deepEqual(runner.inputs[1].transcripts.map((item) => item.text), ['第一句'])
  assert.equal(runner.inputs[1].peerQas.length, 1)

  const third = new Promise<void>((resolve) => events.subscribe((event) => { if (event.type === 'qa.completed' && completedSlots.length >= 3) resolve() }))
  controller.appendFinalTranscript('session-3', { sequence: 2, startedAtMs: 0, endedAtMs: 1, text: '第二句', confidence: 1 })
  await third
  const again = runner.inputs[2]
  assert.equal(again.slot, 'A')
  assert.equal(again.past.length, 1)
  assert.deepEqual(again.past[0].transcripts.map((item) => item.text), ['第一句'])
  assert.deepEqual(again.past[0].result, answer)
  assert.deepEqual(again.transcripts.map((item) => item.text), ['第二句'])
  assert.equal(again.peerQas.length, 1)
})

test('a timed-out run is cancelled without consuming its input speech', () => {
  const repository = createRepository()
  repository.create('session-4', 'zh-CN', 0)
  for (const sequence of [1, 2, 3]) {
    repository.appendTranscript('session-4', {
      sequence, startedAtMs: sequence, endedAtMs: sequence, text: `语音 ${sequence}`, confidence: 1,
    }, sequence)
  }
  repository.advanceAgentHistory('session-4', 'A', 1, 10)
  repository.markRunStarted('session-4', 'A', 'run-timeout', 3, 11)
  repository.skipRun('session-4', 'A', 'run-timeout', 12)

  const state = repository.get('session-4')
  assert.equal(state.historyTranscriptVersionA, 1)
  assert.equal(state.activeAgent, null)
  assert.equal(state.consecutiveEmptyQa, 0)
  assert.equal(state.consecutiveFailures, 1)
  assert.deepEqual(repository.listSlotTurns('session-4', 'A'), [])
  assert.deepEqual(repository.listTranscriptsAfter('session-4', state.historyTranscriptVersionA).map((item) => item.sequence), [2, 3])
  assert.deepEqual(
    decideNextTurn(state, state.lastCompletedSlot, 12),
    { slot: 'B', delayMs: EMPTY_QA_MINIMUM_INTERVAL_MS - 1 },
  )
})

test('sendAudio drops audio instead of throwing while the transcriber socket is down', async () => {
  const { AliyunRealtimeTranscriber } = await import('../src/voice/aliyun-realtime-transcriber.js')
  const transcriber = new AliyunRealtimeTranscriber({ appKey: 'k', token: 't', endpoint: 'wss://localhost.invalid' })
  assert.doesNotThrow(() => transcriber.sendAudio(new Uint8Array([1, 2])))
  assert.equal(transcriber.droppedAudioChunks, 1)
})

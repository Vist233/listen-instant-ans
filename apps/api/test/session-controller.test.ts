import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { QaResult } from '@listen-instant-ans/contracts'
import { EventHub } from '../src/events/event-hub.js'
import type { QaRunner } from '../src/agent/qa-runner.js'
import { SessionController } from '../src/session/session-controller.js'
import { EMPTY_QA_MINIMUM_INTERVAL_MS, decideNextTurn } from '../src/session/turn-scheduler.js'
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

test('ignore never advances the handoff cursor and throttles the next attempt', () => {
  const repository = createRepository()
  repository.create('session-2', 'zh-CN', 0)
  repository.appendTranscript('session-2', {
    sequence: 1,
    startedAtMs: 0,
    endedAtMs: 100,
    text: '嗯……',
    confidence: 0.9,
  }, 100)
  repository.markRunStarted('session-2', 'A', 'run-1', 1, 100)
  repository.completeRun('session-2', 'A', 'run-1', {
    status: 'ignore', question: null, answer: null, sources: [], confidence: 0.9,
  }, 1, 200)

  const state = repository.get('session-2')
  assert.equal(state.handoffVersion, 0)
  assert.equal(state.consecutiveEmptyQa, 1)
  assert.equal(state.lastCompletedSlot, 'A')
  assert.deepEqual(
    decideNextTurn(state, state.lastCompletedSlot, 201),
    { slot: 'B', delayMs: EMPTY_QA_MINIMUM_INTERVAL_MS - 101 },
  )
})

test('each agent receives its prior history, all missing speech, and every peer QA', async () => {
  const repository = createRepository()
  const events = new EventHub()
  const runner = new CapturingRunner()
  const controller = new SessionController(repository, runner, events, () => 100)
  controller.start('session-3', 'zh-CN')
  const done = new Promise<void>((resolve) => events.subscribe((event) => { if (event.type === 'qa.completed' && event.slot === 'B') resolve() }))
  controller.appendFinalTranscript('session-3', { sequence: 1, startedAtMs: 0, endedAtMs: 1, text: '第一句', confidence: 1 })
  await done
  assert.equal(runner.inputs.length, 2)
  assert.deepEqual(runner.inputs[0].historyTranscripts, [])
  assert.deepEqual(runner.inputs[0].transcripts.map((item) => item.text), ['第一句'])
  assert.deepEqual(runner.inputs[1].historyTranscripts, [])
  assert.deepEqual(runner.inputs[1].transcripts.map((item) => item.text), ['第一句'])
  assert.equal(runner.inputs[1].peerQas.length, 1)
  assert.equal(repository.get('session-3').historyTranscriptVersionA, 1)
  assert.equal(repository.get('session-3').historyTranscriptVersionB, 1)
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
  assert.deepEqual(repository.listTranscriptsAfter('session-4', state.historyTranscriptVersionA).map((item) => item.sequence), [2, 3])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { openDatabase } from '../src/storage/database.js'
import { SessionRepository } from '../src/storage/session-repository.js'

const final = (text: string) => ({ startedAtMs: 0, endedAtMs: 1, text, confidence: 1 })

function createRepository(): SessionRepository {
  const repository = new SessionRepository(openDatabase(':memory:'))
  repository.create('s', 'zh-CN', 0)
  return repository
}

function startRun(repository: SessionRepository, runId: string, slot: 'A' | 'B', endVersion = 1, peerCursor = 0): void {
  repository.startRun({ sessionId: 's', slot, runId, startVersion: 0, endVersion, inputText: `in-${runId}`, peerCursor, nowMs: 10 })
}

const qa = (runId: string, slot: 'A' | 'B', question: string, status: 'shown' | 'duplicate' = 'shown', nowMs = 100) =>
  ({ sessionId: 's', runId, slot, question, answer: `answer to ${question}`, status, nowMs })

test('the repository assigns transcript sequences, independently per session', () => {
  const repository = createRepository()
  repository.create('other', 'zh-CN', 0)
  assert.equal(repository.appendTranscript('s', final('一'), 1).sequence, 1)
  assert.equal(repository.appendTranscript('s', final('二'), 2).sequence, 2)
  assert.equal(repository.appendTranscript('other', final('甲'), 3).sequence, 1)
  assert.equal(repository.get('s').transcriptVersion, 2)
  assert.deepEqual(repository.transcripts('s', 1).map((item) => item.text), ['二'])
})

test('a transcript for an unknown session or with empty text is rejected', () => {
  const repository = createRepository()
  assert.throws(() => repository.appendTranscript('nope', final('x'), 1), /Session not found: nope/)
  assert.throws(() => repository.appendTranscript('s', final('   '), 1), /must not be empty/)
  assert.equal(repository.appendTranscript('s', final('  有空格  '), 1).text, '有空格')
  assert.equal(repository.get('s').transcriptVersion, 1)
})

test('sessions are listed most recently updated first', () => {
  const repository = createRepository()
  repository.create('later', 'zh-CN', 5)
  repository.appendTranscript('s', final('x'), 50)
  assert.deepEqual(repository.list().map((item) => item.id), ['s', 'later'])
})

test('only completed runs are replayed, in order, with their stored text', () => {
  const repository = createRepository()
  repository.appendTranscript('s', final('一'), 1)
  startRun(repository, 'r1', 'A', 1)
  assert.deepEqual(repository.laneTurns('s', 'A'), [])
  repository.completeRun('r1', 'Q: a\nA: b\n', 20)
  startRun(repository, 'r2', 'A', 2, 3)
  repository.cancelRun('r2', 'boom', 'partial', 30)
  startRun(repository, 'r3', 'B', 2)
  repository.completeRun('r3', '-', 40)
  startRun(repository, 'r4', 'A', 3, 7)
  repository.completeRun('r4', '-', 50)
  assert.deepEqual(repository.laneTurns('s', 'A'), [
    { inputText: 'in-r1', outputText: 'Q: a\nA: b\n', endVersion: 1, peerCursor: 0 },
    { inputText: 'in-r4', outputText: '-', endVersion: 3, peerCursor: 7 },
  ])
  assert.equal(repository.laneTurns('s', 'B').length, 1)
})

test('runs left running by a crash are cancelled on startup', () => {
  const repository = createRepository()
  startRun(repository, 'r1', 'A')
  startRun(repository, 'r2', 'B')
  repository.completeRun('r2', '-', 20)
  assert.equal(repository.cancelInterruptedRuns(99), 1)
  const runs = repository.listRuns('s')
  assert.deepEqual(runs.map((run) => run.status), ['cancelled', 'completed'])
  assert.equal(runs[0].errorMessage, 'Interrupted by restart.')
  assert.equal(repository.cancelInterruptedRuns(100), 0)
})

test('peer QAs are the other lane\'s shown QAs after the cursor', () => {
  const repository = createRepository()
  startRun(repository, 'a', 'A')
  startRun(repository, 'b', 'B')
  const a1 = repository.saveQa(qa('a', 'A', '甲？'))
  const b1 = repository.saveQa(qa('b', 'B', '乙？'))
  repository.saveQa(qa('a', 'A', '丙？', 'duplicate'))
  const a2 = repository.saveQa(qa('a', 'A', '丁？'))
  assert.ok(a1 < b1 && b1 < a2)
  assert.deepEqual(repository.peerQasAfter('s', 'B', 0).map((item) => item.question), ['甲？', '丁？'])
  assert.deepEqual(repository.peerQasAfter('s', 'B', a1).map((item) => item.question), ['丁？'])
  assert.deepEqual(repository.peerQasAfter('s', 'A', 0).map((item) => item.question), ['乙？'])
})

test('recent shown questions respect the time window and skip duplicates', () => {
  const repository = createRepository()
  startRun(repository, 'a', 'A')
  repository.saveQa(qa('a', 'A', '旧题？', 'shown', 100))
  repository.saveQa(qa('a', 'A', '新题？', 'shown', 500))
  repository.saveQa(qa('a', 'A', '重复？', 'duplicate', 600))
  assert.deepEqual(repository.recentShownQuestions('s', 400), ['新题？'])
  assert.deepEqual(repository.recentShownQuestions('s', 0), ['旧题？', '新题？'])
})

test('usage, output text and errors are visible in the run list', () => {
  const repository = createRepository()
  startRun(repository, 'a', 'A')
  repository.recordUsage('a', { inputTokens: 100, cachedInputTokens: 64, firstTokenMs: 321 })
  repository.completeRun('a', 'Q: x\nA: y\n', 99)
  const [run] = repository.listRuns('s')
  assert.deepEqual(
    [run.status, run.inputTokens, run.cachedInputTokens, run.firstTokenMs, run.outputText, run.endedAtMs],
    ['completed', 100, 64, 321, 'Q: x\nA: y\n', 99],
  )
})

test('the timeline holds transcripts, QAs and runs', () => {
  const repository = createRepository()
  repository.appendTranscript('s', final('一'), 1)
  startRun(repository, 'a', 'A')
  repository.saveQa(qa('a', 'A', '甲？'))
  const timeline = repository.timeline('s')
  assert.equal(timeline.transcripts.length, 1)
  assert.equal(timeline.qas.length, 1)
  assert.equal(timeline.runs.length, 1)
  assert.throws(() => repository.timeline('nope'), /Session not found/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ScriptedRunner, createTestApp, hang, qaText, record, say, say1, waitFor } from './helpers.js'

function setup(runner: ScriptedRunner, options: Parameters<typeof createTestApp>[1] = {}) {
  const app = createTestApp(runner, options)
  app.controller.start('s', 'zh-CN')
  return app
}

test('a lane with nothing new to hear does not start a request', async () => {
  const runner = new ScriptedRunner(() => say('-'))
  const app = setup(runner)
  await app.controller.tick('s', 'A')
  assert.equal(runner.inputs.length, 0)
  say1(app, 's', '一句话')
  await app.controller.tick('s', 'A')
  await app.controller.tick('s', 'A')
  assert.equal(runner.inputs.length, 1)
})

test('each pair is saved and shown as soon as it is complete, and the reply is stored verbatim', async () => {
  const reply = 'Q: 牛顿第二定律？\nA: F=ma。\nQ: 动能？\nA: 能量。\n'
  const runner = new ScriptedRunner(async function* (input) {
    input.onUsage?.({ inputTokens: 120, cachedInputTokens: 64, firstTokenMs: 7 })
    yield* say('Q: 牛顿', '第二定律？\nA: F=', 'ma。\nQ: 动能？\nA: 能量。\n')
  })
  const app = setup(runner)
  const seen = record(app.events)
  say1(app, 's', '老师提了两个问题')
  await app.controller.tick('s', 'A')

  const types = seen.map((event) => event.type)
  assert.deepEqual(types.filter((type) => type !== 'qa.partial'), ['transcript.final', 'agent.started', 'qa.completed', 'qa.completed', 'agent.finished'])
  assert.ok(types.includes('qa.partial'))
  const completed = seen.filter((event) => event.type === 'qa.completed')
  assert.deepEqual(completed.map((event) => [event.question, event.answer]), [['牛顿第二定律？', 'F=ma。'], ['动能？', '能量。']])
  assert.ok(completed[0].qaId < completed[1].qaId)

  const [turn] = app.sessions.laneTurns('s', 'A')
  assert.equal(turn.outputText, reply)
  assert.match(turn.inputText, /老师提了两个问题/)
  const [run] = app.sessions.listRuns('s')
  assert.deepEqual([run.status, run.inputTokens, run.cachedInputTokens, run.firstTokenMs], ['completed', 120, 64, 7])
  assert.deepEqual(app.controller.activeSlots('s'), [])
})

test('a reply of "-" saves nothing, and an empty reply is stored as "-"', async () => {
  for (const reply of ['-', '', '\n']) {
    const app = setup(new ScriptedRunner(() => say(reply)))
    const seen = record(app.events)
    say1(app, 's', '没有问题的一句话')
    await app.controller.tick('s', 'A')
    assert.equal(app.sessions.allQas('s').length, 0, JSON.stringify(reply))
    assert.equal(app.sessions.laneTurns('s', 'A')[0].outputText, '-', JSON.stringify(reply))
    assert.equal(seen.filter((event) => event.type === 'qa.completed').length, 0)
  }
})

test('the next request replays the earlier turn byte for byte', async () => {
  const runner = new ScriptedRunner((_input, call) => say(qaText([`第 ${call} 题？`, '答。'])))
  const app = setup(runner)
  say1(app, 's', '第一段')
  await app.controller.tick('s', 'A')
  say1(app, 's', '第二段')
  await app.controller.tick('s', 'A')
  const [first, second] = runner.inputs
  assert.equal(first.messages.length, 1)
  assert.equal(second.messages.length, 3)
  assert.deepEqual(second.messages.slice(0, 2), [...first.messages, { role: 'assistant', content: qaText(['第 0 题？', '答。']) }])
  const last = second.messages[2].content
  assert.match(last, /第二段/)
  assert.doesNotMatch(last, /第一段/)
})

test('lane B is told what A has finished and what A is still writing, and never gets it twice', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const runner = new ScriptedRunner(async function* (input) {
    if (input.slot === 'A') {
      yield qaText(['甲？', '乙。'])
      yield 'Q: 丙？\nA: 写到'
      await gate
      yield '一半。\n'
    } else {
      yield '-'
    }
  })
  const app = setup(runner)
  say1(app, 's', '老师的话')
  const writing = waitFor(app.events, (event) => event.type === 'qa.partial' && event.slot === 'A' && event.answer === '写到')
  const lane = app.controller.tick('s', 'A')
  await writing
  assert.deepEqual(app.controller.activeSlots('s'), ['A'])

  await app.controller.tick('s', 'B')
  assert.match(runner.inputs[1].messages.at(-1)!.content, /Q: 甲？\nA: 乙。\n\nQ: 丙？\nA: 写到（未写完）/)

  release()
  await lane
  assert.deepEqual(app.sessions.allQas('s').map((item) => [item.question, item.answer]), [['甲？', '乙。'], ['丙？', '写到一半。']])

  say1(app, 's', '又一句')
  await app.controller.tick('s', 'B')
  const later = runner.inputs[2].messages.at(-1)!.content
  assert.match(later, /Q: 丙？\nA: 写到一半。/)
  assert.doesNotMatch(later, /甲？/)
})

test('a lane is never started twice at the same time', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const runner = new ScriptedRunner(async function* () { await gate; yield '-' })
  const app = setup(runner)
  say1(app, 's', '一句')
  const first = app.controller.tick('s', 'A')
  await app.controller.tick('s', 'A')
  assert.equal(runner.inputs.length, 1)
  release()
  await first
  assert.equal(app.sessions.listRuns('s').length, 1)
})

test('both lanes may run at once, each on its own history', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const runner = new ScriptedRunner(async function* () { await gate; yield '-' })
  const app = setup(runner)
  say1(app, 's', '一句')
  const a = app.controller.tick('s', 'A')
  const b = app.controller.tick('s', 'B')
  assert.deepEqual(app.controller.activeSlots('s'), ['A', 'B'])
  release()
  await Promise.all([a, b])
  assert.deepEqual(app.controller.activeSlots('s'), [])
})

test('a question that is already shown is saved as a duplicate and never displayed', async () => {
  const runner = new ScriptedRunner((input) => say(input.slot === 'A'
    ? qaText(['牛顿第二定律是什么？', 'F=ma。'])
    : qaText(['牛顿第二定律是什么', 'F=ma'])))
  const app = setup(runner)
  say1(app, 's', '老师问了一个问题')
  await app.controller.tick('s', 'A')
  const seen = record(app.events)
  await app.controller.tick('s', 'B')
  assert.deepEqual(app.sessions.allQas('s').map((item) => [item.slot, item.status]), [['A', 'shown'], ['B', 'duplicate']])
  assert.deepEqual(seen.filter((event) => event.type === 'qa.partial' || event.type === 'qa.completed'), [])
  assert.equal(seen.filter((event) => event.type === 'agent.finished').length, 1)
})

test('the same question is shown again once the dedupe window has passed', async () => {
  let now = 1_000_000
  const runner = new ScriptedRunner(() => say(qaText(['牛顿第二定律是什么？', 'F=ma。'])))
  const app = setup(runner, { now: () => now })
  say1(app, 's', '第一次问')
  await app.controller.tick('s', 'A')
  now += 61_000
  say1(app, 's', '又问了一遍')
  await app.controller.tick('s', 'B')
  assert.deepEqual(app.sessions.allQas('s').map((item) => item.status), ['shown', 'shown'])
})

test('a failed request keeps the pairs it already saved, drops the unfinished one and resends the same speech', async () => {
  const runner = new ScriptedRunner(async function* (_input, call) {
    if (call === 0) {
      yield qaText(['x？', 'y。'])
      yield 'Q: z？\nA: w'
      throw new Error('boom')
    }
    yield '-'
  })
  const app = setup(runner)
  const seen = record(app.events)
  say1(app, 's', '这段话要被重发')
  await app.controller.tick('s', 'A')

  const [run] = app.sessions.listRuns('s')
  assert.deepEqual([run.status, run.errorMessage], ['cancelled', 'boom'])
  assert.deepEqual(app.sessions.allQas('s').map((item) => item.question), ['x？'])
  assert.deepEqual(app.sessions.laneTurns('s', 'A'), [])
  assert.equal(seen.filter((event) => event.type === 'agent.failed').length, 1)

  await app.controller.tick('s', 'A')
  assert.equal(runner.inputs[1].messages.length, 1)
  assert.match(runner.inputs[1].messages[0].content, /这段话要被重发/)
  assert.equal(app.sessions.laneTurns('s', 'A').length, 1)
})

test('a request that times out is cancelled and its unfinished pair is dropped', async () => {
  const runner = new ScriptedRunner(async function* (_input, _call, signal) {
    yield 'Q: a？\nA: b'
    await hang(signal)
  })
  const app = setup(runner, { tuning: { runTimeoutMs: 30 } })
  const seen = record(app.events)
  say1(app, 's', '一句')
  await app.controller.tick('s', 'A')
  const [run] = app.sessions.listRuns('s')
  assert.equal(run.status, 'cancelled')
  assert.match(run.errorMessage ?? '', /Timed out/)
  assert.equal(app.sessions.allQas('s').length, 0)
  assert.equal(seen.filter((event) => event.type === 'agent.failed').length, 1)
  assert.deepEqual(app.controller.activeSlots('s'), [])
})

test('stopping cancels requests in flight', async () => {
  const runner = new ScriptedRunner(async function* (_input, _call, signal) { await hang(signal) })
  const app = setup(runner)
  say1(app, 's', '一句')
  const started = waitFor(app.events, (event) => event.type === 'agent.started')
  const lane = app.controller.tick('s', 'A')
  await started
  app.controller.stop('s')
  await lane
  const [run] = app.sessions.listRuns('s')
  assert.deepEqual([run.status, run.errorMessage], ['cancelled', 'Cancelled.'])
})

test('a lane that throws on startup does not get stuck', async () => {
  let fail = true
  const runner = new ScriptedRunner(() => { if (fail) throw new Error('no key'); return say('-') })
  const app = setup(runner)
  say1(app, 's', '一句')
  await app.controller.tick('s', 'A')
  assert.equal(app.sessions.listRuns('s')[0].status, 'cancelled')
  fail = false
  await app.controller.tick('s', 'A')
  assert.equal(app.sessions.laneTurns('s', 'A').length, 1)
})

test('over-long answers are cut at the hard limit', async () => {
  const runner = new ScriptedRunner(() => say(qaText(['问？', '一二三四五六七八九十十一十二'])))
  const app = setup(runner, { tuning: { answerHardLimit: 10 } })
  say1(app, 's', '一句')
  await app.controller.tick('s', 'A')
  assert.equal(app.sessions.allQas('s')[0].answer, '一二三四五六七八九十…')
})

test('a transcript starts the lane clock, and both lanes then take their turn', async () => {
  const runner = new ScriptedRunner(() => say('-'))
  const app = setup(runner, { autoStartLanes: true, tuning: { lanePeriodMs: 40, laneStaggerMs: 20 } })
  const finished = waitFor(app.events, (event) => event.type === 'agent.finished' && event.slot === 'B')
  say1(app, 's', '一句')
  await finished
  assert.deepEqual(runner.inputs.map((input) => input.slot), ['A', 'B'])
  app.controller.stop('s')
})

test('transcript sequences keep counting for the whole session', () => {
  const app = setup(new ScriptedRunner(() => say('-')))
  say1(app, 's', '一')
  say1(app, 's', '二')
  assert.deepEqual(app.sessions.transcripts('s').map((item) => item.sequence), [1, 2])
})

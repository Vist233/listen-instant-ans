import assert from 'node:assert/strict'
import test from 'node:test'
import { runTurn } from '../src/agent/run-turn.js'
import { ScriptedRunner, hang, say } from './helpers.js'

const input = { sessionId: 's', slot: 'A', runId: 'r', messages: [] } as const

test('completed: all deltas are delivered in order', async () => {
  const runner = new ScriptedRunner(() => say('Q: a', '\nA: b\n'))
  const deltas: string[] = []
  const outcome = await runTurn(runner, input, { controller: new AbortController(), timeoutMs: 1000, onDelta: (d) => deltas.push(d) })
  assert.deepEqual(outcome, { kind: 'completed', text: 'Q: a\nA: b\n' })
  assert.deepEqual(deltas, ['Q: a', '\nA: b\n'])
})

test('timeout: aborts the request and keeps the text received so far', async () => {
  const controller = new AbortController()
  const runner = new ScriptedRunner(async function* (_i, _c, signal) { yield 'Q: a\n'; await hang(signal) })
  const deltas: string[] = []
  const outcome = await runTurn(runner, input, { controller, timeoutMs: 20, onDelta: (d) => deltas.push(d) })
  assert.deepEqual(outcome, { kind: 'timeout', text: 'Q: a\n' })
  assert.equal(controller.signal.aborted, true)
  assert.deepEqual(deltas, ['Q: a\n'])
})

test('deltas that arrive after the timeout are not delivered', async () => {
  const runner = new ScriptedRunner(async function* () {
    await new Promise((resolve) => setTimeout(resolve, 60))
    yield 'late'
  })
  const deltas: string[] = []
  const outcome = await runTurn(runner, input, { controller: new AbortController(), timeoutMs: 10, onDelta: (d) => deltas.push(d) })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(outcome.kind, 'timeout')
  assert.deepEqual(deltas, [])
})

test('error: reports the message and the text received so far', async () => {
  const runner = new ScriptedRunner(async function* () { yield 'partial'; throw new Error('boom') })
  const outcome = await runTurn(runner, input, { controller: new AbortController(), timeoutMs: 1000, onDelta: () => undefined })
  assert.deepEqual(outcome, { kind: 'error', text: 'partial', message: 'boom' })
})

test('an abort from outside ends the turn as an error', async () => {
  const controller = new AbortController()
  const runner = new ScriptedRunner(async function* (_i, _c, signal) { await hang(signal) })
  const pending = runTurn(runner, input, { controller, timeoutMs: 1000, onDelta: () => undefined })
  controller.abort()
  assert.equal((await pending).kind, 'error')
})

test('a runner that throws before streaming does not escape', async () => {
  const runner = new ScriptedRunner(() => { throw new Error('sync boom') })
  const outcome = await runTurn(runner, input, { controller: new AbortController(), timeoutMs: 1000, onDelta: () => undefined })
  assert.equal(outcome.kind, 'error')
})

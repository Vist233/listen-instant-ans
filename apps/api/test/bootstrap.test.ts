import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createApplication } from '../src/bootstrap.js'
import { loadConfig } from '../src/config/env.js'
import { ScriptedRunner, qaText, say, say1 } from './helpers.js'

function withDatabase(work: (path: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'listen-instant-ans-'))
  return work(join(directory, 'test.sqlite')).finally(() => rmSync(directory, { recursive: true, force: true }))
}

const open = (path: string, runner: ScriptedRunner) =>
  createApplication(loadConfig({}), { runner, databasePath: path, controller: { autoStartLanes: false } })

test('a run left running by a crash is cancelled on restart and the lane works again', () => withDatabase(async (path) => {
  const first = open(path, new ScriptedRunner(() => say('-')))
  first.controller.start('s', 'zh-CN')
  say1(first, 's', '崩溃前的一句')
  first.sessions.startRun({ sessionId: 's', slot: 'A', runId: 'orphan', startVersion: 0, endVersion: 1, inputText: 'x', peerCursor: 0, nowMs: 1 })
  assert.equal(first.sessions.listRuns('s')[0].status, 'running')

  const runner = new ScriptedRunner(() => say(qaText(['问？', '答。'])))
  const second = open(path, runner)
  const [orphan] = second.sessions.listRuns('s')
  assert.deepEqual([orphan.status, orphan.errorMessage], ['cancelled', 'Interrupted by restart.'])

  await second.controller.tick('s', 'A')
  assert.equal(runner.inputs.length, 1)
  assert.match(runner.inputs[0].messages[0].content, /崩溃前的一句/)
  assert.deepEqual(second.sessions.allQas('s').map((item) => item.question), ['问？'])
}))

test('after a restart the lane replays its earlier turns byte for byte', () => withDatabase(async (path) => {
  const reply = qaText(['第一题？', '第一答。'])
  const firstRunner = new ScriptedRunner(() => say(reply))
  const first = open(path, firstRunner)
  first.controller.start('s', 'zh-CN')
  say1(first, 's', '第一段')
  await first.controller.tick('s', 'A')
  const sent = firstRunner.inputs[0].messages[0].content

  const secondRunner = new ScriptedRunner(() => say('-'))
  const second = open(path, secondRunner)
  say1(second, 's', '第二段')
  await second.controller.tick('s', 'A')
  assert.deepEqual(secondRunner.inputs[0].messages.slice(0, 2), [
    { role: 'user', content: sent },
    { role: 'assistant', content: reply },
  ])
  assert.deepEqual(second.sessions.transcripts('s').map((item) => item.sequence), [1, 2])
}))

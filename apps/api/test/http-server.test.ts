import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import type { Application } from '../src/bootstrap.js'
import { createHttpServer } from '../src/http/create-http-server.js'
import { ScriptedRunner, createTestApp, qaText, say, waitFor } from './helpers.js'

const webRoot = join(import.meta.dirname, '../../web')

async function withServer(
  app: Application,
  work: (base: string) => Promise<void>,
): Promise<void> {
  const server: Server = createHttpServer(app, webRoot)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function call(base: string, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test('health, creating and listing sessions', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    assert.deepEqual(await call(base, '/health'), { status: 200, body: { ok: true } })
    const created = await call(base, '/sessions', 'POST', { language: 'zh-CN' })
    assert.equal(created.status, 201)
    assert.equal(created.body.listening, false)
    const list = await call(base, '/sessions')
    assert.equal(list.body.length, 1)
    assert.deepEqual([list.body[0].id, list.body[0].activeAgent, list.body[0].listening], [created.body.id, null, false])
    const one = await call(base, `/sessions/${created.body.id}`)
    assert.deepEqual(one.body.activeSlots, [])
  })
})

test('unknown sessions are 404 and bad transcripts are 400', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    assert.equal((await call(base, '/sessions/nope')).status, 404)
    assert.equal((await call(base, '/sessions/nope/timeline')).status, 404)
    assert.equal((await call(base, '/sessions/nope/transcripts', 'POST', { startedAtMs: 0, endedAtMs: 1, text: 'x' })).status, 404)
    const { body } = await call(base, '/sessions', 'POST', {})
    assert.equal((await call(base, `/sessions/${body.id}/transcripts`, 'POST', { startedAtMs: 0, endedAtMs: 1, text: '  ' })).status, 400)
    assert.equal((await call(base, `/sessions/${body.id}/transcripts`, 'POST', { text: 'x' })).status, 400)
    assert.equal((await call(base, '/nothing-here')).status, 404)
  })
})

test('posted transcripts get server-assigned sequences and show up in the timeline with QAs and runs', async () => {
  const app = createTestApp(new ScriptedRunner(() => say(qaText(['牛顿第二定律？', 'F=ma。']))))
  await withServer(app, async (base) => {
    const { body: session } = await call(base, '/sessions', 'POST', {})
    const first = await call(base, `/sessions/${session.id}/transcripts`, 'POST', { sequence: 99, startedAtMs: 0, endedAtMs: 1, text: '老师问牛顿第二定律' })
    const second = await call(base, `/sessions/${session.id}/transcripts`, 'POST', { startedAtMs: 1, endedAtMs: 2, text: '继续', confidence: 0.9 })
    assert.deepEqual([first.status, first.body.sequence, second.body.sequence], [202, 1, 2])
    await app.controller.tick(session.id, 'A')
    const timeline = (await call(base, `/sessions/${session.id}/timeline`)).body
    assert.deepEqual(timeline.transcripts.map((item: any) => item.text), ['老师问牛顿第二定律', '继续'])
    assert.deepEqual(timeline.qas.map((item: any) => [item.question, item.status, item.slot]), [['牛顿第二定律？', 'shown', 'A']])
    assert.deepEqual(timeline.runs.map((item: any) => item.status), ['completed'])
  })
})

test('the event stream delivers QAs as they are saved', async () => {
  const app = createTestApp(new ScriptedRunner(() => say(qaText(['甲？', '乙。']))))
  await withServer(app, async (base) => {
    const { body: session } = await call(base, '/sessions', 'POST', {})
    const other = (await call(base, '/sessions', 'POST', {})).body
    const response = await fetch(`${base}/sessions/${session.id}/events`)
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const first = await reader.read()
    assert.match(decoder.decode(first.value), /connected/)

    app.controller.start('unused', 'zh-CN')
    await call(base, `/sessions/${other.id}/transcripts`, 'POST', { startedAtMs: 0, endedAtMs: 1, text: '别的会话' })
    await call(base, `/sessions/${session.id}/transcripts`, 'POST', { startedAtMs: 0, endedAtMs: 1, text: '一句' })
    await app.controller.tick(other.id, 'A')
    await app.controller.tick(session.id, 'A')
    let received = ''
    const deadline = Date.now() + 2000
    while (!received.includes('qa.completed')) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining))])
      if (chunk === null || chunk.done) break
      received += decoder.decode(chunk.value)
    }
    await reader.cancel()
    assert.match(received, /"type":"qa.completed"[^\n]*"question":"甲？"/)
    assert.doesNotMatch(received, /别的会话/)
  })
})

test('starting to listen without Aliyun credentials explains what is missing', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    const { body: session } = await call(base, '/sessions', 'POST', {})
    const started = await call(base, `/sessions/${session.id}/listening/start`, 'POST', {})
    assert.equal(started.status, 400)
    assert.match(started.body.error, /ALIYUN_APP_ID/)
    assert.equal((await call(base, '/sessions/nope/listening/start', 'POST', {})).status, 404)
  })
})

test('listening can be started and stopped through the runtime manager', async () => {
  const calls: string[] = []
  const app = createTestApp(new ScriptedRunner(() => say('-')), {
    voiceSessionFactory: (_sessionId, device) => ({
      start: async () => { calls.push(`start ${device}`) },
      stop: async () => { calls.push('stop') },
    }),
  })
  await withServer(app, async (base) => {
    const { body: session } = await call(base, '/sessions', 'POST', {})
    const stream = waitFor(app.events, (event) => event.type === 'listening.stopped')
    const started = await call(base, `/sessions/${session.id}/listening/start`, 'POST', { microphoneDevice: '3' })
    assert.equal(started.body.listening, true)
    assert.equal((await call(base, `/sessions/${session.id}/listening/start`, 'POST', {})).status, 400)
    const stopped = await call(base, `/sessions/${session.id}/listening/stop`, 'POST', {})
    assert.equal(stopped.body.listening, false)
    await stream
    assert.deepEqual(calls, ['start 3', 'stop'])
  })
})

test('the web page and its assets are served', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    for (const [path, type, marker] of [['/', 'text/html', 'Listen Instant Ans'], ['/app.js', 'text/javascript', 'EventSource'], ['/styles.css', 'text/css', '.timeline']] as const) {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.status, 200, path)
      assert.match(response.headers.get('content-type') ?? '', new RegExp(type))
      assert.match(await response.text(), new RegExp(marker.replace('.', '\\.')))
    }
  })
})

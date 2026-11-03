import assert from 'node:assert/strict'
import { request as httpRequest, type Server } from 'node:http'
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
    assert.match(started.body.error, /阿里云/)
    assert.equal(started.body.code, 'settings')
    assert.equal((await call(base, '/sessions/nope/listening/start', 'POST', {})).status, 404)
  })
})

test('listening can be started and stopped through the runtime manager', async () => {
  const calls: string[] = []
  const app = createTestApp(new ScriptedRunner(() => say('-')), {
    voiceSessionFactory: (_sessionId, name) => ({
      start: async () => { calls.push(`start ${name}`) },
      stop: async () => { calls.push('stop') },
      pushAudio: () => undefined,
    }),
  })
  await withServer(app, async (base) => {
    const { body: session } = await call(base, '/sessions', 'POST', {})
    const stream = waitFor(app.events, (event) => event.type === 'listening.stopped')
    const started = await call(base, `/sessions/${session.id}/listening/start`, 'POST', { microphoneDevice: 'USB 麦克风' })
    assert.equal(started.body.listening, true)
    assert.equal((await call(base, `/sessions/${session.id}/listening/start`, 'POST', {})).status, 400)
    const stopped = await call(base, `/sessions/${session.id}/listening/stop`, 'POST', {})
    assert.equal(stopped.body.listening, false)
    await stream
    assert.deepEqual(calls, ['start USB 麦克风', 'stop'])
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

test('settings: the page can read what is set and change it, and secrets are never sent back', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    const before = await call(base, '/settings')
    assert.deepEqual(before.body.ready, { answering: false, transcription: false })
    const saved = await call(base, '/settings', 'PUT', { mimo: { apiKey: 'sk-secret-from-the-panel' }, aliyun: { appKey: 'app-key-1', token: 'token-secret-5678' } })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.body.ready, { answering: true, transcription: true })
    assert.equal(saved.body.aliyun.token.hint, '····5678')
    const again = JSON.stringify((await call(base, '/settings')).body)
    assert.equal(again.includes('sk-secret-from-the-panel'), false)
    assert.equal(again.includes('token-secret-5678'), false)
    assert.equal(app.settings.current().mimo.apiKey, 'sk-secret-from-the-panel')
  })
})

test('settings: invalid values are rejected with a settings error', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    const bad = await call(base, '/settings', 'PUT', { mimo: { baseUrl: 'not a url' } })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.code, 'settings')
    assert.equal((await call(base, '/settings', 'PUT', { mimo: { apiKey: 'has space' } })).status, 400)
    assert.equal(app.settings.status().mimo.apiKey.set, false)
  })
})

test('saving the Aliyun settings is enough for listening to try to start, with no restart', async () => {
  // A WebSocket that always fails to connect: no network, and the microphone is never started.
  class RefusedSocket extends EventTarget {
    static OPEN = 1
    readyState = 0
    constructor() {
      super()
      setTimeout(() => { this.dispatchEvent(new Event('error')); this.dispatchEvent(new Event('close')) }, 0)
    }
    send(): void {}
    close(): void {}
  }
  const original = globalThis.WebSocket
  globalThis.WebSocket = RefusedSocket as unknown as typeof WebSocket
  try {
    const app = createTestApp(new ScriptedRunner(() => say('-')))
    await withServer(app, async (base) => {
      const { body: session } = await call(base, '/sessions', 'POST', {})
      const before = await call(base, `/sessions/${session.id}/listening/start`, 'POST', {})
      assert.equal(before.body.code, 'settings')
      await call(base, '/settings', 'PUT', { aliyun: { appKey: 'a', token: 'token-1234567' } })
      const after = await call(base, `/sessions/${session.id}/listening/start`, 'POST', {})
      assert.equal(after.status, 400)
      assert.equal(after.body.code, undefined)
      assert.match(after.body.error, /Unable to open Aliyun WebSocket/)
      assert.equal(app.runtime.isListening(session.id), false)
    })
  } finally {
    globalThis.WebSocket = original
  }
})

function rawRequest(base: string, path: string, method: string, headers: Record<string, string>, body?: string): Promise<number> {
  const url = new URL(base)
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: url.hostname, port: url.port, path, method, headers }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.on('error', reject)
    request.end(body)
  })
}

test('security: requests for another host name are refused (DNS rebinding)', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    assert.equal(await rawRequest(base, '/settings', 'GET', { host: 'evil.example.com' }), 403)
    assert.equal(await rawRequest(base, '/sessions', 'GET', { host: 'evil.example.com:3100' }), 403)
    assert.equal(await rawRequest(base, '/health', 'GET', { host: 'localhost:3100' }), 200)
    assert.equal(await rawRequest(base, '/health', 'GET', { host: '[::1]:3100' }), 200)
  })
})

test('security: a web page on another site cannot change settings or start sessions', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    const headers = { 'content-type': 'application/json', origin: 'https://evil.example.com' }
    assert.equal(await rawRequest(base, '/settings', 'PUT', headers, JSON.stringify({ mimo: { apiKey: 'sk-stolen-key' } })), 403)
    assert.equal(await rawRequest(base, '/sessions', 'POST', headers, '{}'), 403)
    assert.equal(app.settings.status().mimo.apiKey.set, false)
    const host = new URL(base).host
    assert.equal(await rawRequest(base, '/sessions', 'POST', { ...headers, origin: `http://${host}` }, '{}'), 201)
  })
})

test('security: an oversized body is rejected', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  await withServer(app, async (base) => {
    const huge = JSON.stringify({ mimo: { apiKey: 'x'.repeat(100_000) } })
    assert.equal((await call(base, '/settings', 'PUT', JSON.parse(huge))).status, 400)
  })
})

test('audio: chunks posted by the page reach the listening session, in order', async () => {
  const received: number[][] = []
  const app = createTestApp(new ScriptedRunner(() => say('-')), {
    voiceSessionFactory: () => ({ start: async () => undefined, stop: async () => undefined, pushAudio: (chunk) => { received.push([...chunk]) } }),
  })
  await withServer(app, async (base) => {
    const { body: session } = await call(base, '/sessions', 'POST', {})
    const post = (bytes: number[]) => fetch(`${base}/sessions/${session.id}/audio`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) })
    const early = await post([1])
    assert.equal(early.status, 400)
    assert.match((await early.json()).error, /not listening/)
    await call(base, `/sessions/${session.id}/listening/start`, 'POST', {})
    assert.equal((await post([1, 2, 3])).status, 204)
    assert.equal((await post([4, 5])).status, 204)
    assert.deepEqual(received, [[1, 2, 3], [4, 5]])
    const huge = await fetch(`${base}/sessions/${session.id}/audio`, { method: 'POST', body: new Uint8Array(70_000) })
    assert.equal(huge.status, 400)
    assert.equal((await fetch(`${base}/sessions/nope/audio`, { method: 'POST', body: new Uint8Array(1) })).status, 400)
  })
})

test('audio: a page on another site cannot feed audio', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')), {
    voiceSessionFactory: () => ({ start: async () => undefined, stop: async () => undefined, pushAudio: () => assert.fail('must not be called') }),
  })
  await withServer(app, async (base) => {
    const { body: session } = await call(base, '/sessions', 'POST', {})
    await call(base, `/sessions/${session.id}/listening/start`, 'POST', {})
    assert.equal(await rawRequest(base, `/sessions/${session.id}/audio`, 'POST', { origin: 'https://evil.example.com' }, 'x'), 403)
  })
})

test('stopAll ends every recording', async () => {
  const stopped: string[] = []
  const app = createTestApp(new ScriptedRunner(() => say('-')), {
    voiceSessionFactory: (sessionId) => ({ start: async () => undefined, stop: async () => { stopped.push(sessionId) }, pushAudio: () => undefined }),
  })
  await withServer(app, async (base) => {
    const first = (await call(base, '/sessions', 'POST', {})).body.id
    const second = (await call(base, '/sessions', 'POST', {})).body.id
    await call(base, `/sessions/${first}/listening/start`, 'POST', {})
    await call(base, `/sessions/${second}/listening/start`, 'POST', {})
    await app.runtime.stopAll()
    assert.deepEqual(stopped.sort(), [first, second].sort())
    assert.equal(app.runtime.isListening(first) || app.runtime.isListening(second), false)
    await app.runtime.stopAll()
  })
})

test('a missing page file is a clean 404, leaks no path, and the server keeps working', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  const server: Server = createHttpServer(app, join(import.meta.dirname, 'no-such-folder'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const page = await fetch(`${base}/`)
    assert.equal(page.status, 404)
    const text = await page.text()
    assert.doesNotMatch(text, /no-such-folder|ENOENT/)
    assert.equal((await fetch(`${base}/app.js`)).status, 404)
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

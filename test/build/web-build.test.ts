import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import { buildWeb } from '../../scripts/build-web.mjs'
import { cleanEnvironment, startServer, type RunningServer } from './helpers.js'

const workspace = mkdtempSync(join(tmpdir(), 'lia-web-build-'))
const outDir = join(workspace, 'dist-web')
let server: RunningServer

async function call(path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${server.base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

before(async () => {
  await buildWeb({ outDir })
  // Run it far away from the repository, so nothing can be picked up from its node_modules.
  server = await startServer('node', [join(outDir, 'server.mjs')], { cwd: workspace, env: cleanEnvironment(workspace) })
})

after(async () => {
  await server?.stop()
  rmSync(workspace, { recursive: true, force: true })
})

test('the build is one server file and a page, with no dependency on node_modules', () => {
  assert.ok(statSync(join(outDir, 'server.mjs')).size > 1_000_000)
  const source = readFileSync(join(outDir, 'server.mjs'), 'utf8')
  // Bundled code mentions package names in strings; what must not exist is an import left for node_modules.
  assert.doesNotMatch(source, /^import[^\n]*from ["']@(mastra|listen-instant-ans)\//m)
  assert.doesNotMatch(source, /^import[^\n]*from ["']zod["']/m)
  for (const file of ['index.html', 'app.js', 'capture.js', 'pcm.js', 'pcm-worklet.js', 'styles.css']) {
    assert.ok(statSync(join(outDir, 'public', file)).size > 0, file)
  }
  assert.throws(() => statSync(join(outDir, 'public', 'test')))
})

test('it starts, and serves the page with every file the page needs', async () => {
  assert.deepEqual(await call('/health'), { status: 200, body: { ok: true } })
  const page = await fetch(`${server.base}/`)
  assert.match(page.headers.get('content-type') ?? '', /text\/html/)
  assert.match(await page.text(), /Listen Instant Ans/)
  for (const [path, type] of [['/app.js', 'javascript'], ['/capture.js', 'javascript'], ['/pcm.js', 'javascript'], ['/pcm-worklet.js', 'javascript'], ['/styles.css', 'css']] as const) {
    const response = await fetch(`${server.base}${path}`)
    assert.equal(response.status, 200, path)
    assert.match(response.headers.get('content-type') ?? '', new RegExp(type), path)
  }
})

test('first run: nothing is configured, and the keys can be saved from the page API', async () => {
  const before = await call('/settings')
  assert.deepEqual(before.body.ready, { answering: false, transcription: false })
  const saved = await call('/settings', 'PUT', { mimo: { apiKey: 'sk-build-test-0000' }, aliyun: { appKey: 'app', token: 'token-build-1234' } })
  assert.deepEqual(saved.body.ready, { answering: true, transcription: true })
  assert.equal(JSON.stringify(saved.body).includes('sk-build-test-0000'), false)
  assert.equal(statSync(`${workspace}/settings.json`).mode & 0o777, 0o600)
})

test('sessions, transcripts, the audio endpoint and the local-only checks work in the build', async () => {
  const { body: session } = await call('/sessions', 'POST', {})
  const posted = await call(`/sessions/${session.id}/transcripts`, 'POST', { startedAtMs: 0, endedAtMs: 1, text: '一句话' })
  assert.deepEqual([posted.status, posted.body.sequence], [202, 1])
  assert.deepEqual((await call(`/sessions/${session.id}/timeline`)).body.transcripts.map((item: { text: string }) => item.text), ['一句话'])
  const audio = await fetch(`${server.base}/sessions/${session.id}/audio`, { method: 'POST', body: new Uint8Array([1, 2]) })
  assert.equal(audio.status, 400)
  const foreign = await fetch(`${server.base}/settings`, { method: 'PUT', headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' }, body: '{}' })
  assert.equal(foreign.status, 403)
})

test('the real model answers through the bundled server', { skip: process.env.MIMO_API_KEY ? false : 'MIMO_API_KEY is not set' }, async () => {
  const live = await startServer('node', [join(outDir, 'server.mjs')], {
    cwd: workspace,
    env: cleanEnvironment(workspace, { MIMO_API_KEY: process.env.MIMO_API_KEY, LISTEN_INSTANT_ANS_SETTINGS: `${workspace}/live-settings.json` }),
  })
  try {
    const session = await (await fetch(`${live.base}/sessions`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).json() as { id: string }
    await fetch(`${live.base}/sessions/${session.id}/transcripts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startedAtMs: 0, endedAtMs: 1, text: '请问牛顿第二定律的表达式是什么？' }) })
    const deadline = Date.now() + 40_000
    let shown: Array<{ question: string; answer: string; status: string }> = []
    while (Date.now() < deadline && shown.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const timeline = await (await fetch(`${live.base}/sessions/${session.id}/timeline`)).json() as { qas: typeof shown }
      shown = timeline.qas.filter((item) => item.status === 'shown')
    }
    assert.ok(shown.length >= 1, `no answer arrived.\n${live.output()}`)
    assert.match(shown[0].answer, /ma|质量|加速度/)
  } finally {
    await live.stop()
  }
})

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { createHttpServer } from '../../api/src/http/create-http-server.js'
import { ScriptedRunner, createTestApp, qaText, say } from '../../api/test/helpers.js'
import { runSmokeTest } from '../src/smoke.js'

const webRoot = join(import.meta.dirname, '../../web')

async function serve(server: Server): Promise<{ base: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) },
  }
}

test('a healthy server passes every check', async () => {
  const running = await serve(createHttpServer(createTestApp(new ScriptedRunner(() => say('-'))), webRoot))
  try {
    const result = await runSmokeTest(running.base)
    assert.deepEqual(result.checks.filter((item) => !item.ok), [])
    assert.equal(result.ok, true)
    assert.ok(result.checks.length >= 7)
  } finally {
    await running.close()
  }
})

test('the model check waits for a real answer', async () => {
  const app = createTestApp(new ScriptedRunner(() => say(qaText(['牛顿第二定律的表达式是什么？', 'F=ma。']))), { autoStartLanes: true, tuning: { lanePeriodMs: 50, laneStaggerMs: 25 } })
  const running = await serve(createHttpServer(app, webRoot))
  try {
    const result = await runSmokeTest(running.base, { withModel: true, modelTimeoutMs: 5000 })
    assert.equal(result.ok, true)
    assert.match(result.checks.at(-1)?.detail ?? '', /F=ma/)
  } finally {
    await running.close()
  }
})

test('the model check fails when no answer ever comes', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')), { autoStartLanes: true, tuning: { lanePeriodMs: 50, laneStaggerMs: 25 } })
  const running = await serve(createHttpServer(app, webRoot))
  try {
    const result = await runSmokeTest(running.base, { withModel: true, modelTimeoutMs: 600 })
    assert.equal(result.ok, false)
    assert.equal(result.checks.at(-1)?.ok, false)
    assert.match(result.checks.at(-1)?.detail ?? '', /no answer/)
  } finally {
    await running.close()
  }
})

test('a broken server fails the checks instead of passing silently', async () => {
  const running = await serve(createServer((_, response) => {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end('{"error":"broken"}')
  }))
  try {
    const result = await runSmokeTest(running.base)
    assert.equal(result.ok, false)
    assert.ok(result.checks.filter((item) => !item.ok).length >= 4)
  } finally {
    await running.close()
  }
})

test('a server that is not there fails with a readable reason', async () => {
  const result = await runSmokeTest('http://127.0.0.1:9')
  assert.equal(result.ok, false)
  assert.ok(result.checks.every((item) => !item.ok && (item.detail ?? '').length > 0))
})

test('a page that does not serve its scripts is caught', async () => {
  const app = createTestApp(new ScriptedRunner(() => say('-')))
  const running = await serve(createHttpServer(app, join(import.meta.dirname, '../src'))) // no index.html there
  try {
    const result = await runSmokeTest(running.base)
    const page = result.checks.find((item) => item.name.startsWith('the page'))
    assert.equal(page?.ok, false)
  } finally {
    await running.close()
  }
})

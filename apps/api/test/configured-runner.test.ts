import assert from 'node:assert/strict'
import test from 'node:test'
import { ReloadableQaRunner } from '../src/agent/configured-runner.js'
import type { QaRunner } from '../src/agent/qa-runner.js'
import type { AppConfig } from '../src/config/env.js'
import { SettingsError } from '../src/config/settings-store.js'
import { ScriptedRunner, say } from './helpers.js'

const input = { sessionId: 's', slot: 'A', runId: 'r', messages: [] } as const

async function collect(runner: QaRunner): Promise<string> {
  let text = ''
  for await (const delta of runner.run(input, new AbortController().signal)) text += delta
  return text
}

test('without an API key the request fails with a message that points to the settings', async () => {
  const runner = new ReloadableQaRunner(() => ({ model: 'm' }), () => assert.fail('must not be created'))
  await assert.rejects(collect(runner), (error: Error) => error instanceof SettingsError && /设置/.test(error.message))
})

test('the real runner is created once and reused while the settings stay the same', async () => {
  let created = 0
  const mimo: AppConfig['mimo'] = { apiKey: 'k1', model: 'm', baseUrl: 'https://a.example' }
  const runner = new ReloadableQaRunner(() => mimo, () => { created++; return new ScriptedRunner(() => say('Q: a\nA: b\n')) })
  assert.equal(await collect(runner), 'Q: a\nA: b\n')
  await collect(runner)
  assert.equal(created, 1)
})

test('changing the key, model or address builds a new runner without a restart', async () => {
  let mimo: AppConfig['mimo'] = { apiKey: 'k1', model: 'm', baseUrl: 'https://a.example' }
  const seen: string[] = []
  const runner = new ReloadableQaRunner(() => mimo, (config) => {
    seen.push(`${config.apiKey}|${config.model}|${config.baseUrl}`)
    return new ScriptedRunner(() => say('-'))
  })
  await collect(runner)
  mimo = { ...mimo, apiKey: 'k2' }
  await collect(runner)
  mimo = { ...mimo, model: 'm2' }
  await collect(runner)
  mimo = { ...mimo, baseUrl: 'https://b.example' }
  await collect(runner)
  await collect(runner)
  assert.deepEqual(seen, ['k1|m|https://a.example', 'k2|m|https://a.example', 'k2|m2|https://a.example', 'k2|m2|https://b.example'])
})

test('removing the key again stops requests immediately', async () => {
  let mimo: AppConfig['mimo'] = { apiKey: 'k1', model: 'm' }
  const runner = new ReloadableQaRunner(() => mimo, () => new ScriptedRunner(() => say('-')))
  await collect(runner)
  mimo = { model: 'm' }
  await assert.rejects(collect(runner), SettingsError)
})

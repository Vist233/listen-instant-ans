import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SettingsError, SettingsStore } from '../src/config/settings-store.js'

const env = { MIMO_API_KEY: 'sk-env-secret-1234', ALIYUN_APP_ID: 'app-from-env', ALIYUN_TMP_TOKEN: 'token-from-env-9999' }

function inTempDirectory(work: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'lia-settings-'))
  try { work(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('an empty store reports nothing set and nothing ready', () => {
  const status = new SettingsStore(null, {}).status()
  assert.deepEqual([status.mimo.apiKey.set, status.aliyun.appKey.set, status.aliyun.token.set], [false, false, false])
  assert.deepEqual(status.ready, { answering: false, transcription: false })
  assert.equal(status.mimo.model, 'mimo-v2.6-flash')
  assert.equal(status.path, null)
})

test('environment variables are used as a fallback and labelled as such', () => {
  const store = new SettingsStore(null, env)
  assert.equal(store.current().mimo.apiKey, 'sk-env-secret-1234')
  assert.equal(store.current().aliyun.token, 'token-from-env-9999')
  const status = store.status()
  assert.deepEqual([status.mimo.apiKey.source, status.mimo.apiKey.hint, status.ready], ['env', '····1234', { answering: true, transcription: true }])
})

test('a stored value wins over the environment, and clearing it falls back again', () => {
  const store = new SettingsStore(null, env)
  store.update({ mimo: { apiKey: 'sk-typed-in-the-panel' } })
  assert.equal(store.current().mimo.apiKey, 'sk-typed-in-the-panel')
  assert.equal(store.status().mimo.apiKey.source, 'file')
  store.update({ mimo: { apiKey: '' } })
  assert.equal(store.current().mimo.apiKey, 'sk-env-secret-1234')
  assert.equal(store.status().mimo.apiKey.source, 'env')
})

test('fields that are left out of an update keep their value', () => {
  const store = new SettingsStore(null, {})
  store.update({ mimo: { apiKey: 'sk-one-two-three', model: 'mimo-x' }, aliyun: { appKey: 'app', token: 'tok-1234567' } })
  store.update({ mimo: { model: 'mimo-y' } })
  const config = store.current()
  assert.deepEqual([config.mimo.apiKey, config.mimo.model, config.aliyun.appKey, config.aliyun.token], ['sk-one-two-three', 'mimo-y', 'app', 'tok-1234567'])
})

test('the status never contains a secret, only the last four characters', () => {
  const store = new SettingsStore(null, {})
  const secrets = { mimo: { apiKey: 'sk-very-secret-value' }, aliyun: { appKey: 'appkey-secret-abcd', token: 'token-secret-wxyz' } }
  const status = store.update(secrets)
  const text = JSON.stringify(status)
  for (const secret of ['sk-very-secret-value', 'appkey-secret-abcd', 'token-secret-wxyz']) {
    assert.equal(text.includes(secret), false, secret)
  }
  assert.deepEqual([status.mimo.apiKey.hint, status.aliyun.token.hint], ['····alue', '····wxyz'])
})

test('short values are fully masked', () => {
  assert.equal(new SettingsStore(null, {}).update({ aliyun: { appKey: 'abc' } }).aliyun.appKey.hint, '····')
})

test('bad input is rejected and changes nothing', () => {
  const store = new SettingsStore(null, {})
  store.update({ mimo: { apiKey: 'sk-original-key' } })
  for (const patch of [
    { mimo: { apiKey: 'has space' } },
    { mimo: { apiKey: 'new\nline' } },
    { mimo: { apiKey: 42 } },
    { mimo: { baseUrl: 'not a url' } },
    { mimo: { baseUrl: 'ftp://example.com' } },
    { mimo: { apiKey: 'x'.repeat(600) } },
    'text',
    null,
  ]) {
    assert.throws(() => store.update(patch), SettingsError, JSON.stringify(patch)?.slice(0, 40))
  }
  assert.equal(store.current().mimo.apiKey, 'sk-original-key')
})

test('listeners hear about every successful update, and can unsubscribe', () => {
  const store = new SettingsStore(null, {})
  let calls = 0
  const stop = store.onChange(() => { calls++ })
  store.update({ mimo: { model: 'a' } })
  assert.throws(() => store.update({ mimo: { baseUrl: 'nope' } }))
  assert.equal(calls, 1)
  stop()
  store.update({ mimo: { model: 'b' } })
  assert.equal(calls, 1)
})

test('settings are saved to disk with owner-only permissions and survive a restart', () => inTempDirectory((directory) => {
  const path = join(directory, 'nested', 'settings.json')
  new SettingsStore(path, {}).update({ mimo: { apiKey: 'sk-persisted-key' }, aliyun: { appKey: 'app-1', token: 'token-1234' } })
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(statSync(join(directory, 'nested')).mode & 0o777, 0o700)
  assert.equal(existsSync(`${path}.tmp`), false)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { mimo: { apiKey: 'sk-persisted-key' }, aliyun: { appKey: 'app-1', token: 'token-1234' } })
  const reopened = new SettingsStore(path, {})
  assert.deepEqual([reopened.current().mimo.apiKey, reopened.current().aliyun.token, reopened.status().path], ['sk-persisted-key', 'token-1234', path])
}))

test('a damaged settings file is set aside instead of crashing', () => inTempDirectory((directory) => {
  const path = join(directory, 'settings.json')
  writeFileSync(path, '{ this is not json')
  const store = new SettingsStore(path, {})
  assert.equal(store.status().ready.answering, false)
  assert.equal(existsSync(`${path}.corrupt`), true)
  store.update({ mimo: { apiKey: 'sk-after-corruption' } })
  assert.equal(new SettingsStore(path, {}).current().mimo.apiKey, 'sk-after-corruption')
}))

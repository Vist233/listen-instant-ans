import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

test('the version the release files are named after is a real version number', () => {
  // The browser zip is named from package.json; once it was published as "...-web-undefined.zip".
  const { version } = JSON.parse(read('package.json')) as { version?: string }
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/)
})

test('the release workflow only reacts to version tags, and only publishes from them', () => {
  const workflow = read('.github/workflows/release.yml')
  assert.match(workflow, /tags: \['v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\]/)
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  assert.match(workflow, /arch: \[arm64, x64\]/)
})

test('the CI workflow runs the checks, the tests and the build tests', () => {
  const workflow = read('.github/workflows/ci.yml')
  for (const command of ['npm ci', 'npm run check', 'npm test', 'npm run test:build']) assert.ok(workflow.includes(command), command)
  assert.match(workflow, /macos-latest/)
  assert.match(workflow, /ubuntu-latest/)
})

test('the lockfile only points at the public npm registry', () => {
  const lock = read('package-lock.json')
  const hosts = new Set([...lock.matchAll(/"resolved": "https?:\/\/([^/]+)/g)].map((match) => match[1]))
  assert.deepEqual([...hosts], ['registry.npmjs.org'])
})

test('nothing that looks like a private key or token is committed in the settings examples', () => {
  const example = read('.env.example')
  for (const line of example.split('\n')) {
    const match = /^(MIMO_API_KEY|ALIYUN_APP_ID|ALIYUN_TMP_TOKEN)=(.*)$/.exec(line)
    if (match) assert.equal(match[2], '', `${match[1]} must be empty in the example`)
  }
})

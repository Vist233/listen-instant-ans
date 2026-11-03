import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readlinkSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import { buildDesktop, PRODUCT_NAME } from '../../scripts/build-desktop.mjs'

const mac = process.platform === 'darwin'
const workspace = mkdtempSync(join(tmpdir(), 'lia-desktop-build-'))
const outDir = join(workspace, 'out')
const installDir = join(workspace, 'Applications') // where "dragging the app" puts it
const mountPoint = join(workspace, 'mount')
let dmg = ''
let installedApp = ''

const run = (command: string, args: string[]): string => execFileSync(command, args, { encoding: 'utf8' })

before(async () => {
  if (!mac) return
  const { version } = await buildDesktop({ outDir, arch: 'arm64' })
  dmg = join(outDir, `${PRODUCT_NAME}-${version}-arm64.dmg`)
  // Install the way a user does: open the disk image and copy the app out of it.
  run('mkdir', ['-p', mountPoint, installDir])
  run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmg])
  try {
    cpSync(join(mountPoint, `${PRODUCT_NAME}.app`), join(installDir, `${PRODUCT_NAME}.app`), { recursive: true, verbatimSymlinks: true })
  } finally {
    run('hdiutil', ['detach', mountPoint, '-quiet'])
  }
  installedApp = join(installDir, `${PRODUCT_NAME}.app`)
}, { timeout: 600_000 })

after(() => {
  try { run('hdiutil', ['detach', mountPoint, '-force', '-quiet']) } catch { /* already detached */ }
  rmSync(workspace, { recursive: true, force: true })
})

function runApp(extraEnv: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; output: string }> {
  const home = mkdtempSync(join(workspace, 'home-'))
  return new Promise((resolve, reject) => {
    // The environment of someone who just installed it: no keys, an empty home.
    const child = spawn(join(installedApp, 'Contents/MacOS', PRODUCT_NAME), ['--smoke-test'], {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, LISTEN_INSTANT_ANS_SETTINGS: join(home, 'settings.json'), LISTEN_INSTANT_ANS_DATABASE: ':memory:', PORT: '0', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`The app did not finish.\n${output}`)) }, 90_000)
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code, output }) })
  })
}

test('the disk image holds the app and a shortcut to Applications', { skip: !mac }, () => {
  assert.ok(statSync(dmg).size > 30_000_000, 'the dmg is suspiciously small')
  run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmg])
  try {
    const entries = readdirSync(mountPoint)
    assert.ok(entries.includes(`${PRODUCT_NAME}.app`), entries.join())
    assert.ok(entries.includes('Applications'), entries.join())
    assert.ok(lstatSync(join(mountPoint, 'Applications')).isSymbolicLink())
    assert.equal(readlinkSync(join(mountPoint, 'Applications')), '/Applications')
  } finally {
    run('hdiutil', ['detach', mountPoint, '-quiet'])
  }
})

test('Info.plist asks for the microphone, names the app and has an icon', { skip: !mac }, () => {
  const plist = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(installedApp, 'Contents/Info.plist')]))
  assert.equal(plist.CFBundleName, PRODUCT_NAME)
  assert.equal(plist.CFBundleIdentifier, 'io.github.vist233.listen-instant-ans')
  assert.match(plist.NSMicrophoneUsageDescription, /麦克风/)
  assert.equal(plist.CFBundleIconFile, 'icon.icns')
  assert.ok(existsSync(join(installedApp, 'Contents/Resources/icon.icns')))
  assert.match(plist.CFBundleShortVersionString, /^\d+\.\d+\.\d+$/)
})

test('the copied app has a valid signature', { skip: !mac }, () => {
  run('codesign', ['--verify', '--deep', '--strict', installedApp]) // throws when the signature is broken
})

test('the app archive has the program and the page, and no tests or secrets', { skip: !mac }, () => {
  const archive = join(installedApp, 'Contents/Resources/app.asar')
  const listing = run(join(import.meta.dirname, '../../node_modules/.bin/asar'), ['list', archive])
  for (const file of ['/main.cjs', '/package.json', '/public/index.html', '/public/app.js', '/public/capture.js', '/public/pcm.js', '/public/pcm-worklet.js', '/public/styles.css']) {
    assert.ok(listing.split('\n').includes(file), `${file} is missing`)
  }
  assert.doesNotMatch(listing, /\/public\/test|\.env|settings\.json|\.sqlite|node_modules/)
})

test('the installed app starts and passes its self-check with nothing configured', { skip: !mac, timeout: 120_000 }, async () => {
  const { code, output } = await runApp()
  assert.equal(code, 0, output)
  assert.match(output, /SMOKE_OK/)
  assert.doesNotMatch(output, /FAIL/)
  for (const name of ['health', 'page and its scripts', 'database works', 'transcript is stored', 'no secret is exposed', 'audio is refused', 'other web sites']) {
    assert.match(output, new RegExp(`PASS .*${name}`), name)
  }
})

test('the installed app answers a question with the real model', { skip: !mac || !process.env.MIMO_API_KEY ? 'needs macOS and MIMO_API_KEY' : false, timeout: 150_000 }, async () => {
  const { code, output } = await runApp({ MIMO_API_KEY: process.env.MIMO_API_KEY, LISTEN_INSTANT_ANS_SMOKE_MODEL: '1' })
  assert.equal(code, 0, output)
  assert.match(output, /PASS the model answers a question -- .*F ?= ?ma|PASS the model answers a question -- .*质量|PASS the model answers a question -- .*加速度/)
})

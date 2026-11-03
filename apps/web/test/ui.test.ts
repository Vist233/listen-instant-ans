import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { mock } from 'node:test'
import type { Application } from '../../api/src/bootstrap.js'
import type { VoiceSessionFactory } from '../../api/src/runtime/session-runtime-manager.js'
import { ScriptedRunner, createTestApp, qaText, say } from '../../api/test/helpers.js'
import { createFakeCapture, openUi, until, type Ui } from './harness.js'

const KEYS = { MIMO_API_KEY: 'sk-test-key-0000', ALIYUN_APP_ID: 'app-key', ALIYUN_TMP_TOKEN: 'token-1234567890' }

function fakeVoice(options: { rejectAudio?: string } = {}) {
  const chunks: number[][] = []
  const names: string[] = []
  const factory: VoiceSessionFactory = (_sessionId, name) => ({
    start: async () => { names.push(name) },
    stop: async () => undefined,
    pushAudio: (chunk) => {
      if (options.rejectAudio !== undefined) throw new Error(options.rejectAudio)
      chunks.push([...chunk])
    },
  })
  return { chunks, names, factory }
}

interface Setup {
  env?: NodeJS.ProcessEnv
  runner?: ScriptedRunner
  voice?: ReturnType<typeof fakeVoice>
  storage?: { local?: Record<string, string>; session?: Record<string, string> }
  prepare?: (app: Application) => void | Promise<void>
}

async function withUi(setup: Setup, work: (ui: Ui, capture: ReturnType<typeof createFakeCapture>, app: Application) => Promise<void>): Promise<void> {
  let clock = 1_000
  const app = createTestApp(setup.runner ?? new ScriptedRunner(() => say('-')), {
    env: setup.env ?? KEYS,
    voiceSessionFactory: setup.voice?.factory,
    now: () => (clock += 1000),
  })
  await setup.prepare?.(app)
  const capture = createFakeCapture()
  const ui = await openUi(app, capture, setup.storage)
  try {
    await ui.ready()
    await work(ui, capture, app)
  } finally {
    await ui.close()
  }
}

const newSession = (app: Application): string => {
  const id = randomUUID()
  app.controller.start(id, 'zh-CN')
  return id
}
const speak = (app: Application, id: string, text: string): void => {
  app.controller.appendFinalTranscript(id, { startedAtMs: 0, endedAtMs: 1, text, confidence: 1 })
}
const dialogOpen = (ui: Ui): boolean => ui.document.querySelector('#settings')!.hasAttribute('open')
const submitSettings = (ui: Ui): void => {
  ui.document.querySelector('#settings-form')!.dispatchEvent(new ui.window.Event('submit', { cancelable: true }))
}

/* ---------- settings ---------- */

test('without keys the settings open by themselves, and saving them works', () => withUi({ env: {} }, async (ui, _capture, app) => {
  await until(() => dialogOpen(ui), 'the settings dialog')
  assert.match(ui.text('#settings-error'), /先填好密钥/)
  ui.setValue('#mimo-key', 'sk-new-key-value')
  ui.setValue('#aliyun-appkey', 'app-1')
  ui.setValue('#aliyun-token', 'token-abcdef123')
  submitSettings(ui)
  await until(() => !dialogOpen(ui), 'the dialog to close')
  assert.match(ui.text('#status'), /设置已保存，可以开始录音了/)
  const config = app.settings.current()
  assert.deepEqual([config.mimo.apiKey, config.aliyun.appKey, config.aliyun.token], ['sk-new-key-value', 'app-1', 'token-abcdef123'])
}))

test('reopening the settings shows only a hint, and blank fields keep what is saved', () => withUi({ env: {} }, async (ui, _capture, app) => {
  await until(() => dialogOpen(ui), 'the settings dialog')
  ui.setValue('#mimo-key', 'sk-new-key-value')
  ui.setValue('#aliyun-appkey', 'app-1')
  ui.setValue('#aliyun-token', 'token-abcdef123')
  submitSettings(ui)
  await until(() => !dialogOpen(ui))
  ui.click('#open-settings')
  await until(() => dialogOpen(ui))
  await until(() => /····alue/.test((ui.document.querySelector('#mimo-key') as HTMLInputElement).placeholder), 'the hint')
  assert.equal((ui.document.querySelector('#mimo-key') as HTMLInputElement).value, '')
  ui.setValue('#mimo-model', 'mimo-other')
  submitSettings(ui)
  await until(() => !dialogOpen(ui))
  assert.deepEqual([app.settings.current().mimo.apiKey, app.settings.current().mimo.model], ['sk-new-key-value', 'mimo-other'])
}))

test('a rejected value is explained inside the dialog and the dialog stays open', () => withUi({ env: {} }, async (ui, _capture, app) => {
  await until(() => dialogOpen(ui))
  ui.setValue('#mimo-key', 'has a space')
  submitSettings(ui)
  await until(() => /不能包含空格/.test(ui.text('#settings-error')), 'the error')
  assert.equal(dialogOpen(ui), true)
  assert.equal(app.settings.status().mimo.apiKey.set, false)
}))

test('with all keys set the dialog does not open', () => withUi({}, async (ui) => {
  assert.equal(dialogOpen(ui), false)
}))

/* ---------- microphones ---------- */

test('the microphones are listed by name and the built-in one is preferred', () => withUi({}, async (ui) => {
  assert.deepEqual(ui.texts('#device option'), ['External USB Microphone', 'MacBook Air Microphone'])
  assert.equal((ui.document.querySelector('#device') as HTMLSelectElement).value, 'mac')
}))

test('the last chosen microphone is remembered', () => withUi({ storage: { local: { 'listenInstantAns.microphone': 'usb' } } }, async (ui) => {
  assert.equal((ui.document.querySelector('#device') as HTMLSelectElement).value, 'usb')
}))

test('when the microphone cannot be used the reason is shown and recording is disabled', () => {
  const capture = createFakeCapture()
  capture.state.devices = []
  capture.state.error = '没有麦克风权限。请到系统设置里允许。'
  let clock = 1_000
  const app = createTestApp(new ScriptedRunner(() => say('-')), { env: KEYS, now: () => (clock += 1000) })
  return (async () => {
    const ui = await openUi(app, capture)
    try {
      await ui.ready()
      assert.equal((ui.document.querySelector('#device') as HTMLSelectElement).disabled, true)
      assert.equal((ui.document.querySelector('#start') as HTMLButtonElement).disabled, true)
      assert.match(ui.text('#status'), /没有麦克风权限/)
      assert.equal((ui.document.querySelector('#refresh-devices') as HTMLElement).hidden, false)
      capture.state.devices = [{ id: 'mac', name: 'MacBook Air Microphone' }]
      capture.state.error = undefined
      ui.click('#refresh-devices')
      await until(() => !(ui.document.querySelector('#start') as HTMLButtonElement).disabled, 'recording to be enabled')
      assert.deepEqual(ui.texts('#device option'), ['MacBook Air Microphone'])
      assert.equal((ui.document.querySelector('#refresh-devices') as HTMLElement).hidden, true)
      assert.doesNotMatch(ui.text('#status'), /没有麦克风权限/)
    } finally {
      await ui.close()
    }
  })()
})

test('an older microphone detection that answers late cannot overwrite a newer one', () => withUi({}, async (ui, capture) => {
  const refresh = ui.document.querySelector('#refresh-devices') as HTMLButtonElement
  let answerLate!: (value: { devices: Array<{ id: string; name: string }>; error?: string }) => void
  capture.nextDetection = () => new Promise((resolve) => { answerLate = resolve })
  refresh.click() // slow detection, still waiting
  await until(() => capture.nextDetection === undefined, 'the slow detection to start')
  refresh.click() // newer detection answers at once, with the normal device list
  await until(() => capture.state.listCalls >= 3, 'the newer detection')
  await new Promise((resolve) => setTimeout(resolve, 50))
  answerLate({ devices: [], error: '过时的错误' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(ui.texts('#device option'), ['External USB Microphone', 'MacBook Air Microphone'])
  assert.doesNotMatch(ui.text('#status'), /过时的错误/)
}))

/* ---------- recording ---------- */

test('start creates a session, captures from the chosen microphone and sends the audio in order; stop ends it', () => {
  const voice = fakeVoice()
  return withUi({ voice }, async (ui, capture, app) => {
    ui.select('#device', 'usb')
    ui.click('#start')
    await until(() => capture.state.started.length === 1, 'capture to start')
    assert.deepEqual(capture.state.started, ['usb'])
    assert.deepEqual(voice.names, ['External USB Microphone'])
    assert.equal(ui.window.localStorage.getItem('listenInstantAns.microphone'), 'usb')
    await until(() => ui.text('#stop') !== '' && !(ui.document.querySelector('#stop') as HTMLButtonElement).disabled, 'stop to be enabled')
    assert.equal((ui.document.querySelector('#start') as HTMLButtonElement).disabled, true)
    assert.equal((ui.document.querySelector('#meter') as HTMLElement).hidden, false)
    assert.match(ui.text('#status'), /正在录音/)
    assert.equal(app.sessions.list().length, 1)

    for (const bytes of [[1, 2, 3], [4, 5], [6]]) capture.state.chunk!(new Uint8Array(bytes).buffer)
    await until(() => voice.chunks.length === 3, 'the chunks to arrive')
    assert.deepEqual(voice.chunks, [[1, 2, 3], [4, 5], [6]])

    ui.click('#stop')
    await until(() => capture.state.stopped === 1, 'capture to stop')
    await until(() => !app.runtime.isListening(app.sessions.list()[0].id), 'the session to stop')
    await until(() => (ui.document.querySelector('#start') as HTMLButtonElement).disabled === false, 'start to be enabled again')
    assert.equal((ui.document.querySelector('#stop') as HTMLButtonElement).disabled, true)
    assert.equal((ui.document.querySelector('#meter') as HTMLElement).hidden, true)
    assert.match(ui.text('#status'), /已停止录音/)
  })
})

test('the volume bar follows the loudness', () => withUi({ voice: fakeVoice() }, async (ui, capture) => {
  ui.click('#start')
  await until(() => capture.state.level !== undefined, 'capture to start')
  capture.state.level!(0.04)
  const loud = Number((ui.document.querySelector('#meter') as HTMLElement).getAttribute('aria-valuenow'))
  capture.state.level!(0)
  const quiet = Number((ui.document.querySelector('#meter') as HTMLElement).getAttribute('aria-valuenow'))
  assert.ok(loud > 20 && quiet === 0, `loud ${loud}, quiet ${quiet}`)
}))

test('a silent microphone is called out after a few seconds, and the warning goes away with sound', () => withUi({ voice: fakeVoice() }, async (ui, capture) => {
  ui.click('#start')
  await until(() => capture.state.level !== undefined && /正在录音/.test(ui.text('#status')), 'recording')
  const start = Date.now()
  capture.state.level!(0)
  assert.doesNotMatch(ui.text('#status'), /听不到声音/)
  const clock = mock.method(Date, 'now', () => start + 5_000)
  try {
    capture.state.level!(0)
    assert.match(ui.text('#status'), /听不到声音/)
    capture.state.level!(0.2)
    assert.doesNotMatch(ui.text('#status'), /听不到声音/)
  } finally {
    clock.mock.restore()
  }
}))

test('if the microphone is refused, the session is stopped and the reason is shown', () => withUi({ voice: fakeVoice() }, async (ui, capture, app) => {
  capture.state.failStart = new Error('没有麦克风权限。请到系统设置里允许。')
  ui.click('#start')
  await until(() => /没有麦克风权限/.test(ui.text('#status')), 'the reason')
  const [session] = app.sessions.list()
  assert.equal(app.runtime.isListening(session.id), false)
  await until(() => (ui.document.querySelector('#start') as HTMLButtonElement).disabled === false, 'start to be enabled again')
  assert.equal(capture.state.stopped, 0)
}))

test('starting without Aliyun credentials opens the settings and never touches the microphone', () => withUi({ env: { MIMO_API_KEY: 'sk-only-the-model-key' } }, async (ui, capture) => {
  await until(() => dialogOpen(ui))
  ui.click('#settings-cancel')
  assert.equal(dialogOpen(ui), false)
  ui.click('#start')
  await until(() => dialogOpen(ui), 'the dialog to open again')
  assert.match(ui.text('#settings-error'), /阿里云/)
  assert.deepEqual(capture.state.started, [])
}))

test('if the server refuses the audio, capture ends and the server\'s reason is shown', () => withUi({ voice: fakeVoice({ rejectAudio: 'transcriber is gone' }) }, async (ui, capture) => {
  ui.click('#start')
  await until(() => capture.state.chunk !== undefined && /正在录音/.test(ui.text('#status')), 'recording')
  capture.state.chunk!(new Uint8Array([1]).buffer)
  await until(() => capture.state.stopped === 1, 'capture to stop')
  assert.match(ui.text('#status'), /transcriber is gone/)
}))

test('when the server gives up on listening, the page stops capturing and says why', () => withUi({ voice: fakeVoice() }, async (ui, capture, app) => {
  ui.click('#start')
  await until(() => capture.state.chunk !== undefined && /正在录音/.test(ui.text('#status')), 'recording')
  const [session] = app.sessions.list()
  app.events.publish({ type: 'listening.failed', sessionId: session.id, message: '阿里云连接断开了' })
  await app.runtime.stop(session.id)
  await until(() => capture.state.stopped === 1, 'capture to stop')
  assert.match(ui.text('#status'), /录音中断：阿里云连接断开了/)
  await until(() => (ui.document.querySelector('#start') as HTMLButtonElement).disabled === false)
}))

test('a page opened while another recording runs says so and can stop it', () => {
  const voice = fakeVoice()
  return withUi({
    voice,
    prepare: async (app) => { await app.runtime.start(newSession(app), '别处的麦克风') },
  }, async (ui, capture, app) => {
    assert.match(ui.text('#status'), /声音不是从这个页面来的/)
    assert.equal((ui.document.querySelector('#start') as HTMLButtonElement).disabled, true)
    ui.click('#stop')
    await until(() => !app.runtime.isListening(app.sessions.list()[0].id), 'the session to stop')
    assert.equal(capture.state.started.length, 0)
  })
})

/* ---------- lists ---------- */

test('transcripts and answers appear newest first', () => {
  let id = ''
  return withUi({
    runner: new ScriptedRunner(() => say(qaText(['问一？', '答一。'], ['问二？', '答二。']))),
    prepare: (app) => { id = newSession(app) },
  }, async (ui, _capture, app) => {
    for (const text of ['第一句', '第二句', '第三句']) speak(app, id, text)
    await until(() => ui.texts('#transcripts li').length === 3, 'the transcripts')
    assert.deepEqual(ui.texts('#transcripts li'), ['第三句', '第二句', '第一句'])
    await app.controller.tick(id, 'A')
    await until(() => ui.texts('#qas li').length === 2, 'the answers')
    const answers = ui.texts('#qas li')
    assert.match(answers[0], /问二？.*答二。/)
    assert.match(answers[1], /问一？.*答一。/)
  })
})

test('an answer that is still being written shows as a draft, and turns into the answer', () => {
  let id = ''
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  return withUi({
    runner: new ScriptedRunner(async function* () { yield 'Q: 草稿问？\nA: 写到'; await gate; yield '一半。\n' }),
    prepare: (app) => { id = newSession(app) },
  }, async (ui, _capture, app) => {
    speak(app, id, '老师提问')
    await until(() => ui.texts('#transcripts li').length === 1)
    const lane = app.controller.tick(id, 'A')
    await until(() => /Agent A 正在写[\s\S]*写到/.test(ui.text('#qa-partial')), 'the draft')
    assert.equal(ui.texts('#qas li').length, 0)
    release()
    await lane
    await until(() => ui.texts('#qas li').length === 1, 'the answer')
    assert.match(ui.texts('#qas li')[0], /草稿问？.*写到一半。/)
    assert.equal(ui.text('#qa-partial'), '')
  })
})

test('very long answers are cut for display', () => {
  let id = ''
  const longAnswer = '很'.repeat(300)
  return withUi({
    runner: new ScriptedRunner(() => say(qaText(['长答案？', longAnswer]))),
    prepare: (app) => { id = newSession(app) },
  }, async (ui, _capture, app) => {
    speak(app, id, '问')
    await app.controller.tick(id, 'A')
    await until(() => ui.texts('#qas li').length === 1)
    // The server already cuts at 150; the page never shows more than 200.
    assert.ok(ui.texts('#qas li')[0].length < 230)
  })
})

/* ---------- sessions ---------- */

test('the sidebar lists sessions with what is in them, and a history session is shown read-only', () => {
  let history = ''
  return withUi({
    prepare: (app) => {
      newSession(app) // older and empty
      history = newSession(app)
      speak(app, history, '历史里的一句')
      speak(app, history, '历史里的第二句')
    },
  }, async (ui) => {
    assert.deepEqual(ui.texts('.session small'), ['2 段转录', '空会话'])
    assert.deepEqual(ui.texts('#transcripts li'), ['历史里的第二句', '历史里的一句'])
    assert.match(ui.text('#status'), /这是历史会话/)
    ui.click('.session:nth-child(2)')
    await until(() => ui.texts('#transcripts li').length === 0, 'the empty session')
    assert.match(ui.text('#status'), /点“开始录音”开始/)
  })
})

test('starting from a history session begins a new one and leaves the old one alone', () => {
  let history = ''
  const voice = fakeVoice()
  return withUi({
    voice,
    prepare: (app) => { history = newSession(app); speak(app, history, '旧会话里的话') },
  }, async (ui, capture, app) => {
    ui.click('#start')
    await until(() => capture.state.started.length === 1)
    await until(() => ui.texts('.session').length === 2, 'the new session in the list')
    const live = app.sessions.list().find((item) => app.runtime.isListening(item.id))
    assert.ok(live !== undefined && live.id !== history)
    assert.equal(app.sessions.get(history).transcriptVersion, 1)
    assert.deepEqual(ui.texts('#transcripts li'), [])
  })
})

test('the new-session button adds an empty session, and recording then reuses it', () => {
  const voice = fakeVoice()
  return withUi({ voice }, async (ui, capture, app) => {
    assert.equal(app.sessions.list().length, 0)
    ui.click('#new-session')
    await until(() => app.sessions.list().length === 1, 'the session')
    await until(() => ui.texts('.session small').join() === '空会话', 'the sidebar')
    const [created] = app.sessions.list()
    ui.click('#start')
    await until(() => capture.state.started.length === 1)
    assert.equal(app.sessions.list().length, 1)
    assert.equal(app.runtime.isListening(created.id), true)
  })
})

test('only one session can record at a time', () => withUi({ voice: fakeVoice() }, async (ui, capture, app) => {
  ui.click('#start')
  await until(() => capture.state.started.length === 1)
  await until(() => (ui.document.querySelector('#stop') as HTMLButtonElement).disabled === false)
  ui.click('#new-session')
  await until(() => app.sessions.list().length === 2, 'the second session')
  assert.equal((ui.document.querySelector('#start') as HTMLButtonElement).disabled, true)
  assert.equal((ui.document.querySelector('#device') as HTMLSelectElement).disabled, true)
}))

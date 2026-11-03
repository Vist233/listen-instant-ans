const $ = (selector) => document.querySelector(selector)
const els = {
  status: $('#status'), partial: $('#partial'), qaPartial: $('#qa-partial'),
  transcripts: $('#transcripts'), qas: $('#qas'), sessions: $('#sessions'), title: $('#session-title'),
  newSession: $('#new-session'), start: $('#start'), stop: $('#stop'), device: $('#device'),
  openSettings: $('#open-settings'), dialog: $('#settings'), form: $('#settings-form'),
  mimoKey: $('#mimo-key'), mimoModel: $('#mimo-model'), aliyunAppKey: $('#aliyun-appkey'), aliyunToken: $('#aliyun-token'),
  settingsPath: $('#settings-path'), settingsError: $('#settings-error'), cancel: $('#settings-cancel'),
}
const ANSWER_MAX_LENGTH = 200
const SESSION_KEY = 'listenInstantAns.sessionId'
const DEVICE_KEY = 'listenInstantAns.microphone'

let sessionId = null
let current = null // the session shown on the right
let liveId = null // the session that is recording right now, if any
let events = null
let devices = []
const transcriptSequences = new Set()
const qaIds = new Set()
const drafts = new Map()
const activeRuns = new Map() // runId -> slot
let refreshTimer = null

const remember = {
  get(key, from = localStorage) { try { return from.getItem(key) } catch { return null } },
  set(key, value, to = localStorage) { try { to.setItem(key, value) } catch { /* private mode */ } },
}

function setStatus(message) { els.status.textContent = message }
function timeLabel(ms) { return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function deviceName(id) { return devices.find((device) => device.id === id)?.name ?? `设备 ${id}` }
function conciseAnswer(answer) {
  const text = String(answer ?? '').trim()
  return text.length <= ANSWER_MAX_LENGTH ? text : `${text.slice(0, ANSWER_MAX_LENGTH)}…`
}

async function request(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data.error ?? '请求失败')
    error.code = data.code
    throw error
  }
  return data
}

/* ---------- lists: newest first ---------- */

function appendTranscript(item) {
  if (transcriptSequences.has(item.sequence)) return
  transcriptSequences.add(item.sequence)
  const row = document.createElement('li')
  row.textContent = item.text
  els.transcripts.prepend(row)
}

function appendQa(item) {
  const id = item.qaId ?? item.id
  if (qaIds.has(id)) return
  qaIds.add(id)
  const row = document.createElement('li')
  const question = document.createElement('p')
  question.className = 'qa-question'
  question.textContent = `问题：${item.question}`
  const answer = document.createElement('p')
  answer.className = 'qa-answer'
  answer.textContent = `答案：${conciseAnswer(item.answer)}`
  row.append(question, answer)
  els.qas.prepend(row)
}

/** Says what the agents are doing right now; falls back to a calm line when they are idle. */
function renderActivity() {
  if (activeRuns.size > 0) {
    setStatus(`Agent ${[...new Set(activeRuns.values())].sort().join('、')} 处理中…`)
  } else if (current?.listening) {
    setStatus('正在录音，等待新问题…')
  } else {
    setStatus('空闲。')
  }
}

function refreshSessionsSoon() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { void refreshCurrent().catch(() => undefined) }, 600)
}

function renderDrafts() {
  els.qaPartial.textContent = [...drafts.values()]
    .map((draft) => `Agent ${draft.slot} 正在写…\nQ · ${draft.question}\nA · ${draft.answer}`)
    .join('\n\n')
}

function clearLists() {
  els.transcripts.replaceChildren()
  els.qas.replaceChildren()
  transcriptSequences.clear()
  qaIds.clear()
  drafts.clear()
  activeRuns.clear()
  renderDrafts()
  els.partial.textContent = '等待语音…'
}

async function loadTimeline() {
  const data = await request(`/sessions/${sessionId}/timeline`)
  clearLists()
  data.transcripts.forEach(appendTranscript)
  data.qas.filter((item) => item.status === 'shown').forEach(appendQa)
}

/* ---------- sessions ---------- */

function sessionDetail(item) {
  if (item.listening) return '正在录音'
  if (item.activeSlots.length > 0) return `Agent ${item.activeSlots.join('、')} 回答中`
  return item.transcriptVersion === 0 ? '空会话' : `${item.transcriptVersion} 段转录`
}

async function loadSessions() {
  const items = await request('/sessions')
  liveId = items.find((item) => item.listening)?.id ?? null
  els.sessions.replaceChildren()
  for (const item of items) {
    const button = document.createElement('button')
    button.className = `session${item.id === sessionId ? ' active' : ''}`
    button.textContent = timeLabel(item.createdAtMs)
    const detail = document.createElement('small')
    detail.textContent = sessionDetail(item)
    button.append(detail)
    button.onclick = () => { activateSession(item.id).catch((error) => setStatus(error.message)) }
    els.sessions.append(button)
  }
  updateControls()
  return items
}

async function refreshCurrent() {
  if (sessionId === null) { current = null } else { current = await request(`/sessions/${sessionId}`) }
  await loadSessions()
}

function updateControls() {
  const noDevice = devices.length === 0
  els.start.disabled = noDevice || liveId !== null
  els.stop.disabled = liveId === null
  els.device.disabled = noDevice || liveId !== null
  if (liveId !== null && liveId !== sessionId) {
    setStatus('另一个会话正在录音，点“停止录音”后才能开始新的。')
  }
}

async function activateSession(id) {
  sessionId = id
  remember.set(SESSION_KEY, id, sessionStorage)
  current = await request(`/sessions/${id}`)
  els.title.textContent = `会话 ${timeLabel(current.createdAtMs)}`
  await loadTimeline()
  connectEvents()
  if (current.listening) {
    setStatus('正在录音…')
  } else {
    setStatus(current.transcriptVersion > 0 ? '这是历史会话。点“开始录音”会新建一个会话。' : '点“开始录音”开始。')
  }
  await loadSessions()
}

async function createSession() {
  const created = await request('/sessions', 'POST', { language: 'zh-CN' })
  await activateSession(created.id)
}

/* ---------- recording ---------- */

async function startListening() {
  els.start.disabled = true
  try {
    if (sessionId === null || current === null || current.transcriptVersion > 0 || current.listening) {
      await createSession()
    }
    remember.set(DEVICE_KEY, els.device.value)
    await request(`/sessions/${sessionId}/listening/start`, 'POST', { microphoneDevice: els.device.value })
    await refreshCurrent()
  } catch (error) {
    setStatus(error.message)
    if (error.code === 'settings') void openSettings(error.message)
    updateControls()
  }
}

async function stopListening() {
  if (liveId === null) return
  els.stop.disabled = true
  try {
    await request(`/sessions/${liveId}/listening/stop`, 'POST', {})
    await refreshCurrent()
    setStatus('已停止录音。')
  } catch (error) {
    setStatus(error.message)
    updateControls()
  }
}

function connectEvents() {
  events?.close()
  const source = new EventSource(`/sessions/${sessionId}/events`)
  events = source
  source.onmessage = (message) => {
    const event = JSON.parse(message.data)
    if (event.type === 'listening.started') { setStatus(`正在录音：${deviceName(event.microphoneDevice)}`); void refreshCurrent() }
    if (event.type === 'listening.stopped') { void refreshCurrent() }
    if (event.type === 'listening.failed') { setStatus(`录音中断：${event.message}`); void refreshCurrent() }
    if (event.type === 'transcript.partial') els.partial.textContent = event.text
    if (event.type === 'transcript.final') { els.partial.textContent = '等待语音…'; appendTranscript(event.transcript); refreshSessionsSoon() }
    if (event.type === 'agent.started') { activeRuns.set(event.runId, event.slot); renderActivity() }
    if (event.type === 'qa.partial') { drafts.set(event.runId, { slot: event.slot, question: event.question, answer: event.answer }); renderDrafts() }
    if (event.type === 'qa.completed') { drafts.delete(event.runId); renderDrafts(); appendQa(event) }
    if (event.type === 'agent.finished') { drafts.delete(event.runId); activeRuns.delete(event.runId); renderDrafts(); renderActivity(); refreshSessionsSoon() }
    if (event.type === 'agent.failed') {
      drafts.delete(event.runId); activeRuns.delete(event.runId); renderDrafts()
      setStatus(`Agent ${event.slot} 已跳过：${event.message}`)
      refreshSessionsSoon()
    }
  }
  source.onerror = () => setStatus('和服务的连接断了，正在重连…')
}

/* ---------- microphones ---------- */

async function loadDevices() {
  let data
  try { data = await request('/devices') } catch (error) { data = { devices: [], error: error.message } }
  devices = data.devices
  els.device.replaceChildren()
  if (devices.length === 0) {
    const option = new Option(data.error ?? '没有找到麦克风', '', true, true)
    option.disabled = true
    els.device.append(option)
    setStatus(data.error ?? '没有找到麦克风。')
    updateControls()
    return
  }
  for (const device of devices) els.device.append(new Option(device.name, device.id))
  const saved = remember.get(DEVICE_KEY)
  const preferred = devices.find((device) => device.id === saved)
    ?? devices.find((device) => /macbook|built-?in|内置/i.test(device.name))
    ?? devices[0]
  els.device.value = preferred.id
  updateControls()
}

/* ---------- settings ---------- */

function placeholderFor(secret) {
  return secret.set ? `已设置 ${secret.hint}${secret.source === 'env' ? '（来自环境变量）' : ''}` : '尚未设置'
}

async function openSettings(message = '') {
  els.settingsError.textContent = message
  try {
    const status = await request('/settings')
    els.settingsPath.textContent = status.path ?? '内存'
    els.mimoKey.value = ''
    els.aliyunAppKey.value = ''
    els.aliyunToken.value = ''
    els.mimoKey.placeholder = placeholderFor(status.mimo.apiKey)
    els.aliyunAppKey.placeholder = placeholderFor(status.aliyun.appKey)
    els.aliyunToken.placeholder = placeholderFor(status.aliyun.token)
    els.mimoModel.value = status.mimo.model
  } catch (error) {
    els.settingsError.textContent = error.message
  }
  if (!els.dialog.open) els.dialog.showModal()
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const mimo = { model: els.mimoModel.value.trim() }
  const aliyun = {}
  if (els.mimoKey.value.trim() !== '') mimo.apiKey = els.mimoKey.value.trim()
  if (els.aliyunAppKey.value.trim() !== '') aliyun.appKey = els.aliyunAppKey.value.trim()
  if (els.aliyunToken.value.trim() !== '') aliyun.token = els.aliyunToken.value.trim()
  try {
    const status = await request('/settings', 'PUT', { mimo, aliyun })
    els.dialog.close()
    setStatus(status.ready.answering && status.ready.transcription ? '设置已保存，可以开始录音了。' : '设置已保存，但还有密钥没填。')
  } catch (error) {
    els.settingsError.textContent = error.message
  }
})
els.cancel.onclick = () => els.dialog.close()
els.openSettings.onclick = () => { void openSettings() }

/* ---------- start-up ---------- */

els.newSession.onclick = () => { createSession().catch((error) => setStatus(error.message)) }
els.start.onclick = () => { void startListening() }
els.stop.onclick = () => { void stopListening() }

async function init() {
  await loadDevices()
  const items = await loadSessions()
  const saved = remember.get(SESSION_KEY, sessionStorage)
  const target = items.find((item) => item.id === saved) ?? items.find((item) => item.listening) ?? items[0]
  if (target !== undefined) await activateSession(target.id)
  const settings = await request('/settings')
  if (!settings.ready.answering || !settings.ready.transcription) {
    await openSettings('先填好密钥才能使用：回答需要 MiMo API Key，语音识别需要阿里云 AppKey 和 Token。')
  }
}

init().catch((error) => setStatus(error.message))

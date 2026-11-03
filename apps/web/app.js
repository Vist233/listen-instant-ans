const status = document.querySelector('#status')
const partial = document.querySelector('#partial')
const qaPartial = document.querySelector('#qa-partial')
const transcripts = document.querySelector('#transcripts')
const qas = document.querySelector('#qas')
const sessionList = document.querySelector('#sessions')
const sessionTitle = document.querySelector('#session-title')
const createButton = document.querySelector('#create')
const startButton = document.querySelector('#start')
const stopButton = document.querySelector('#stop')
const device = document.querySelector('#device')
let sessionId = null
let events = null
const transcriptSequences = new Set()
const qaIds = new Set()
const drafts = new Map()
const sessionStorageKey = 'listenInstantAns.sessionId'
const ANSWER_MAX_LENGTH = 200

function setStatus(message) { status.textContent = message }
function sessionLabel(session) { return new Date(session.createdAtMs).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function hasQuestion(item) { return typeof item.question === 'string' && item.question.trim() !== '' }
function conciseAnswer(answer) {
  if (typeof answer !== 'string') return '（未生成答案）'
  const text = answer.trim()
  return text.length <= ANSWER_MAX_LENGTH ? text : `${text.slice(0, ANSWER_MAX_LENGTH)}…`
}
async function loadSessions() {
  const items = await request('/sessions')
  sessionList.replaceChildren()
  for (const item of items) {
    const button = document.createElement('button')
    button.className = `session${item.id === sessionId ? ' active' : ''}`
    button.textContent = sessionLabel(item)
    const detail = document.createElement('small')
    detail.textContent = item.listening ? '正在录音' : item.activeAgent ? `Agent ${item.activeAgent} 回答中` : '已结束'
    button.append(detail)
    button.onclick = () => {
      void activateSession(item.id).catch((error) => setStatus(error.message))
    }
    sessionList.append(button)
  }
}
function appendTranscript(item) {
  if (transcriptSequences.has(item.sequence)) return
  transcriptSequences.add(item.sequence)
  const row = document.createElement('li')
  row.textContent = item.text
  transcripts.append(row)
}
function appendQa(result) {
  const id = result.qaId ?? result.id
  if (qaIds.has(id)) return
  qaIds.add(id)
  const row = document.createElement('li')
  const question = document.createElement('p')
  question.className = 'qa-question'
  question.textContent = `问题：${result.question}`
  const answer = document.createElement('p')
  answer.className = 'qa-answer'
  answer.textContent = `答案：${conciseAnswer(result.answer)}`
  row.append(question, answer)
  qas.prepend(row)
}
function renderDrafts() {
  qaPartial.textContent = [...drafts.entries()]
    .map(([, draft]) => `Agent ${draft.slot} 正在写…\nQ · ${draft.question}\nA · ${draft.answer}`)
    .join('\n\n')
}
async function request(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Request failed')
  return data
}
async function loadTimeline() {
  const data = await request(`/sessions/${sessionId}/timeline`)
  transcripts.replaceChildren()
  qas.replaceChildren()
  transcriptSequences.clear()
  qaIds.clear()
  drafts.clear()
  renderDrafts()
  data.transcripts.forEach(appendTranscript)
  data.qas.filter((item) => item.status === 'shown').forEach(appendQa)
}
function connectEvents() {
  events?.close()
  events = new EventSource(`/sessions/${sessionId}/events`)
  events.onmessage = (message) => {
    const event = JSON.parse(message.data)
    if (event.type === 'listening.started') setStatus(`Listening on microphone ${event.microphoneDevice}`)
    if (event.type === 'listening.stopped') setStatus('Stopped')
    if (event.type === 'transcript.partial') partial.textContent = event.text
    if (event.type === 'transcript.final') { partial.textContent = 'Waiting for speech…'; appendTranscript(event.transcript) }
    if (event.type === 'agent.started') setStatus(`Agent ${event.slot} 处理中…`)
    if (event.type === 'qa.partial') { drafts.set(event.runId, { slot: event.slot, question: event.question, answer: event.answer }); renderDrafts() }
    if (event.type === 'qa.completed') { drafts.delete(event.runId); renderDrafts(); appendQa(event); setStatus(`Agent ${event.slot} 已回答`) }
    if (event.type === 'agent.finished') { drafts.delete(event.runId); renderDrafts() }
    if (event.type === 'agent.failed') { drafts.delete(event.runId); renderDrafts(); setStatus(`Agent ${event.slot} 已跳过：${event.message}`) }
    if (event.type === 'listening.failed') { setStatus(`录音中断：${event.message}`); startButton.disabled = false; stopButton.disabled = true }
  }
  events.onerror = () => setStatus('Live connection interrupted; reconnecting…')
}
async function activateSession(id) {
  sessionId = id
  sessionStorage.setItem(sessionStorageKey, sessionId)
  const state = await request(`/sessions/${sessionId}`)
  sessionTitle.textContent = `会话 ${sessionId.slice(0, 8)}`
  await loadTimeline()
  connectEvents()
  startButton.disabled = state.listening
  stopButton.disabled = !state.listening
  setStatus(state.activeAgent === null
    ? `Session ${sessionId.slice(0, 8)} ready`
    : `Agent ${state.activeAgent} is answering…`)
  await loadSessions()
}
createButton.onclick = async () => {
  createButton.disabled = true
  try {
    const session = await request('/sessions', 'POST', { language: 'zh-CN' })
    sessionStorage.setItem(sessionStorageKey, session.id)
    await activateSession(session.id)
  } catch (error) { setStatus(error.message) } finally { createButton.disabled = false }
}
startButton.onclick = async () => {
  if (sessionId === null) {
    await createButton.onclick()
  }
  startButton.disabled = true
  try {
    await request(`/sessions/${sessionId}/listening/start`, 'POST', { microphoneDevice: device.value })
    stopButton.disabled = false
    await loadSessions()
  } catch (error) { setStatus(error.message); startButton.disabled = false }
}
stopButton.onclick = async () => {
  stopButton.disabled = true
  try {
    await request(`/sessions/${sessionId}/listening/stop`, 'POST', {})
    startButton.disabled = false
    await loadSessions()
  } catch (error) { setStatus(error.message); stopButton.disabled = false }
}
const savedSessionId = sessionStorage.getItem(sessionStorageKey)
if (savedSessionId !== null) {
  activateSession(savedSessionId).catch(() => {
    sessionStorage.removeItem(sessionStorageKey)
    setStatus('Create a session to begin.')
  })
} else {
  loadSessions()
    .then(async () => {
      const items = await request('/sessions')
      if (items.length > 0) await activateSession(items[0].id)
    })
    .catch((error) => setStatus(error.message))
}

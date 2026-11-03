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
const qaRunIds = new Set()
const sessionStorageKey = 'listenInstantAns.sessionId'

function setStatus(message) { status.textContent = message }
function sessionLabel(session) { return new Date(session.createdAtMs).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
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
    button.onclick = () => activateSession(item.id)
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
function appendQa(result, slot, runId) {
  if (runId !== undefined && qaRunIds.has(runId)) return
  if (runId !== undefined) qaRunIds.add(runId)
  const row = document.createElement('li')
  const questionLabel = document.createElement('strong')
  questionLabel.textContent = `${slot} · Q`
  const question = document.createTextNode(` ${result.question}`)
  const answer = document.createElement('div')
  answer.className = 'qa-answer'
  answer.textContent = `A · ${result.answer}`
  row.append(questionLabel, question, answer)
  qas.append(row)
}
function renderQaPartial(partialResult, slot) {
  const lines = [`Agent ${slot} is drafting…`]
  if (partialResult.question) lines.push(`Q · ${partialResult.question}`)
  if (partialResult.answer) lines.push(`A · ${partialResult.answer}`)
  qaPartial.textContent = lines.join('\n')
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
  qaRunIds.clear()
  data.transcripts.forEach(appendTranscript)
  data.qas.filter((item) => item.question && item.answer).forEach((item) => appendQa(item, item.slot, item.runId))
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
    if (event.type === 'agent.started') { qaPartial.textContent = ''; setStatus(`Agent ${event.slot} is answering…`) }
    if (event.type === 'qa.partial') renderQaPartial(event.partial, event.slot)
    if (event.type === 'qa.completed') {
      qaPartial.textContent = ''
      if (event.result.status !== 'ignore' && event.result.question && event.result.answer) appendQa(event.result, event.slot, event.runId)
      setStatus(`Agent ${event.slot} completed`)
    }
    if (event.type === 'agent.failed') { qaPartial.textContent = ''; setStatus(`Agent ${event.slot} failed: ${event.message}`) }
  }
  events.onerror = () => setStatus('Live connection interrupted; reconnecting…')
}
async function activateSession(id) {
  sessionId = id
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
} else loadSessions().catch((error) => setStatus(error.message))

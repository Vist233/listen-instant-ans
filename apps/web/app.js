const status = document.querySelector('#status')
const partial = document.querySelector('#partial')
const transcripts = document.querySelector('#transcripts')
const qas = document.querySelector('#qas')
const createButton = document.querySelector('#create')
const startButton = document.querySelector('#start')
const stopButton = document.querySelector('#stop')
const device = document.querySelector('#device')
let sessionId = null
let events = null

function setStatus(message) { status.textContent = message }
function appendTranscript(item) {
  const row = document.createElement('li')
  row.textContent = item.text
  transcripts.append(row)
}
function appendQa(result, slot) {
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
  data.transcripts.forEach(appendTranscript)
  data.qas.filter((item) => item.question && item.answer).forEach((item) => appendQa(item, item.slot))
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
    if (event.type === 'agent.started') setStatus(`Agent ${event.slot} is answering…`)
    if (event.type === 'qa.completed') { appendQa(event.result, event.slot); setStatus(`Agent ${event.slot} completed`); }
    if (event.type === 'agent.failed') setStatus(`Agent ${event.slot} failed: ${event.message}`)
  }
}
createButton.onclick = async () => {
  try {
    const session = await request('/sessions', 'POST', { language: 'zh-CN' })
    sessionId = session.id
    setStatus(`Session ${sessionId.slice(0, 8)} ready`)
    startButton.disabled = false
    await loadTimeline()
    connectEvents()
  } catch (error) { setStatus(error.message) }
}
startButton.onclick = async () => {
  try { await request(`/sessions/${sessionId}/listening/start`, 'POST', { microphoneDevice: device.value }); startButton.disabled = true; stopButton.disabled = false } catch (error) { setStatus(error.message) }
}
stopButton.onclick = async () => {
  try { await request(`/sessions/${sessionId}/listening/stop`, 'POST', {}); startButton.disabled = false; stopButton.disabled = true } catch (error) { setStatus(error.message) }
}

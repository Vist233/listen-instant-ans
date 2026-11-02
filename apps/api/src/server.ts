import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { loadConfig } from './config/env.js'
import { MastraQaRunner } from './agent/mastra-qa-runner.js'
import { UnconfiguredQaRunner, type QaRunner } from './agent/qa-runner.js'
import { createOpenCodeQaAgents } from './agent/opencode-mastra-agents.js'
import { createApplication } from './runtime/application.js'

const config = loadConfig()
const runner: QaRunner = config.opencode.apiKey === undefined
  ? new UnconfiguredQaRunner()
  : new MastraQaRunner(createOpenCodeQaAgents(config.opencode))
const application = createApplication(config.databasePath, runner)
const port = Number(process.env.PORT ?? 3100)

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return JSON.parse(body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/sessions') {
      const body = await readJson(request)
      const language = isRecord(body) && typeof body.language === 'string' ? body.language : 'zh-CN'
      const id = randomUUID()
      application.controller.start(id, language)
      sendJson(response, 201, { id, language })
      return
    }
    const stateMatch = url.pathname.match(/^\/sessions\/([^/]+)$/)
    if (request.method === 'GET' && stateMatch !== null) {
      sendJson(response, 200, application.sessions.get(stateMatch[1]))
      return
    }
    const transcriptMatch = url.pathname.match(/^\/sessions\/([^/]+)\/transcripts$/)
    if (request.method === 'POST' && transcriptMatch !== null) {
      const body = await readJson(request)
      if (!isRecord(body)
        || typeof body.sequence !== 'number'
        || !Number.isInteger(body.sequence)
        || typeof body.startedAtMs !== 'number'
        || typeof body.endedAtMs !== 'number'
        || typeof body.text !== 'string'
        || body.text.trim() === '') {
        sendJson(response, 400, { error: 'Invalid final transcript.' })
        return
      }
      application.controller.appendFinalTranscript(transcriptMatch[1], {
        sequence: body.sequence,
        startedAtMs: body.startedAtMs,
        endedAtMs: body.endedAtMs,
        text: body.text,
        confidence: typeof body.confidence === 'number' ? body.confidence : null,
      })
      sendJson(response, 202, { accepted: true })
      return
    }
    const eventsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/events$/)
    if (request.method === 'GET' && eventsMatch !== null) {
      const sessionId = eventsMatch[1]
      application.sessions.get(sessionId)
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const unsubscribe = application.events.subscribe((event) => {
        if (event.sessionId === sessionId) response.write(`data: ${JSON.stringify(event)}\n\n`)
      })
      request.on('close', unsubscribe)
      return
    }
    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.'
    sendJson(response, message.startsWith('Session not found:') ? 404 : 400, { error: message })
  }
})

server.listen(port, () => {
  console.log(`ListenInstantAns API listening on http://127.0.0.1:${port}`)
})

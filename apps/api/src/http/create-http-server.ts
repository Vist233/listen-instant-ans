import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Application } from '../bootstrap.js'

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return body === '' ? {} : JSON.parse(body)
}

export function createHttpServer(app: Application, webRoot: string): Server {
  const { sessions, controller, runtime, events } = app

  const view = (sessionId: string): object => {
    const info = sessions.get(sessionId)
    const activeSlots = controller.activeSlots(sessionId)
    return { ...info, activeAgent: activeSlots[0] ?? null, activeSlots, listening: runtime.isListening(sessionId) }
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      const path = url.pathname
      const method = request.method

      if (method === 'GET' && path === '/health') {
        sendJson(response, 200, { ok: true })
        return
      }
      if (method === 'POST' && path === '/sessions') {
        const body = await readJson(request)
        const language = isRecord(body) && typeof body.language === 'string' ? body.language : 'zh-CN'
        const info = controller.start(randomUUID(), language)
        sendJson(response, 201, { ...info, listening: false })
        return
      }
      if (method === 'GET' && path === '/sessions') {
        sendJson(response, 200, sessions.list().map((info) => view(info.id)))
        return
      }
      const match = path.match(/^\/sessions\/([^/]+)(?:\/(timeline|listening\/start|listening\/stop|transcripts|events))?$/)
      if (match !== null) {
        const [, sessionId, action] = match
        if (method === 'GET' && action === undefined) {
          sendJson(response, 200, view(sessionId))
          return
        }
        if (method === 'GET' && action === 'timeline') {
          sendJson(response, 200, sessions.timeline(sessionId))
          return
        }
        if (method === 'POST' && action === 'listening/start') {
          const body = await readJson(request)
          sessions.get(sessionId)
          const device = isRecord(body) && typeof body.microphoneDevice === 'string'
            ? body.microphoneDevice
            : process.env.LISTEN_INSTANT_ANS_AUDIO_DEVICE ?? '0'
          await runtime.start(sessionId, device)
          sendJson(response, 200, view(sessionId))
          return
        }
        if (method === 'POST' && action === 'listening/stop') {
          await runtime.stop(sessionId)
          sendJson(response, 200, view(sessionId))
          return
        }
        if (method === 'POST' && action === 'transcripts') {
          const body = await readJson(request)
          if (!isRecord(body)
            || typeof body.startedAtMs !== 'number'
            || typeof body.endedAtMs !== 'number'
            || typeof body.text !== 'string'
            || body.text.trim() === '') {
            sendJson(response, 400, { error: 'Invalid final transcript.' })
            return
          }
          const transcript = controller.appendFinalTranscript(sessionId, {
            startedAtMs: body.startedAtMs,
            endedAtMs: body.endedAtMs,
            text: body.text,
            confidence: typeof body.confidence === 'number' ? body.confidence : null,
          })
          sendJson(response, 202, { accepted: true, sequence: transcript.sequence })
          return
        }
        if (method === 'GET' && action === 'events') {
          sessions.get(sessionId)
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          response.write(': connected\n\n')
          const unsubscribe = events.subscribe((event) => {
            if (event.sessionId === sessionId) response.write(`data: ${JSON.stringify(event)}\n\n`)
          })
          const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
          request.on('close', () => {
            clearInterval(heartbeat)
            unsubscribe()
          })
          return
        }
      }
      const asset = method === 'GET' ? STATIC_FILES[path] : undefined
      if (asset !== undefined) {
        response.writeHead(200, { 'content-type': asset.type })
        response.end(await readFile(join(webRoot, asset.file)))
        return
      }
      sendJson(response, 404, { error: 'Not found.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.'
      sendJson(response, message.startsWith('Session not found:') ? 404 : 400, { error: message })
    }
  })
}

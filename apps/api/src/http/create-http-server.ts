import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Application } from '../bootstrap.js'
import { SettingsError } from '../config/settings-store.js'

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/capture.js': { file: 'capture.js', type: 'text/javascript; charset=utf-8' },
  '/pcm.js': { file: 'pcm.js', type: 'text/javascript; charset=utf-8' },
  '/pcm-worklet.js': { file: 'pcm-worklet.js', type: 'text/javascript; charset=utf-8' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

const MAX_BODY_BYTES = 64 * 1024
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

async function readBytes(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.')
    chunks.push(chunk as Buffer)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > MAX_BODY_BYTES) throw new Error('Request body is too large.')
  }
  return body === '' ? {} : JSON.parse(body)
}

/** Only this machine may talk to the server: blocks DNS-rebinding and cross-site requests. */
function forbiddenReason(request: IncomingMessage): string | null {
  const host = request.headers.host ?? ''
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  if (!LOCAL_HOSTS.has(name)) return 'Forbidden host.'
  const origin = request.headers.origin
  if (request.method !== 'GET' && origin !== undefined) {
    try {
      if (new URL(origin).host !== host) return 'Forbidden origin.'
    } catch {
      return 'Forbidden origin.'
    }
  }
  return null
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

      const forbidden = forbiddenReason(request)
      if (forbidden !== null) {
        sendJson(response, 403, { error: forbidden })
        return
      }

      if (method === 'GET' && path === '/health') {
        sendJson(response, 200, { ok: true })
        return
      }
      if (method === 'GET' && path === '/settings') {
        sendJson(response, 200, app.settings.status())
        return
      }
      if (method === 'PUT' && path === '/settings') {
        sendJson(response, 200, app.settings.update(await readJson(request)))
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
      const match = path.match(/^\/sessions\/([^/]+)(?:\/(timeline|listening\/start|listening\/stop|transcripts|audio|events))?$/)
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
          const name = isRecord(body) && typeof body.microphoneDevice === 'string' ? body.microphoneDevice : '麦克风'
          await runtime.start(sessionId, name)
          sendJson(response, 200, view(sessionId))
          return
        }
        if (method === 'POST' && action === 'listening/stop') {
          await runtime.stop(sessionId)
          sendJson(response, 200, view(sessionId))
          return
        }
        if (method === 'POST' && action === 'audio') {
          runtime.pushAudio(sessionId, await readBytes(request))
          response.writeHead(204)
          response.end()
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
        // Read first: once the headers are out, a failed read could not be reported any more.
        const body = await readFile(join(webRoot, asset.file)).catch(() => null)
        if (body === null) {
          sendJson(response, 404, { error: 'Not found.' })
          return
        }
        response.writeHead(200, { 'content-type': asset.type })
        response.end(body)
        return
      }
      sendJson(response, 404, { error: 'Not found.' })
    } catch (error) {
      if (response.headersSent) {
        response.destroy()
        return
      }
      const message = error instanceof Error ? error.message : 'Unexpected error.'
      if (error instanceof SettingsError) {
        sendJson(response, 400, { error: message, code: 'settings' })
        return
      }
      sendJson(response, message.startsWith('Session not found:') ? 404 : 400, { error: message })
    }
  })
}

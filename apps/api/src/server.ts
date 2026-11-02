import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config/env.js'
import { createConfiguredRunner } from './runtime/configured-runner.js'
import { createApplication } from './runtime/application.js'
import { SessionRuntimeManager } from './runtime/session-runtime-manager.js'
import { VoiceSession } from './runtime/voice-session.js'
import { AliyunRealtimeTranscriber } from './voice/aliyun-realtime-transcriber.js'
import { FfmpegMicrophone } from './voice/ffmpeg-microphone.js'
import { WebSessionFacade } from './web/web-session-facade.js'

const config = loadConfig()
const application = createApplication(config.databasePath, createConfiguredRunner(config))
const runtime = new SessionRuntimeManager((sessionId, microphoneDevice) => {
  if (config.aliyun.appKey === undefined || config.aliyun.token === undefined) {
    throw new Error('ALIYUN_APP_ID and ALIYUN_TMP_TOKEN are required before listening can start.')
  }
  return new VoiceSession(
    sessionId,
    application.controller,
    new FfmpegMicrophone(),
    new AliyunRealtimeTranscriber({
      appKey: config.aliyun.appKey,
      token: config.aliyun.token,
      endpoint: config.aliyun.endpoint,
    }),
    microphoneDevice,
  )
}, application.events)
const web = new WebSessionFacade(application.controller, application.sessions, runtime, application.events)
const port = Number(process.env.PORT ?? 3100)
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../../web')

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return JSON.parse(body)
}

async function sendStatic(response: ServerResponse, path: string): Promise<boolean> {
  const files: Record<string, string> = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/app.js': 'app.js',
    '/styles.css': 'styles.css',
  }
  const file = files[path]
  if (file === undefined) return false
  const body = await readFile(join(webRoot, file))
  const contentType = file.endsWith('.html') ? 'text/html; charset=utf-8'
    : file.endsWith('.css') ? 'text/css; charset=utf-8'
      : 'text/javascript; charset=utf-8'
  response.writeHead(200, { 'content-type': contentType })
  response.end(body)
  return true
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
      sendJson(response, 201, web.create(language))
      return
    }
    const stateMatch = url.pathname.match(/^\/sessions\/([^/]+)$/)
    if (request.method === 'GET' && stateMatch !== null) {
      sendJson(response, 200, web.snapshot(stateMatch[1]))
      return
    }
    const timelineMatch = url.pathname.match(/^\/sessions\/([^/]+)\/timeline$/)
    if (request.method === 'GET' && timelineMatch !== null) {
      sendJson(response, 200, web.timeline(timelineMatch[1]))
      return
    }
    const startMatch = url.pathname.match(/^\/sessions\/([^/]+)\/listening\/start$/)
    if (request.method === 'POST' && startMatch !== null) {
      const body = await readJson(request)
      const microphoneDevice = isRecord(body) && typeof body.microphoneDevice === 'string'
        ? body.microphoneDevice
        : process.env.LISTEN_INSTANT_ANS_AUDIO_DEVICE ?? '0'
      sendJson(response, 200, await web.startListening(startMatch[1], microphoneDevice))
      return
    }
    const stopMatch = url.pathname.match(/^\/sessions\/([^/]+)\/listening\/stop$/)
    if (request.method === 'POST' && stopMatch !== null) {
      sendJson(response, 200, await web.stopListening(stopMatch[1]))
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
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
      request.on('close', () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
      return
    }
    if (request.method === 'GET' && await sendStatic(response, url.pathname)) return
    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.'
    sendJson(response, message.startsWith('Session not found:') ? 404 : 400, { error: message })
  }
})

server.listen(port, () => {
  console.log(`ListenInstantAns API listening on http://127.0.0.1:${port}`)
})

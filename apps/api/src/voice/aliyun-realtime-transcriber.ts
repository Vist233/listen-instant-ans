import { EventEmitter } from 'node:events'
import type { VoiceProvider, VoiceSessionConfig } from './voice-provider.js'

export interface AliyunCredentials {
  readonly appKey: string
  readonly token: string
  readonly endpoint: string
}

/**
 * Keeps Alibaba's protocol behind VoiceProvider. The wire command names are
 * intentionally concentrated here so the session module never depends on ISI.
 */
export class AliyunRealtimeTranscriber implements VoiceProvider {
  readonly #events = new EventEmitter()
  #socket: WebSocket | null = null
  #config: VoiceSessionConfig | null = null
  #taskId: string | null = null
  #resolveStarted: (() => void) | null = null
  #rejectStarted: ((error: Error) => void) | null = null

  constructor(private readonly credentials: AliyunCredentials) {}

  async open(config: VoiceSessionConfig): Promise<void> {
    if (this.#socket !== null) {
      throw new Error('Aliyun transcription session is already open')
    }
    this.#config = config
    this.#taskId = protocolId()
    const url = new URL(this.credentials.endpoint)
    url.searchParams.set('token', this.credentials.token)
    const socket = new WebSocket(url)
    this.#socket = socket
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('Unable to open Aliyun WebSocket')), { once: true })
    })
    socket.addEventListener('message', (event) => this.handleMessage(String(event.data)))
    socket.addEventListener('error', () => this.fail(new Error('Aliyun WebSocket error')))
    const started = new Promise<void>((resolve, reject) => {
      this.#resolveStarted = resolve
      this.#rejectStarted = reject
    })
    const startTimeout = setTimeout(() => {
      this.fail(new Error('Timed out waiting for Aliyun TranscriptionStarted'))
    }, 10_000)
    socket.send(JSON.stringify({
      header: {
        appkey: this.credentials.appKey,
        message_id: protocolId(),
        task_id: this.#taskId,
        name: 'StartTranscription',
        namespace: 'SpeechTranscriber',
      },
      payload: {
        format: 'pcm',
        sample_rate: config.sampleRateHz,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
        max_sentence_silence: config.endpointingMs,
      },
    }))
    try {
      await started
    } finally {
      clearTimeout(startTimeout)
      this.#resolveStarted = null
      this.#rejectStarted = null
    }
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Aliyun transcription session is not open')
    }
    this.#socket.send(chunk)
  }

  async finalize(): Promise<void> {
    this.#socket?.send(JSON.stringify({
      header: {
        appkey: this.credentials.appKey,
        message_id: protocolId(),
        task_id: this.#taskId,
        name: 'StopTranscription',
        namespace: 'SpeechTranscriber',
      },
    }))
  }

  async close(): Promise<void> {
    this.#socket?.close()
    this.#socket = null
    this.#config = null
    this.#taskId = null
  }

  onPartial(listener: (text: string) => void): () => void {
    this.#events.on('partial', listener)
    return () => this.#events.off('partial', listener)
  }

  onFinal(listener: (event: { startedAtMs: number; endedAtMs: number; text: string; confidence: number | null }) => void): () => void {
    this.#events.on('final', listener)
    return () => this.#events.off('final', listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.#events.on('error', listener)
    return () => this.#events.off('error', listener)
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as {
        header?: { name?: string; status_text?: string }
        payload?: { result?: string; time?: number; begin_time?: number; confidence?: number }
      }
      const name = message.header?.name
      const result = message.payload?.result?.trim()
      if (name === 'TranscriptionStarted') {
        this.#resolveStarted?.()
      }
      if (name === 'TranscriptionResultChanged' && result !== undefined && result.length > 0) {
        this.#events.emit('partial', result)
      }
      if (name === 'SentenceEnd' && result !== undefined && result.length > 0) {
        this.#events.emit('final', {
          startedAtMs: message.payload?.begin_time ?? Date.now(),
          endedAtMs: message.payload?.time ?? Date.now(),
          text: result,
          confidence: message.payload?.confidence ?? null,
        })
      }
      if (name === 'TaskFailed') {
        this.fail(new Error(message.header?.status_text ?? 'Aliyun transcription failed'))
      }
    } catch (error) {
      this.#events.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  private fail(error: Error): void {
    this.#rejectStarted?.(error)
    this.#events.emit('error', error)
  }
}

function protocolId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

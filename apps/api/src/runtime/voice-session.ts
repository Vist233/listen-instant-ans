import type { VoiceProvider } from '../voice/voice-provider.js'
import type { SessionController } from '../session/session-controller.js'

export interface Microphone {
  start(): void
  stop(): void
  onAudio(listener: (audio: Uint8Array) => void): () => void
  onError(listener: (error: Error) => void): () => void
  /** Present when the audio comes from the browser. */
  push?(chunk: Uint8Array): void
}

/** Wires one microphone to one transcriber and feeds final transcripts to the controller. */
export class VoiceSession {
  #stopping = false
  #failed = false

  constructor(
    private readonly sessionId: string,
    private readonly controller: SessionController,
    private readonly microphone: Microphone,
    private readonly transcriber: VoiceProvider,
    /** Called once when listening cannot continue (microphone died, connection lost). */
    private readonly onFatal: (error: Error) => void,
  ) {}

  async start(): Promise<void> {
    this.transcriber.onPartial((text) => this.controller.publishPartialTranscript(this.sessionId, text))
    this.transcriber.onFinal((final) => {
      try {
        this.controller.appendFinalTranscript(this.sessionId, final)
      } catch (error) {
        console.error('Could not store a final transcript:', error)
      }
    })
    this.microphone.onAudio((audio) => {
      if (this.#stopping) return
      try {
        this.transcriber.sendAudio(audio)
      } catch (error) {
        this.fail(error)
      }
    })
    this.microphone.onError((error) => this.fail(error))
    this.transcriber.onError((error) => this.fail(error))
    await this.transcriber.open({ language: 'zh-CN', sampleRateHz: 16_000, endpointingMs: 800 })
    this.microphone.start()
  }

  /** Audio chunk from the browser: 16 kHz, mono, 16-bit PCM. */
  pushAudio(chunk: Uint8Array): void {
    if (this.microphone.push === undefined) throw new Error('This session does not take audio from the browser.')
    this.microphone.push(chunk)
  }

  async stop(): Promise<void> {
    this.#stopping = true
    this.microphone.stop()
    await this.transcriber.finalize()
    await this.transcriber.close()
    this.controller.stop(this.sessionId)
  }

  private fail(error: unknown): void {
    if (this.#failed || this.#stopping) return
    this.#failed = true
    this.onFatal(error instanceof Error ? error : new Error(String(error)))
  }
}

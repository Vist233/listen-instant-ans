import type { MicrophoneConfig } from '../voice/ffmpeg-microphone.js'
import type { VoiceProvider } from '../voice/voice-provider.js'
import type { SessionController } from '../session/session-controller.js'

export interface Microphone {
  start(config: MicrophoneConfig): void
  stop(): void
  onAudio(listener: (audio: Uint8Array) => void): () => void
  onError(listener: (error: Error) => void): () => void
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
    private readonly microphoneDevice: string,
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
    this.microphone.start({ device: this.microphoneDevice, sampleRateHz: 16_000 })
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

import type { VoiceProvider } from '../voice/voice-provider.js'
import type { FfmpegMicrophone } from '../voice/ffmpeg-microphone.js'
import type { SessionController } from '../session/session-controller.js'

export class VoiceSession {
  #sequence = 0
  #stopping = false

  constructor(
    private readonly sessionId: string,
    private readonly controller: SessionController,
    private readonly microphone: FfmpegMicrophone,
    private readonly transcriber: VoiceProvider,
  ) {}

  async start(): Promise<void> {
    this.transcriber.onPartial((text) => this.controller.publishPartialTranscript(this.sessionId, text))
    this.transcriber.onFinal((final) => {
      this.controller.appendFinalTranscript(this.sessionId, { ...final, sequence: ++this.#sequence })
    })
    this.microphone.onAudio((audio) => {
      if (this.#stopping) return
      try {
        this.transcriber.sendAudio(audio)
      } catch {
        this.#stopping = true
        this.microphone.stop()
        this.controller.cancelActiveRun(this.sessionId)
      }
    })
    this.microphone.onError((error) => this.controller.cancelActiveRun(this.sessionId))
    this.transcriber.onError((error) => this.controller.cancelActiveRun(this.sessionId))
    await this.transcriber.open({ language: 'zh-CN', sampleRateHz: 16_000, endpointingMs: 800 })
    this.microphone.start({ device: process.env.LISTEN_INSTANT_ANS_AUDIO_DEVICE ?? '0', sampleRateHz: 16_000 })
  }

  async stop(): Promise<void> {
    this.#stopping = true
    this.microphone.stop()
    await this.transcriber.finalize()
    await this.transcriber.close()
    this.controller.stop(this.sessionId)
  }
}

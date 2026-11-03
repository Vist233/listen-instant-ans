import { EventHub } from '../events/event-hub.js'

export interface ManagedVoiceSession {
  start(): Promise<void>
  stop(): Promise<void>
  pushAudio(chunk: Uint8Array): void
}

/** `microphoneName` is only used to tell the user which microphone is in use. */
export type VoiceSessionFactory = (sessionId: string, microphoneName: string) => ManagedVoiceSession

/** Owns the only live microphone/transcription runtime for each session. */
export class SessionRuntimeManager {
  readonly #active = new Map<string, ManagedVoiceSession>()

  constructor(
    private readonly createVoiceSession: VoiceSessionFactory,
    private readonly events: EventHub,
  ) {}

  isListening(sessionId: string): boolean {
    return this.#active.has(sessionId)
  }

  async start(sessionId: string, microphoneName: string): Promise<void> {
    if (this.#active.has(sessionId)) throw new Error(`Session is already listening: ${sessionId}`)
    const voiceSession = this.createVoiceSession(sessionId, microphoneName)
    await voiceSession.start()
    this.#active.set(sessionId, voiceSession)
    this.events.publish({ type: 'listening.started', sessionId, microphoneDevice: microphoneName })
  }

  pushAudio(sessionId: string, chunk: Uint8Array): void {
    const voiceSession = this.#active.get(sessionId)
    if (voiceSession === undefined) throw new Error('Session is not listening.')
    voiceSession.pushAudio(chunk)
  }

  /** Stops every recording, for a clean shutdown. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.#active.keys()].map((sessionId) => this.stop(sessionId)))
  }

  async stop(sessionId: string): Promise<void> {
    const voiceSession = this.#active.get(sessionId)
    if (voiceSession === undefined) return
    this.#active.delete(sessionId)
    await voiceSession.stop()
    this.events.publish({ type: 'listening.stopped', sessionId })
  }
}

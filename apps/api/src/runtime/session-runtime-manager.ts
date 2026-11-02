import { EventHub } from '../events/event-hub.js'

export interface ManagedVoiceSession {
  start(): Promise<void>
  stop(): Promise<void>
}

export type VoiceSessionFactory = (sessionId: string, microphoneDevice: string) => ManagedVoiceSession

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

  async start(sessionId: string, microphoneDevice: string): Promise<void> {
    if (this.#active.has(sessionId)) throw new Error(`Session is already listening: ${sessionId}`)
    const voiceSession = this.createVoiceSession(sessionId, microphoneDevice)
    await voiceSession.start()
    this.#active.set(sessionId, voiceSession)
    this.events.publish({ type: 'listening.started', sessionId, microphoneDevice })
  }

  async stop(sessionId: string): Promise<void> {
    const voiceSession = this.#active.get(sessionId)
    if (voiceSession === undefined) return
    this.#active.delete(sessionId)
    await voiceSession.stop()
    this.events.publish({ type: 'listening.stopped', sessionId })
  }
}

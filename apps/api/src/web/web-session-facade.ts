import { randomUUID } from 'node:crypto'
import { EventHub } from '../events/event-hub.js'
import { SessionRuntimeManager } from '../runtime/session-runtime-manager.js'
import { SessionController } from '../session/session-controller.js'
import { SessionRepository } from '../storage/session-repository.js'

export class WebSessionFacade {
  constructor(
    private readonly controller: SessionController,
    private readonly sessions: SessionRepository,
    private readonly runtime: SessionRuntimeManager,
    readonly events: EventHub,
  ) {}

  create(language: string): { id: string; language: string; listening: boolean } {
    const id = randomUUID()
    this.controller.start(id, language)
    return { id, language, listening: false }
  }

  list(): Array<{ id: string; language: string; createdAtMs: number; updatedAtMs: number; transcriptVersion: number; activeAgent: 'A' | 'B' | null; listening: boolean }> {
    return this.sessions.list().map((session) => ({ ...session, listening: this.runtime.isListening(session.id) }))
  }

  snapshot(sessionId: string): object {
    return { ...this.sessions.get(sessionId), listening: this.runtime.isListening(sessionId) }
  }

  async startListening(sessionId: string, microphoneDevice: string): Promise<object> {
    this.sessions.get(sessionId)
    await this.runtime.start(sessionId, microphoneDevice)
    return this.snapshot(sessionId)
  }

  async stopListening(sessionId: string): Promise<object> {
    await this.runtime.stop(sessionId)
    return this.snapshot(sessionId)
  }

  timeline(sessionId: string): object {
    return this.sessions.timeline(sessionId)
  }
}

import { randomUUID } from 'node:crypto'
import { qaResultSchema, type AgentSlot, type QaResult, type TranscriptFinal } from '@listen-instant-ans/contracts'
import { EventHub } from '../events/event-hub.js'
import type { QaRunner } from '../agent/qa-runner.js'
import { historyTranscriptVersionFor } from './session-state.js'
import { decideNextTurn } from './turn-scheduler.js'
import { SessionRepository } from '../storage/session-repository.js'

interface ActiveRun {
  readonly runId: string
  readonly slot: AgentSlot
  readonly snapshotVersion: number
  readonly controller: AbortController
}

const AGENT_RUN_TIMEOUT_MS = 15_000

export class SessionController {
  readonly #activeRuns = new Map<string, ActiveRun>()
  readonly #lastSlot = new Map<string, AgentSlot>()
  readonly #scheduled = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly sessions: SessionRepository,
    private readonly runner: QaRunner,
    private readonly events: EventHub,
    private readonly now: () => number = Date.now,
  ) {}

  start(sessionId: string, language: string): void {
    this.sessions.create(sessionId, language, this.now())
  }

  appendFinalTranscript(sessionId: string, transcript: TranscriptFinal): void {
    this.sessions.appendTranscript(sessionId, transcript, this.now())
    this.events.publish({ type: 'transcript.final', sessionId, transcript })
    void this.schedule(sessionId)
  }

  publishPartialTranscript(sessionId: string, text: string): void {
    this.events.publish({ type: 'transcript.partial', sessionId, text })
  }

  cancelActiveRun(sessionId: string): void {
    this.#activeRuns.get(sessionId)?.controller.abort()
  }

  stop(sessionId: string): void {
    this.cancelActiveRun(sessionId)
    const timer = this.#scheduled.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.#scheduled.delete(sessionId)
    }
  }

  async schedule(sessionId: string): Promise<void> {
    if (this.#activeRuns.has(sessionId) || this.#scheduled.has(sessionId)) {
      return
    }
    const state = this.sessions.get(sessionId)
    const decision = decideNextTurn(
      state,
      this.#lastSlot.get(sessionId) ?? state.lastCompletedSlot,
      this.now(),
    )
    if (decision === null) {
      return
    }
    if (decision.delayMs > 0) {
      const timer = setTimeout(() => {
        this.#scheduled.delete(sessionId)
        void this.schedule(sessionId)
      }, decision.delayMs)
      this.#scheduled.set(sessionId, timer)
      return
    }
    await this.startTurn(sessionId, decision.slot)
  }

  private async startTurn(sessionId: string, slot: AgentSlot): Promise<void> {
    const state = this.sessions.get(sessionId)
    const snapshotVersion = state.transcriptVersion
    const historyVersion = historyTranscriptVersionFor(state, slot)
    const transcripts = this.sessions.listTranscriptsAfter(sessionId, historyVersion)
    if (transcripts.length === 0) {
      return
    }
    const runId = randomUUID()
    const controller = new AbortController()
    const active: ActiveRun = { runId, slot, snapshotVersion, controller }
    this.#activeRuns.set(sessionId, active)
    this.sessions.markRunStarted(sessionId, slot, runId, snapshotVersion, this.now())
    this.events.publish({ type: 'agent.started', sessionId, runId, slot })
    let merged: Partial<QaResult> = {}
    let timedOut = false
    const run = (async (): Promise<QaResult> => {
      for await (const partial of this.runner.run({
        sessionId,
        slot,
        runId,
        transcripts,
        historyTranscripts: this.sessions.listTranscriptsUntil(sessionId, historyVersion),
        peerQas: this.sessions.listPeerQas(sessionId, slot),
      }, controller.signal)) {
        merged = { ...merged, ...partial }
        if (!timedOut) this.events.publish({ type: 'qa.partial', sessionId, runId, slot, partial })
      }
      if (merged.status === 'ignore') {
        merged.question = null
        merged.answer = null
        merged.sources = []
      }
      return qaResultSchema.parse(merged)
    })()
    let timeoutHandle: NodeJS.Timeout | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), AGENT_RUN_TIMEOUT_MS)
    })
    try {
      const outcome = await Promise.race([run, timeout])
      if (outcome === 'timeout') {
        timedOut = true
        controller.abort()
        void run.catch(() => undefined)
        this.sessions.skipRun(sessionId, slot, runId, this.now())
        this.#lastSlot.set(sessionId, slot)
        this.events.publish({ type: 'agent.failed', sessionId, runId, slot, message: 'Agent timed out after 15 seconds and was skipped.' })
        return
      }
      const result = outcome
      this.sessions.completeRun(sessionId, slot, runId, result, snapshotVersion, this.now())
      this.sessions.advanceAgentHistory(sessionId, slot, snapshotVersion, this.now())
      this.#lastSlot.set(sessionId, slot)
      this.events.publish({ type: 'qa.completed', sessionId, runId, slot, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.sessions.skipRun(sessionId, slot, runId, this.now(), `Unusable structured QA: ${message}`)
      this.#lastSlot.set(sessionId, slot)
      this.events.publish({ type: 'agent.failed', sessionId, runId, slot, message: `Skipped unusable structured QA: ${message}` })
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      this.#activeRuns.delete(sessionId)
      await this.schedule(sessionId)
    }
  }
}

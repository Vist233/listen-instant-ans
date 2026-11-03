import { randomUUID } from 'node:crypto'
import type { AgentSlot, TranscriptFinal } from '@listen-instant-ans/contracts'
import { buildLaneMessages, buildUserMessage } from '../agent/qa-prompt.js'
import { QaLineParser, type ParserEvent } from '../agent/qa-line-parser.js'
import type { QaRunner } from '../agent/qa-runner.js'
import { runTurn } from '../agent/run-turn.js'
import { tuning, type Tuning } from '../config/tuning.js'
import { EventHub } from '../events/event-hub.js'
import { SessionRepository, type SessionInfo } from '../storage/session-repository.js'
import { isDuplicateQuestion } from './dedupe.js'
import { startLaneClock } from './lane-clock.js'

export interface ControllerOptions {
  readonly now?: () => number
  readonly tuning?: Partial<Tuning>
  /** Set to false in tests that drive `tick` by hand. */
  readonly autoStartLanes?: boolean
}

interface LaneRun {
  readonly runId: string
  readonly controller: AbortController
  readonly parser: QaLineParser
  /** True while the pair being written repeats a question that is already shown. */
  suppressed: boolean
}

const laneKey = (sessionId: string, slot: AgentSlot): string => `${sessionId}:${slot}`
const otherSlot = (slot: AgentSlot): AgentSlot => (slot === 'A' ? 'B' : 'A')

/**
 * Glues the pieces together. It owns the two lane timers of each session and,
 * on every tick, runs at most one request per lane.
 */
export class SessionController {
  readonly #running = new Map<string, LaneRun>()
  readonly #clocks = new Map<string, () => void>()
  readonly #now: () => number
  readonly #tuning: Tuning
  readonly #autoStartLanes: boolean

  constructor(
    private readonly sessions: SessionRepository,
    private readonly runner: QaRunner,
    private readonly events: EventHub,
    options: ControllerOptions = {},
  ) {
    this.#now = options.now ?? Date.now
    this.#tuning = { ...tuning, ...options.tuning }
    this.#autoStartLanes = options.autoStartLanes ?? true
  }

  start(sessionId: string, language: string): SessionInfo {
    return this.sessions.create(sessionId, language, this.#now())
  }

  appendFinalTranscript(sessionId: string, final: Omit<TranscriptFinal, 'sequence'>): TranscriptFinal {
    const transcript = this.sessions.appendTranscript(sessionId, final, this.#now())
    this.events.publish({ type: 'transcript.final', sessionId, transcript })
    if (this.#autoStartLanes) this.ensureLanes(sessionId)
    return transcript
  }

  publishPartialTranscript(sessionId: string, text: string): void {
    this.events.publish({ type: 'transcript.partial', sessionId, text })
  }

  activeSlots(sessionId: string): AgentSlot[] {
    return (['A', 'B'] as const).filter((slot) => this.#running.has(laneKey(sessionId, slot)))
  }

  ensureLanes(sessionId: string): void {
    if (this.#clocks.has(sessionId)) return
    this.#clocks.set(sessionId, startLaneClock({
      periodMs: this.#tuning.lanePeriodMs,
      staggerMs: this.#tuning.laneStaggerMs,
      onTick: (slot) => void this.tick(sessionId, slot),
    }))
  }

  cancelActiveRuns(sessionId: string): void {
    for (const slot of ['A', 'B'] as const) {
      this.#running.get(laneKey(sessionId, slot))?.controller.abort()
    }
  }

  /** Stops the lane timers and cancels what is in flight. Transcripts stay. */
  stop(sessionId: string): void {
    this.#clocks.get(sessionId)?.()
    this.#clocks.delete(sessionId)
    this.cancelActiveRuns(sessionId)
  }

  /**
   * One beat of one lane. Skips when the lane is still busy or has heard
   * nothing new. Resolves when the request it started has finished.
   */
  async tick(sessionId: string, slot: AgentSlot): Promise<void> {
    const key = laneKey(sessionId, slot)
    if (this.#running.has(key)) return
    try {
      await this.runLane(sessionId, slot, key)
    } catch (error) {
      console.error(`Lane ${slot} failed for session ${sessionId}:`, error)
    }
  }

  private async runLane(sessionId: string, slot: AgentSlot, key: string): Promise<void> {
    const turns = this.sessions.laneTurns(sessionId, slot)
    const seenVersion = turns.at(-1)?.endVersion ?? 0
    const transcripts = this.sessions.transcripts(sessionId, seenVersion)
    if (transcripts.length === 0) return

    const peerCursor = turns.at(-1)?.peerCursor ?? 0
    const peerQas = this.sessions.peerQasAfter(sessionId, slot, peerCursor)
    const peerInflight = this.#running.get(laneKey(sessionId, otherSlot(slot)))?.parser.pending() ?? null
    const inputText = buildUserMessage({ transcripts, peerQas, peerInflight })
    const runId = randomUUID()
    const lane: LaneRun = { runId, controller: new AbortController(), parser: new QaLineParser(), suppressed: false }

    // Everything up to the first await is synchronous, so two ticks can never both start this lane.
    this.#running.set(key, lane)
    try {
      this.sessions.startRun({
        sessionId,
        slot,
        runId,
        startVersion: seenVersion,
        endVersion: transcripts[transcripts.length - 1].sequence,
        inputText,
        peerCursor: peerQas.at(-1)?.id ?? peerCursor,
        nowMs: this.#now(),
      })
      this.events.publish({ type: 'agent.started', sessionId, runId, slot })
      const outcome = await runTurn(this.runner, {
        sessionId,
        slot,
        runId,
        messages: buildLaneMessages(turns, inputText),
        onUsage: (usage) => this.sessions.recordUsage(runId, usage),
      }, {
        controller: lane.controller,
        timeoutMs: this.#tuning.runTimeoutMs,
        onDelta: (delta) => this.handleParserEvents(sessionId, slot, lane, lane.parser.push(delta)),
      })
      if (outcome.kind === 'completed') {
        this.handleParserEvents(sessionId, slot, lane, lane.parser.end())
        // An empty reply is stored as "-" so the replayed assistant message is never empty.
        this.sessions.completeRun(runId, outcome.text.trim() === '' ? '-' : outcome.text, this.#now())
        this.events.publish({ type: 'agent.finished', sessionId, runId, slot })
        return
      }
      const message = outcome.kind === 'timeout'
        ? `Timed out after ${Math.round(this.#tuning.runTimeoutMs / 1000)} seconds.`
        : lane.controller.signal.aborted ? 'Cancelled.' : outcome.message
      this.sessions.cancelRun(runId, message, outcome.text, this.#now())
      this.events.publish({ type: 'agent.failed', sessionId, runId, slot, message })
    } finally {
      this.#running.delete(key)
    }
  }

  private handleParserEvents(sessionId: string, slot: AgentSlot, lane: LaneRun, parserEvents: ParserEvent[]): void {
    for (const event of parserEvents) {
      if (event.type === 'question') {
        lane.suppressed = this.isDuplicate(sessionId, event.question)
      } else if (event.type === 'partial') {
        if (!lane.suppressed) {
          this.events.publish({ type: 'qa.partial', sessionId, runId: lane.runId, slot, question: event.question, answer: event.answer })
        }
      } else {
        const answer = event.answer.length > this.#tuning.answerHardLimit
          ? `${event.answer.slice(0, this.#tuning.answerHardLimit)}…`
          : event.answer
        const duplicate = lane.suppressed || this.isDuplicate(sessionId, event.question)
        lane.suppressed = false
        const qaId = this.sessions.saveQa({
          sessionId,
          runId: lane.runId,
          slot,
          question: event.question,
          answer,
          status: duplicate ? 'duplicate' : 'shown',
          nowMs: this.#now(),
        })
        if (!duplicate) {
          this.events.publish({ type: 'qa.completed', sessionId, runId: lane.runId, slot, qaId, question: event.question, answer })
        }
      }
    }
  }

  private isDuplicate(sessionId: string, question: string): boolean {
    const recent = this.sessions.recentShownQuestions(sessionId, this.#now() - this.#tuning.dedupeWindowMs)
    return isDuplicateQuestion(question, recent, this.#tuning.dedupeThreshold)
  }
}

import type { DatabaseSync } from 'node:sqlite'
import type { QaResult, TranscriptFinal } from '@listen-instant-ans/contracts'
import { historyTranscriptVersionFor, type PreparedQa, type SessionState } from '../session/session-state.js'

interface SessionRow {
  id: string
  language: string
  transcript_version: number
  handoff_version: number
  history_transcript_version_a: number
  history_transcript_version_b: number
  active_agent: 'A' | 'B' | null
  prepared_qa_for_a: string | null
  prepared_qa_for_b: string | null
  last_agent_request_at_ms: number
  consecutive_empty_qa: number
  consecutive_failures: number
  last_completed_slot: 'A' | 'B' | null
}

export interface SlotTurn {
  readonly transcripts: TranscriptFinal[]
  readonly peerQas: QaResult[]
  readonly result: QaResult
  readonly peerQaCount: number
}

export interface RunUsage {
  readonly inputTokens?: number
  readonly cachedInputTokens?: number
  readonly firstTokenMs?: number
}

function parsePreparedQa(value: string | null): PreparedQa | null {
  return value === null ? null : JSON.parse(value) as PreparedQa
}

function toState(row: SessionRow): SessionState {
  return {
    id: row.id,
    language: row.language,
    transcriptVersion: row.transcript_version,
    handoffVersion: row.handoff_version,
    historyTranscriptVersionA: row.history_transcript_version_a,
    historyTranscriptVersionB: row.history_transcript_version_b,
    activeAgent: row.active_agent,
    preparedQaForA: parsePreparedQa(row.prepared_qa_for_a),
    preparedQaForB: parsePreparedQa(row.prepared_qa_for_b),
    lastAgentRequestAtMs: row.last_agent_request_at_ms,
    consecutiveEmptyQa: row.consecutive_empty_qa,
    consecutiveFailures: row.consecutive_failures,
    lastCompletedSlot: row.last_completed_slot,
  }
}

export class SessionRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(id: string, language: string, nowMs: number): SessionState {
    this.database.prepare(`
      INSERT INTO sessions (id, language, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?)
    `).run(id, language, nowMs, nowMs)
    return this.get(id)
  }

  get(id: string): SessionState {
    const row = this.database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    if (row === undefined) {
      throw new Error(`Session not found: ${id}`)
    }
    return toState(row)
  }

  list(): Array<{ id: string; language: string; createdAtMs: number; updatedAtMs: number; transcriptVersion: number; activeAgent: 'A' | 'B' | null }> {
    return this.database.prepare(`
      SELECT id, language, created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs,
        transcript_version AS transcriptVersion, active_agent AS activeAgent
      FROM sessions ORDER BY updated_at_ms DESC, created_at_ms DESC
    `).all() as Array<{ id: string; language: string; createdAtMs: number; updatedAtMs: number; transcriptVersion: number; activeAgent: 'A' | 'B' | null }>
  }

  appendTranscript(sessionId: string, transcript: TranscriptFinal, nowMs: number): SessionState {
    this.database.prepare(`
      INSERT INTO transcripts (session_id, sequence, started_at_ms, ended_at_ms, text, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      transcript.sequence,
      transcript.startedAtMs,
      transcript.endedAtMs,
      transcript.text,
      transcript.confidence,
    )
    this.database.prepare(`
      UPDATE sessions SET transcript_version = ?, updated_at_ms = ? WHERE id = ?
    `).run(transcript.sequence, nowMs, sessionId)
    return this.get(sessionId)
  }

  listTranscriptsAfter(sessionId: string, version: number): TranscriptFinal[] {
    const rows = this.database.prepare(`
      SELECT sequence, started_at_ms, ended_at_ms, text, confidence
      FROM transcripts WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC
    `).all(sessionId, version) as Array<{
      sequence: number
      started_at_ms: number
      ended_at_ms: number
      text: string
      confidence: number | null
    }>
    return rows.map((row) => ({
      sequence: row.sequence,
      startedAtMs: row.started_at_ms,
      endedAtMs: row.ended_at_ms,
      text: row.text,
      confidence: row.confidence,
    }))
  }

  listPeerQas(sessionId: string, slot: 'A' | 'B'): QaResult[] {
    const peer = slot === 'A' ? 'B' : 'A'
    const rows = this.database.prepare(`
      SELECT qas.status, qas.question, qas.answer, qas.sources_json AS sourcesJson, qas.confidence
      FROM qas JOIN agent_runs ON agent_runs.id = qas.run_id
      WHERE agent_runs.session_id = ? AND agent_runs.slot = ? AND qas.status != 'ignore'
      ORDER BY qas.rowid ASC
    `).all(sessionId, peer) as Array<{ status: QaResult['status']; question: string | null; answer: string | null; sourcesJson: string; confidence: number }>
    return rows.map((row) => ({ ...row, sources: JSON.parse(row.sourcesJson) } as QaResult))
  }

  advanceAgentHistory(sessionId: string, slot: 'A' | 'B', version: number, nowMs: number): SessionState {
    const column = slot === 'A' ? 'history_transcript_version_a' : 'history_transcript_version_b'
    this.database.prepare(`UPDATE sessions SET ${column} = MAX(${column}, ?), updated_at_ms = ? WHERE id = ?`)
      .run(version, nowMs, sessionId)
    return this.get(sessionId)
  }

  /** Completed turns of one slot, in order, each with the exact input it was given. */
  listSlotTurns(sessionId: string, slot: 'A' | 'B'): SlotTurn[] {
    const runs = this.database.prepare(`
      SELECT agent_runs.start_version AS startVersion, agent_runs.end_version AS endVersion,
        agent_runs.peer_qa_count AS peerQaCount, qas.status, qas.question, qas.answer,
        qas.sources_json AS sourcesJson, qas.confidence
      FROM agent_runs JOIN qas ON qas.run_id = agent_runs.id
      WHERE agent_runs.session_id = ? AND agent_runs.slot = ? AND agent_runs.status = 'completed'
      ORDER BY agent_runs.started_at_ms ASC, agent_runs.rowid ASC
    `).all(sessionId, slot) as Array<{
      startVersion: number; endVersion: number; peerQaCount: number
      status: QaResult['status']; question: string | null; answer: string | null; sourcesJson: string; confidence: number
    }>
    const transcripts = this.listTranscriptsAfter(sessionId, 0)
    const peerQas = this.listPeerQas(sessionId, slot)
    let deliveredPeerQas = 0
    return runs.map((run) => {
      const turn: SlotTurn = {
        transcripts: transcripts.filter((item) => item.sequence > run.startVersion && item.sequence <= run.endVersion),
        peerQas: peerQas.slice(deliveredPeerQas, run.peerQaCount),
        result: { status: run.status, question: run.question, answer: run.answer, sources: JSON.parse(run.sourcesJson), confidence: run.confidence } as QaResult,
        peerQaCount: run.peerQaCount,
      }
      deliveredPeerQas = run.peerQaCount
      return turn
    })
  }

  recordUsage(runId: string, usage: RunUsage): void {
    this.database.prepare(`
      UPDATE agent_runs SET input_tokens = ?, cached_input_tokens = ?, first_token_ms = ? WHERE id = ?
    `).run(usage.inputTokens ?? null, usage.cachedInputTokens ?? null, usage.firstTokenMs ?? null, runId)
  }

  timeline(sessionId: string): object {
    this.get(sessionId)
    const transcripts = this.database.prepare(`
      SELECT sequence, started_at_ms AS startedAtMs, ended_at_ms AS endedAtMs, text, confidence
      FROM transcripts WHERE session_id = ? ORDER BY sequence ASC
    `).all(sessionId)
    const qas = this.database.prepare(`
      SELECT agent_runs.id AS runId, agent_runs.slot, agent_runs.status, agent_runs.started_at_ms AS startedAtMs,
        agent_runs.ended_at_ms AS endedAtMs, qas.question, qas.answer, qas.confidence
      FROM agent_runs LEFT JOIN qas ON qas.run_id = agent_runs.id
      WHERE agent_runs.session_id = ? ORDER BY agent_runs.started_at_ms ASC
    `).all(sessionId)
    return { transcripts, qas }
  }

  markRunStarted(sessionId: string, slot: 'A' | 'B', runId: string, endVersion: number, nowMs: number): SessionState {
    const state = this.get(sessionId)
    this.database.prepare(`
      INSERT INTO agent_runs (id, session_id, slot, start_version, end_version, peer_qa_count, status, started_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(runId, sessionId, slot, historyTranscriptVersionFor(state, slot), endVersion, this.listPeerQas(sessionId, slot).length, nowMs)
    this.database.prepare(`
      UPDATE sessions SET active_agent = ?, last_agent_request_at_ms = ?, updated_at_ms = ? WHERE id = ?
    `).run(slot, nowMs, nowMs, sessionId)
    return this.get(sessionId)
  }

  completeRun(
    sessionId: string,
    slot: 'A' | 'B',
    runId: string,
    result: QaResult,
    snapshotVersion: number,
    nowMs: number,
  ): SessionState {
    const nextSlot = slot === 'A' ? 'B' : 'A'
    const prepared = JSON.stringify({ runId, result })
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE agent_runs SET status = 'completed', ended_at_ms = ? WHERE id = ?
      `).run(nowMs, runId)
      this.database.prepare(`
        INSERT INTO qas (run_id, status, question, answer, sources_json, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(runId, result.status, result.question, result.answer, JSON.stringify(result.sources), result.confidence)
      if (result.status !== 'ignore') {
        const targetColumn = nextSlot === 'A' ? 'prepared_qa_for_a' : 'prepared_qa_for_b'
        this.database.prepare(`
        UPDATE sessions SET handoff_version = ?, ${targetColumn} = ?,
          active_agent = NULL, consecutive_empty_qa = 0, consecutive_failures = 0, last_completed_slot = ?, updated_at_ms = ? WHERE id = ?
        `).run(snapshotVersion, prepared, slot, nowMs, sessionId)
        this.database.prepare(`
          INSERT INTO handoffs (session_id, from_slot, to_slot, run_id, raw_qa_json, handoff_version, created_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, slot, nextSlot, runId, JSON.stringify(result), snapshotVersion, nowMs)
      } else {
        this.database.prepare(`
          UPDATE sessions SET active_agent = NULL, consecutive_empty_qa = consecutive_empty_qa + 1, consecutive_failures = 0,
          last_completed_slot = ?, updated_at_ms = ? WHERE id = ?
        `).run(slot, nowMs, sessionId)
      }
      const state = this.get(sessionId)
      this.database.exec('COMMIT')
      return state
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  failRun(sessionId: string, runId: string, message: string, nowMs: number): SessionState {
    this.database.prepare(`
      UPDATE agent_runs SET status = 'failed', ended_at_ms = ?, error_message = ? WHERE id = ?
    `).run(nowMs, message, runId)
    this.database.prepare(`
      UPDATE sessions SET active_agent = NULL, updated_at_ms = ? WHERE id = ?
    `).run(nowMs, sessionId)
    return this.get(sessionId)
  }

  skipRun(
    sessionId: string,
    slot: 'A' | 'B',
    runId: string,
    nowMs: number,
    message = 'Timed out; skipped.',
  ): SessionState {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`UPDATE agent_runs SET status = 'cancelled', ended_at_ms = ?, error_message = ? WHERE id = ?`)
        .run(nowMs, message, runId)
      this.database.prepare(`
        UPDATE sessions SET active_agent = NULL, consecutive_failures = consecutive_failures + 1,
          last_completed_slot = ?, updated_at_ms = ? WHERE id = ?
      `).run(slot, nowMs, sessionId)
      const state = this.get(sessionId)
      this.database.exec('COMMIT')
      return state
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

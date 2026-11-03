import type { DatabaseSync } from 'node:sqlite'
import type { AgentSlot, QaStatus, TranscriptFinal } from '@listen-instant-ans/contracts'

export interface SessionInfo {
  readonly id: string
  readonly language: string
  readonly createdAtMs: number
  readonly updatedAtMs: number
  readonly transcriptVersion: number
}

export interface StoredQa {
  readonly id: number
  readonly runId: string
  readonly slot: AgentSlot
  readonly question: string
  readonly answer: string
  readonly status: QaStatus
  readonly createdAtMs: number
}

/** A finished request of one lane, exactly as it was sent and answered. */
export interface LaneTurn {
  readonly inputText: string
  readonly outputText: string
  readonly endVersion: number
  readonly peerCursor: number
}

export interface StartRunInput {
  readonly sessionId: string
  readonly slot: AgentSlot
  readonly runId: string
  readonly startVersion: number
  readonly endVersion: number
  readonly inputText: string
  readonly peerCursor: number
  readonly nowMs: number
}

export interface SaveQaInput {
  readonly sessionId: string
  readonly runId: string
  readonly slot: AgentSlot
  readonly question: string
  readonly answer: string
  readonly status: QaStatus
  readonly nowMs: number
}

export interface RunSummary {
  readonly id: string
  readonly slot: AgentSlot
  readonly status: 'running' | 'completed' | 'cancelled'
  readonly startVersion: number
  readonly endVersion: number
  readonly outputText: string | null
  readonly startedAtMs: number
  readonly endedAtMs: number | null
  readonly errorMessage: string | null
  readonly inputTokens: number | null
  readonly cachedInputTokens: number | null
  readonly firstTokenMs: number | null
}

export interface RunUsage {
  readonly inputTokens?: number
  readonly cachedInputTokens?: number
  readonly firstTokenMs?: number
}

interface SessionRow {
  id: string
  language: string
  created_at_ms: number
  updated_at_ms: number
  transcript_version: number
}

const SESSION_SELECT = `
  SELECT s.id, s.language, s.created_at_ms, s.updated_at_ms,
    COALESCE((SELECT MAX(sequence) FROM transcripts t WHERE t.session_id = s.id), 0) AS transcript_version
  FROM sessions s
`

function toInfo(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    language: row.language,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    transcriptVersion: row.transcript_version,
  }
}

export class SessionRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(id: string, language: string, nowMs: number): SessionInfo {
    this.database.prepare(`
      INSERT INTO sessions (id, language, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)
    `).run(id, language, nowMs, nowMs)
    return this.get(id)
  }

  get(id: string): SessionInfo {
    const row = this.database.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined
    if (row === undefined) {
      throw new Error(`Session not found: ${id}`)
    }
    return toInfo(row)
  }

  list(): SessionInfo[] {
    const rows = this.database.prepare(`${SESSION_SELECT} ORDER BY s.updated_at_ms DESC, s.created_at_ms DESC`).all() as unknown as SessionRow[]
    return rows.map(toInfo)
  }

  /** The repository assigns the sequence, so a restarted voice session can never collide. */
  appendTranscript(sessionId: string, input: Omit<TranscriptFinal, 'sequence'>, nowMs: number): TranscriptFinal {
    const text = input.text.trim()
    if (text === '') {
      throw new Error('Transcript text must not be empty.')
    }
    this.get(sessionId)
    return this.transaction(() => {
      const row = this.database.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM transcripts WHERE session_id = ?')
        .get(sessionId) as { next: number }
      this.database.prepare(`
        INSERT INTO transcripts (session_id, sequence, started_at_ms, ended_at_ms, text, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(sessionId, row.next, input.startedAtMs, input.endedAtMs, text, input.confidence)
      this.database.prepare('UPDATE sessions SET updated_at_ms = ? WHERE id = ?').run(nowMs, sessionId)
      return { sequence: row.next, startedAtMs: input.startedAtMs, endedAtMs: input.endedAtMs, text, confidence: input.confidence }
    })
  }

  transcripts(sessionId: string, afterSequence = 0): TranscriptFinal[] {
    const rows = this.database.prepare(`
      SELECT sequence, started_at_ms, ended_at_ms, text, confidence
      FROM transcripts WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC
    `).all(sessionId, afterSequence) as unknown as Array<{
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

  /** Completed requests of one lane, oldest first. Only these are replayed to the model. */
  laneTurns(sessionId: string, slot: AgentSlot): LaneTurn[] {
    const rows = this.database.prepare(`
      SELECT input_text, output_text, end_version, peer_cursor FROM agent_runs
      WHERE session_id = ? AND slot = ? AND status = 'completed' ORDER BY rowid ASC
    `).all(sessionId, slot) as unknown as Array<{ input_text: string; output_text: string; end_version: number; peer_cursor: number }>
    return rows.map((row) => ({
      inputText: row.input_text,
      outputText: row.output_text,
      endVersion: row.end_version,
      peerCursor: row.peer_cursor,
    }))
  }

  startRun(input: StartRunInput): void {
    this.database.prepare(`
      INSERT INTO agent_runs (id, session_id, slot, status, start_version, end_version, input_text, peer_cursor, started_at_ms)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)
    `).run(input.runId, input.sessionId, input.slot, input.startVersion, input.endVersion, input.inputText, input.peerCursor, input.nowMs)
    this.database.prepare('UPDATE sessions SET updated_at_ms = ? WHERE id = ?').run(input.nowMs, input.sessionId)
  }

  completeRun(runId: string, outputText: string, nowMs: number): void {
    this.database.prepare(`
      UPDATE agent_runs SET status = 'completed', output_text = ?, ended_at_ms = ? WHERE id = ?
    `).run(outputText, nowMs, runId)
  }

  cancelRun(runId: string, message: string, outputText: string, nowMs: number): void {
    this.database.prepare(`
      UPDATE agent_runs SET status = 'cancelled', error_message = ?, output_text = ?, ended_at_ms = ? WHERE id = ?
    `).run(message, outputText, nowMs, runId)
  }

  recordUsage(runId: string, usage: RunUsage): void {
    this.database.prepare(`
      UPDATE agent_runs SET input_tokens = ?, cached_input_tokens = ?, first_token_ms = ? WHERE id = ?
    `).run(usage.inputTokens ?? null, usage.cachedInputTokens ?? null, usage.firstTokenMs ?? null, runId)
  }

  /** Marks requests left running by a crashed process as cancelled. */
  cancelInterruptedRuns(nowMs: number): number {
    const result = this.database.prepare(`
      UPDATE agent_runs SET status = 'cancelled', error_message = 'Interrupted by restart.', ended_at_ms = ?
      WHERE status = 'running'
    `).run(nowMs)
    return Number(result.changes)
  }

  saveQa(input: SaveQaInput): number {
    const result = this.database.prepare(`
      INSERT INTO qas (session_id, run_id, slot, question, answer, status, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.sessionId, input.runId, input.slot, input.question, input.answer, input.status, input.nowMs)
    return Number(result.lastInsertRowid)
  }

  recentShownQuestions(sessionId: string, sinceMs: number): string[] {
    const rows = this.database.prepare(`
      SELECT question FROM qas WHERE session_id = ? AND status = 'shown' AND created_at_ms >= ? ORDER BY id ASC
    `).all(sessionId, sinceMs) as unknown as Array<{ question: string }>
    return rows.map((row) => row.question)
  }

  /** Shown QAs written by the other lane after the given cursor. */
  peerQasAfter(sessionId: string, slot: AgentSlot, cursor: number): StoredQa[] {
    return this.queryQas(`
      SELECT id, run_id, slot, question, answer, status, created_at_ms FROM qas
      WHERE session_id = ? AND slot != ? AND status = 'shown' AND id > ? ORDER BY id ASC
    `, sessionId, slot, cursor)
  }

  allQas(sessionId: string): StoredQa[] {
    return this.queryQas(`
      SELECT id, run_id, slot, question, answer, status, created_at_ms FROM qas WHERE session_id = ? ORDER BY id ASC
    `, sessionId)
  }

  listRuns(sessionId: string): RunSummary[] {
    const rows = this.database.prepare(`
      SELECT id, slot, status, start_version, end_version, output_text, started_at_ms, ended_at_ms,
        error_message, input_tokens, cached_input_tokens, first_token_ms
      FROM agent_runs WHERE session_id = ? ORDER BY rowid ASC
    `).all(sessionId) as unknown as Array<{
      id: string; slot: AgentSlot; status: RunSummary['status']; start_version: number; end_version: number
      output_text: string | null; started_at_ms: number; ended_at_ms: number | null; error_message: string | null
      input_tokens: number | null; cached_input_tokens: number | null; first_token_ms: number | null
    }>
    return rows.map((row) => ({
      id: row.id,
      slot: row.slot,
      status: row.status,
      startVersion: row.start_version,
      endVersion: row.end_version,
      outputText: row.output_text,
      startedAtMs: row.started_at_ms,
      endedAtMs: row.ended_at_ms,
      errorMessage: row.error_message,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      firstTokenMs: row.first_token_ms,
    }))
  }

  timeline(sessionId: string): { transcripts: TranscriptFinal[]; qas: StoredQa[]; runs: RunSummary[] } {
    this.get(sessionId)
    return { transcripts: this.transcripts(sessionId), qas: this.allQas(sessionId), runs: this.listRuns(sessionId) }
  }

  private queryQas(sql: string, ...parameters: Array<string | number>): StoredQa[] {
    const rows = this.database.prepare(sql).all(...parameters) as unknown as Array<{
      id: number
      run_id: string
      slot: AgentSlot
      question: string
      answer: string
      status: QaStatus
      created_at_ms: number
    }>
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      slot: row.slot,
      question: row.question,
      answer: row.answer,
      status: row.status,
      createdAtMs: row.created_at_ms,
    }))
  }

  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

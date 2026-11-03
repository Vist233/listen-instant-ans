import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const database = new DatabaseSync(path)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      transcript_version INTEGER NOT NULL DEFAULT 0,
      handoff_version INTEGER NOT NULL DEFAULT 0,
      active_agent TEXT,
      prepared_qa_for_a TEXT,
      prepared_qa_for_b TEXT,
      last_agent_request_at_ms INTEGER NOT NULL DEFAULT 0,
      consecutive_empty_qa INTEGER NOT NULL DEFAULT 0,
      last_completed_slot TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transcripts (
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      confidence REAL,
      PRIMARY KEY (session_id, sequence),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      start_version INTEGER NOT NULL,
      end_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      error_message TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS qas (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      question TEXT,
      answer TEXT,
      sources_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    );
    CREATE TABLE IF NOT EXISTS handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      from_slot TEXT NOT NULL,
      to_slot TEXT NOT NULL,
      run_id TEXT NOT NULL,
      raw_qa_json TEXT NOT NULL,
      handoff_version INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    );
    CREATE TABLE IF NOT EXISTS context_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      end_version INTEGER NOT NULL,
      summary TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `)
  const columns = database.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  if (!names.has('history_transcript_version_a')) database.exec('ALTER TABLE sessions ADD COLUMN history_transcript_version_a INTEGER NOT NULL DEFAULT 0')
  if (!names.has('history_transcript_version_b')) database.exec('ALTER TABLE sessions ADD COLUMN history_transcript_version_b INTEGER NOT NULL DEFAULT 0')
  return database
}

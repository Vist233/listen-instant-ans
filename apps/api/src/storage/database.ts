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
      status TEXT NOT NULL,
      start_version INTEGER NOT NULL,
      end_version INTEGER NOT NULL,
      input_text TEXT NOT NULL,
      output_text TEXT,
      peer_cursor INTEGER NOT NULL DEFAULT 0,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      error_message TEXT,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      first_token_ms INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS agent_runs_by_lane ON agent_runs(session_id, slot, status);
    CREATE TABLE IF NOT EXISTS qas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    );
    CREATE INDEX IF NOT EXISTS qas_by_session ON qas(session_id, status, id);
  `)
  return database
}

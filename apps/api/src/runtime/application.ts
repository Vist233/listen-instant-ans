import type { DatabaseSync } from 'node:sqlite'
import type { QaRunner } from '../agent/qa-runner.js'
import { EventHub } from '../events/event-hub.js'
import { SessionController } from '../session/session-controller.js'
import { openDatabase } from '../storage/database.js'
import { SessionRepository } from '../storage/session-repository.js'

export interface Application {
  readonly database: DatabaseSync
  readonly events: EventHub
  readonly sessions: SessionRepository
  readonly controller: SessionController
}

export function createApplication(databasePath: string, runner: QaRunner, runTimeoutMs?: number): Application {
  const database = openDatabase(databasePath)
  const events = new EventHub()
  const sessions = new SessionRepository(database)
  const controller = new SessionController(sessions, runner, events, Date.now, runTimeoutMs)
  return { database, events, sessions, controller }
}

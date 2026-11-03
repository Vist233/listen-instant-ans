import { MastraQaRunner } from './agent/mastra-qa-runner.js'
import { UnconfiguredQaRunner, type QaRunner } from './agent/qa-runner.js'
import { loadConfig, type AppConfig } from './config/env.js'
import { EventHub } from './events/event-hub.js'
import { SessionRuntimeManager, type VoiceSessionFactory } from './runtime/session-runtime-manager.js'
import { VoiceSession } from './runtime/voice-session.js'
import { SessionController, type ControllerOptions } from './session/session-controller.js'
import { openDatabase } from './storage/database.js'
import { SessionRepository } from './storage/session-repository.js'
import { AliyunRealtimeTranscriber } from './voice/aliyun-realtime-transcriber.js'
import { FfmpegMicrophone } from './voice/ffmpeg-microphone.js'

export interface Application {
  readonly config: AppConfig
  readonly events: EventHub
  readonly sessions: SessionRepository
  readonly controller: SessionController
  readonly runtime: SessionRuntimeManager
}

/** Replacements for the parts that need the network or hardware, used by tests. */
export interface ApplicationOverrides {
  readonly runner?: QaRunner
  readonly voiceSessionFactory?: VoiceSessionFactory
  readonly databasePath?: string
  readonly controller?: ControllerOptions
}

/** The single place where the application is assembled. The server and the CLI both use it. */
export function createApplication(config: AppConfig = loadConfig(), overrides: ApplicationOverrides = {}): Application {
  const database = openDatabase(overrides.databasePath ?? config.databasePath)
  const events = new EventHub()
  const sessions = new SessionRepository(database)
  sessions.cancelInterruptedRuns(Date.now())
  const runner = overrides.runner ?? (config.mimo.apiKey === undefined
    ? new UnconfiguredQaRunner()
    : new MastraQaRunner(config.mimo))
  const controller = new SessionController(sessions, runner, events, overrides.controller)
  const runtime: SessionRuntimeManager = new SessionRuntimeManager(
    overrides.voiceSessionFactory ?? ((sessionId, microphoneDevice) => {
      if (config.aliyun.appKey === undefined || config.aliyun.token === undefined) {
        throw new Error('ALIYUN_APP_ID and ALIYUN_TMP_TOKEN are required before listening can start.')
      }
      return new VoiceSession(
        sessionId,
        controller,
        new FfmpegMicrophone(),
        new AliyunRealtimeTranscriber({
          appKey: config.aliyun.appKey,
          token: config.aliyun.token,
          endpoint: config.aliyun.endpoint,
        }),
        microphoneDevice,
        (error) => {
          events.publish({ type: 'listening.failed', sessionId, message: error.message })
          void runtime.stop(sessionId)
        },
      )
    }),
    events,
  )
  return { config, events, sessions, controller, runtime }
}

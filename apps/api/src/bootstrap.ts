import { ReloadableQaRunner } from './agent/configured-runner.js'
import type { QaRunner } from './agent/qa-runner.js'
import { defaultSettingsPath, SettingsError, SettingsStore } from './config/settings-store.js'
import { EventHub } from './events/event-hub.js'
import { SessionRuntimeManager, type VoiceSessionFactory } from './runtime/session-runtime-manager.js'
import { VoiceSession } from './runtime/voice-session.js'
import { SessionController, type ControllerOptions } from './session/session-controller.js'
import { openDatabase } from './storage/database.js'
import { SessionRepository } from './storage/session-repository.js'
import { AliyunRealtimeTranscriber } from './voice/aliyun-realtime-transcriber.js'
import { FfmpegMicrophone, listMicrophones, type MicrophoneList } from './voice/ffmpeg-microphone.js'

export interface Application {
  readonly settings: SettingsStore
  readonly events: EventHub
  readonly sessions: SessionRepository
  readonly controller: SessionController
  readonly runtime: SessionRuntimeManager
  readonly microphones: () => Promise<MicrophoneList>
}

/** Replacements for the parts that need the network or hardware, used by tests. */
export interface ApplicationOverrides {
  readonly env?: NodeJS.ProcessEnv
  /** A file path, or null to keep settings in memory. */
  readonly settingsPath?: string | null
  readonly databasePath?: string
  readonly runner?: QaRunner
  readonly voiceSessionFactory?: VoiceSessionFactory
  readonly microphones?: () => Promise<MicrophoneList>
  readonly controller?: ControllerOptions
}

/** The single place where the application is assembled. The server and the CLI both use it. */
export function createApplication(overrides: ApplicationOverrides = {}): Application {
  const env = overrides.env ?? process.env
  const settings = new SettingsStore(overrides.settingsPath === undefined ? defaultSettingsPath(env) : overrides.settingsPath, env)
  const database = openDatabase(overrides.databasePath ?? settings.current().databasePath)
  const events = new EventHub()
  const sessions = new SessionRepository(database)
  sessions.cancelInterruptedRuns(Date.now())
  const runner = overrides.runner ?? new ReloadableQaRunner(() => settings.current().mimo)
  const controller = new SessionController(sessions, runner, events, overrides.controller)
  const runtime: SessionRuntimeManager = new SessionRuntimeManager(
    overrides.voiceSessionFactory ?? ((sessionId, microphoneDevice) => {
      const { aliyun } = settings.current()
      if (aliyun.appKey === undefined || aliyun.token === undefined) {
        throw new SettingsError('阿里云 AppKey 和 Token 未设置，请在“设置”里填写。')
      }
      return new VoiceSession(
        sessionId,
        controller,
        new FfmpegMicrophone(),
        new AliyunRealtimeTranscriber({ appKey: aliyun.appKey, token: aliyun.token, endpoint: aliyun.endpoint }),
        microphoneDevice,
        (error) => {
          events.publish({ type: 'listening.failed', sessionId, message: error.message })
          void runtime.stop(sessionId)
        },
      )
    }),
    events,
  )
  return { settings, events, sessions, controller, runtime, microphones: overrides.microphones ?? listMicrophones }
}

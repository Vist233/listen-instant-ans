import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { loadConfig } from './config/env.js'
import { createConfiguredRunner } from './runtime/configured-runner.js'
import { createApplication } from './runtime/application.js'
import { VoiceSession } from './runtime/voice-session.js'
import { AliyunRealtimeTranscriber } from './voice/aliyun-realtime-transcriber.js'
import { FfmpegMicrophone } from './voice/ffmpeg-microphone.js'

const config = loadConfig()
if (config.aliyun.appKey === undefined || config.aliyun.token === undefined) {
  throw new Error('ALIYUN_APP_ID and ALIYUN_TMP_TOKEN are required. Source ~/.zshrc before starting the CLI.')
}
const application = createApplication(config.databasePath, createConfiguredRunner(config))
const sessionId = randomUUID()
application.controller.start(sessionId, 'zh-CN')
application.events.subscribe((event) => {
  if (event.sessionId === sessionId && event.type === 'qa.completed') {
    console.log(`\nQ: ${event.result.question}\nA: ${event.result.answer}\n`)
  }
  if (event.sessionId === sessionId && event.type === 'agent.failed') console.error(`Agent failed: ${event.message}`)
})

const microphone = new FfmpegMicrophone()
const transcriber = new AliyunRealtimeTranscriber({
  appKey: config.aliyun.appKey,
  token: config.aliyun.token,
  endpoint: config.aliyun.endpoint,
})
const session = new VoiceSession(
  sessionId,
  application.controller,
  microphone,
  transcriber,
  process.env.LISTEN_INSTANT_ANS_AUDIO_DEVICE ?? '0',
)
await session.start()
console.log('Listening. Press Enter or Ctrl+C to stop.')
const readline = createInterface({ input: process.stdin, output: process.stdout })
await new Promise<void>((resolve) => {
  readline.once('line', resolve)
  process.once('SIGINT', resolve)
})
readline.close()
await session.stop()

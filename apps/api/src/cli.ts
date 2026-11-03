import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { createApplication } from './bootstrap.js'

const app = createApplication()
const sessionId = randomUUID()
app.controller.start(sessionId, 'zh-CN')
app.events.subscribe((event) => {
  if (event.sessionId !== sessionId) return
  if (event.type === 'qa.completed') console.log(`\nQ: ${event.question}\nA: ${event.answer}\n`)
  if (event.type === 'agent.failed') console.error(`Agent ${event.slot} skipped: ${event.message}`)
  if (event.type === 'listening.failed') console.error(`Listening failed: ${event.message}`)
})

await app.runtime.start(sessionId, process.env.LISTEN_INSTANT_ANS_AUDIO_DEVICE ?? '0')
console.log('Listening. Press Enter or Ctrl+C to stop.')
const readline = createInterface({ input: process.stdin, output: process.stdout })
await new Promise<void>((resolve) => {
  readline.once('line', resolve)
  process.once('SIGINT', resolve)
})
readline.close()
await app.runtime.stop(sessionId)

import { EventEmitter } from 'node:events'

export const AUDIO_IDLE_TIMEOUT_MS = 15_000

/**
 * A microphone that lives in the browser: the page captures the audio and
 * pushes it here. If nothing arrives for a while (the tab was closed, the
 * device was unplugged) it reports an error so listening does not hang forever.
 */
export class PushMicrophone {
  readonly #events = new EventEmitter()
  #timer: NodeJS.Timeout | undefined
  #running = false

  constructor(private readonly idleTimeoutMs: number = AUDIO_IDLE_TIMEOUT_MS) {}

  start(): void {
    this.#running = true
    this.arm()
  }

  stop(): void {
    this.#running = false
    clearTimeout(this.#timer)
  }

  push(chunk: Uint8Array): void {
    if (!this.#running) throw new Error('Not listening.')
    this.arm()
    this.#events.emit('audio', chunk)
  }

  onAudio(listener: (audio: Uint8Array) => void): () => void {
    this.#events.on('audio', listener)
    return () => this.#events.off('audio', listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.#events.on('error', listener)
    return () => this.#events.off('error', listener)
  }

  private arm(): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      if (!this.#running) return
      this.#running = false
      this.#events.emit('error', new Error('没有收到麦克风的声音。录音页面是不是被关闭了，或者麦克风被拔掉了？'))
    }, this.idleTimeoutMs)
    this.#timer.unref()
  }
}

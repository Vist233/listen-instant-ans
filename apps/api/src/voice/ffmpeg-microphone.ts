import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface MicrophoneConfig {
  readonly device: string
  readonly sampleRateHz: 8_000 | 16_000
}

/** macOS AVFoundation microphone capture, normalized as 16-bit mono PCM. */
export class FfmpegMicrophone {
  readonly #events = new EventEmitter()
  #process: ChildProcessWithoutNullStreams | null = null

  start(config: MicrophoneConfig): void {
    if (this.#process !== null) throw new Error('Microphone capture is already running')
    const process = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'warning',
      '-f', 'avfoundation', '-i', `:${config.device}`,
      '-ac', '1', '-ar', String(config.sampleRateHz),
      '-f', 's16le', 'pipe:1',
    ])
    this.#process = process
    process.stdout.on('data', (chunk: Buffer) => this.#events.emit('audio', new Uint8Array(chunk)))
    process.stderr.on('data', (chunk: Buffer) => this.#events.emit('diagnostic', chunk.toString()))
    process.once('error', (error) => this.#events.emit('error', error))
    process.once('exit', (code, signal) => {
      this.#process = null
      if (code !== 0 && signal !== 'SIGTERM') {
        this.#events.emit('error', new Error(`ffmpeg microphone capture stopped (code=${code}, signal=${signal})`))
      }
    })
  }

  stop(): void {
    this.#process?.kill('SIGTERM')
  }

  onAudio(listener: (audio: Uint8Array) => void): () => void {
    this.#events.on('audio', listener)
    return () => this.#events.off('audio', listener)
  }

  onDiagnostic(listener: (text: string) => void): () => void {
    this.#events.on('diagnostic', listener)
    return () => this.#events.off('diagnostic', listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.#events.on('error', listener)
    return () => this.#events.off('error', listener)
  }
}

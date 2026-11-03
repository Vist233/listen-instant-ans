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

export interface MicrophoneDevice {
  readonly id: string
  readonly name: string
}

export interface MicrophoneList {
  readonly devices: MicrophoneDevice[]
  readonly error?: string
}

/** Reads the audio device section of `ffmpeg -f avfoundation -list_devices true -i ""`. */
export function parseAvfoundationAudioDevices(output: string): MicrophoneDevice[] {
  const devices: MicrophoneDevice[] = []
  let inAudioSection = false
  for (const line of output.split('\n')) {
    if (line.includes('AVFoundation audio devices')) {
      inAudioSection = true
      continue
    }
    if (line.includes('AVFoundation video devices')) {
      inAudioSection = false
      continue
    }
    const match = /\]\s*\[(\d+)\]\s+(.+?)\s*$/.exec(line)
    if (inAudioSection && match !== null) devices.push({ id: match[1], name: match[2] })
  }
  return devices
}

export function listMicrophones(): Promise<MicrophoneList> {
  if (process.platform !== 'darwin') {
    return Promise.resolve({ devices: [], error: '目前只支持 macOS 的麦克风。' })
  }
  return new Promise((resolve) => {
    let output = ''
    const child = spawn('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''])
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ devices: [], error: '没有找到 ffmpeg，请先安装：brew install ffmpeg' })
    })
    child.once('close', () => {
      clearTimeout(timer)
      const devices = parseAvfoundationAudioDevices(output)
      resolve(devices.length > 0 ? { devices } : { devices, error: '没有找到可用的麦克风。' })
    })
  })
}

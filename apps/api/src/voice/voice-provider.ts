import type { TranscriptFinal } from '@listen-instant-ans/contracts'

export interface VoiceSessionConfig {
  readonly language: string
  readonly sampleRateHz: 8_000 | 16_000
  readonly endpointingMs: number
}

export type VoiceListener<T> = (event: T) => void

export interface VoiceProvider {
  open(config: VoiceSessionConfig): Promise<void>
  sendAudio(chunk: Uint8Array): void
  finalize(): Promise<void>
  close(): Promise<void>
  onPartial(listener: VoiceListener<string>): () => void
  onFinal(listener: VoiceListener<Omit<TranscriptFinal, 'sequence'>>): () => void
  onError(listener: VoiceListener<Error>): () => void
}

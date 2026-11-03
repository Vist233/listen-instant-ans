import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error plain JavaScript shared with the browser
import { CHUNK_SAMPLES, createDownsampler } from '../../web/pcm.js'

type Chunk = { pcm: Int16Array; level: number }

const sine = (rate: number, hz: number, seconds: number, amplitude = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate))

const samples = (chunks: Chunk[]): number[] => chunks.flatMap((chunk) => [...chunk.pcm])

test('48 kHz input gives 100 ms chunks of 1600 samples at 16 kHz', () => {
  const chunks: Chunk[] = createDownsampler(48_000).push(sine(48_000, 440, 1))
  assert.equal(chunks.length, 10)
  assert.ok(chunks.every((chunk) => chunk.pcm.length === CHUNK_SAMPLES && chunk.pcm instanceof Int16Array))
})

test('44.1 kHz input also yields the right amount of audio', () => {
  const chunks: Chunk[] = createDownsampler(44_100).push(sine(44_100, 440, 2))
  assert.ok(Math.abs(chunks.length - 20) <= 1, `got ${chunks.length} chunks`)
})

test('a 16 kHz input passes through at the same rate', () => {
  const input = sine(16_000, 300, 0.1)
  const [chunk]: Chunk[] = createDownsampler(16_000).push(input)
  assert.equal(chunk.pcm.length, 1600)
  assert.ok(Math.abs(chunk.pcm[10] - Math.round(input[10] * 0x7fff)) <= 1)
})

test('the pitch is preserved: a 440 Hz tone still crosses zero 880 times per second', () => {
  const output = samples(createDownsampler(48_000).push(sine(48_000, 440, 1)))
  let crossings = 0
  for (let i = 1; i < output.length; i++) if ((output[i - 1] < 0) !== (output[i] < 0)) crossings++
  assert.ok(Math.abs(crossings - 880) <= 4, `crossings ${crossings}`)
})

test('splitting the input into small blocks gives exactly the same output', () => {
  const input = sine(48_000, 440, 1)
  const whole = samples(createDownsampler(48_000).push(input))
  const pieces = createDownsampler(48_000)
  const parts: Chunk[] = []
  for (let offset = 0; offset < input.length; offset += 128) parts.push(...pieces.push(input.subarray(offset, offset + 128)))
  assert.deepEqual(samples(parts), whole)
})

test('the level is the loudness of the audio, and zero for silence', () => {
  const [loud]: Chunk[] = createDownsampler(48_000).push(sine(48_000, 440, 0.1, 0.5))
  assert.ok(Math.abs(loud.level - 0.5 / Math.SQRT2) < 0.01, `level ${loud.level}`)
  const [quiet]: Chunk[] = createDownsampler(48_000).push(new Float32Array(4800))
  assert.equal(quiet.level, 0)
  assert.ok(quiet.pcm.every((value) => value === 0))
})

test('values beyond full scale are clamped instead of wrapping around', () => {
  const [chunk]: Chunk[] = createDownsampler(16_000).push(Float32Array.from({ length: 1600 }, (_, i) => (i % 2 === 0 ? 3 : -3)))
  assert.equal(Math.max(...chunk.pcm), 0x7fff)
  assert.equal(Math.min(...chunk.pcm), -0x8000)
})

test('less than one chunk of input produces nothing yet', () => {
  assert.deepEqual(createDownsampler(48_000).push(sine(48_000, 440, 0.05)), [])
})

/**
 * Turns browser audio (floats at the device's own rate) into 16 kHz, 16-bit,
 * mono PCM chunks, which is what the speech service wants. Plain JavaScript
 * with no browser APIs, so it runs in the audio worklet and in the tests.
 */
export const OUTPUT_RATE = 16_000
export const CHUNK_SAMPLES = 1_600 // 100 ms

/** @returns {{ push(input: Float32Array): Array<{ pcm: Int16Array, level: number }> }} */
export function createDownsampler(inputRate, outputRate = OUTPUT_RATE, chunkSamples = CHUNK_SAMPLES) {
  const ratio = inputRate / outputRate
  let inputIndex = 0
  let nextEmitAt = ratio
  let sum = 0
  let count = 0
  let squares = 0
  let squareCount = 0
  let out = new Int16Array(chunkSamples)
  let outLength = 0

  return {
    push(input) {
      const chunks = []
      for (let index = 0; index < input.length; index++) {
        const sample = input[index]
        sum += sample
        count++
        squares += sample * sample
        squareCount++
        inputIndex++
        if (inputIndex < nextEmitAt) continue
        // Averaging the samples that fall into one output sample is a cheap low-pass filter.
        const value = Math.max(-1, Math.min(1, sum / count))
        out[outLength++] = value < 0 ? value * 0x8000 : value * 0x7fff
        sum = 0
        count = 0
        nextEmitAt += ratio
        if (outLength === chunkSamples) {
          chunks.push({ pcm: out, level: Math.sqrt(squares / squareCount) })
          out = new Int16Array(chunkSamples)
          outLength = 0
          squares = 0
          squareCount = 0
        }
      }
      return chunks
    },
  }
}

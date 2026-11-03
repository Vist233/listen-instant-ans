import { createDownsampler } from './pcm.js'

// `sampleRate` is a global inside an audio worklet: the rate of the audio context.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.downsampler = createDownsampler(sampleRate)
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel !== undefined) {
      for (const chunk of this.downsampler.push(channel)) {
        this.port.postMessage(chunk, [chunk.pcm.buffer])
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)

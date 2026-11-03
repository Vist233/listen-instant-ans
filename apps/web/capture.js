/** Microphone access in the browser: device names, permission, and a stream of 16 kHz PCM chunks. */

function explain(error) {
  if (error?.name === 'NotAllowedError') return '没有麦克风权限。请在系统设置的“隐私与安全性 → 麦克风”里允许本应用或浏览器，然后点“重新检测”。'
  if (error?.name === 'NotFoundError') return '没有找到麦克风。'
  if (error?.name === 'NotReadableError') return '麦克风被别的程序占用了。'
  return error?.message ?? '无法使用麦克风。'
}

/** Asks for permission once (device names stay hidden until it is granted), then lists the inputs. */
export async function listInputDevices() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { devices: [], error: '这个浏览器不能使用麦克风。' }
  }
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
    probe.getTracks().forEach((track) => track.stop())
  } catch (error) {
    return { devices: [], error: explain(error) }
  }
  const all = await navigator.mediaDevices.enumerateDevices()
  const devices = all
    .filter((device) => device.kind === 'audioinput' && device.deviceId !== 'communications')
    .map((device) => ({ id: device.deviceId, name: device.label || '麦克风' }))
  return devices.length > 0 ? { devices } : { devices, error: '没有找到麦克风。' }
}

/**
 * Starts capturing. `onChunk(arrayBuffer)` gets 100 ms of 16 kHz mono 16-bit PCM,
 * `onLevel(rms)` the loudness of the same 100 ms (0 means digital silence).
 */
export async function startCapture({ deviceId, onChunk, onLevel }) {
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1 },
    })
  } catch (error) {
    throw new Error(explain(error))
  }
  const context = new AudioContext()
  await context.audioWorklet.addModule('/pcm-worklet.js')
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1 })
  node.port.onmessage = (event) => {
    onLevel?.(event.data.level)
    onChunk(event.data.pcm.buffer)
  }
  // A worklet only runs while it is connected to the output, so route it there silently.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute)
  mute.connect(context.destination)
  return {
    async stop() {
      node.port.onmessage = null
      stream.getTracks().forEach((track) => track.stop())
      source.disconnect()
      node.disconnect()
      await context.close()
    },
  }
}

import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { PushMicrophone } from '../src/voice/push-microphone.js'

test('pushed audio is passed on in order', () => {
  const microphone = new PushMicrophone(1000)
  const heard: number[][] = []
  microphone.onAudio((chunk) => heard.push([...chunk]))
  microphone.start()
  microphone.push(new Uint8Array([1, 2]))
  microphone.push(new Uint8Array([3]))
  microphone.stop()
  assert.deepEqual(heard, [[1, 2], [3]])
})

test('audio is refused before start and after stop', () => {
  const microphone = new PushMicrophone(1000)
  assert.throws(() => microphone.push(new Uint8Array([1])), /Not listening/)
  microphone.start()
  microphone.stop()
  assert.throws(() => microphone.push(new Uint8Array([1])), /Not listening/)
})

test('silence for too long is reported once as an error', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const microphone = new PushMicrophone(15_000)
    const errors: Error[] = []
    microphone.onError((error) => errors.push(error))
    microphone.start()
    mock.timers.tick(14_999)
    assert.equal(errors.length, 0)
    mock.timers.tick(2)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /没有收到麦克风的声音/)
    mock.timers.tick(60_000)
    assert.equal(errors.length, 1)
    assert.throws(() => microphone.push(new Uint8Array([1])))
  } finally {
    mock.timers.reset()
  }
})

test('every chunk restarts the silence countdown', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const microphone = new PushMicrophone(1_000)
    const errors: Error[] = []
    microphone.onError((error) => errors.push(error))
    microphone.start()
    for (let i = 0; i < 10; i++) {
      mock.timers.tick(900)
      microphone.push(new Uint8Array([i]))
    }
    assert.equal(errors.length, 0)
    mock.timers.tick(1_001)
    assert.equal(errors.length, 1)
  } finally {
    mock.timers.reset()
  }
})

test('stopping cancels the countdown', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const microphone = new PushMicrophone(1_000)
    const errors: Error[] = []
    microphone.onError((error) => errors.push(error))
    microphone.start()
    microphone.stop()
    mock.timers.tick(10_000)
    assert.equal(errors.length, 0)
  } finally {
    mock.timers.reset()
  }
})

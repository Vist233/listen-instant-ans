import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAvfoundationAudioDevices } from '../src/voice/ffmpeg-microphone.js'

const sample = `[AVFoundation indev @ 0x77e8c18140] AVFoundation video devices:
[AVFoundation indev @ 0x77e8c18140] [0] FaceTime HD Camera
[AVFoundation indev @ 0x77e8c18140] [1] Sakura Camera
[AVFoundation indev @ 0x77e8c18140] [2] Capture screen 0
[AVFoundation indev @ 0x77e8c18140] AVFoundation audio devices:
[AVFoundation indev @ 0x77e8c18140] [0] MacBook Air Microphone
[AVFoundation indev @ 0x77e8c18140] [1] Sakura Microphone
: Input/output error`

test('only the audio devices are listed, with their ids and names', () => {
  assert.deepEqual(parseAvfoundationAudioDevices(sample), [
    { id: '0', name: 'MacBook Air Microphone' },
    { id: '1', name: 'Sakura Microphone' },
  ])
})

test('names with brackets, digits and trailing spaces are kept intact', () => {
  const output = 'x] AVFoundation audio devices:\nx] [3] USB Audio [Pro] 2.0   \n'
  assert.deepEqual(parseAvfoundationAudioDevices(output), [{ id: '3', name: 'USB Audio [Pro] 2.0' }])
})

test('unrelated or empty output gives no devices', () => {
  assert.deepEqual(parseAvfoundationAudioDevices(''), [])
  assert.deepEqual(parseAvfoundationAudioDevices('ffmpeg: command not found'), [])
  assert.deepEqual(parseAvfoundationAudioDevices('AVFoundation video devices:\n[0] Camera'), [])
})

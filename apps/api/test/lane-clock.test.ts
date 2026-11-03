import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { startLaneClock } from '../src/session/lane-clock.js'

test('lane A ticks at once and every period, lane B five seconds after it', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    const ticks: Array<[number, string]> = []
    let now = 0
    const stop = startLaneClock({ periodMs: 10_000, staggerMs: 5_000, onTick: (slot) => ticks.push([now, slot]) })
    mock.timers.tick(0)
    for (let step = 0; step < 25; step++) {
      now += 1_000
      mock.timers.tick(1_000)
    }
    stop()
    assert.deepEqual(ticks, [[0, 'A'], [5000, 'B'], [10000, 'A'], [15000, 'B'], [20000, 'A'], [25000, 'B']])
  } finally {
    mock.timers.reset()
  }
})

test('stopping clears both lanes', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    let count = 0
    const stop = startLaneClock({ periodMs: 100, staggerMs: 50, onTick: () => { count++ } })
    mock.timers.tick(0)
    const afterStart = count
    assert.equal(afterStart, 1)
    stop()
    mock.timers.tick(10_000)
    assert.equal(count, afterStart)
  } finally {
    mock.timers.reset()
  }
})

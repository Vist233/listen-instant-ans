import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLaneMessages, buildUserMessage, qaSystemInstructions } from '../src/agent/qa-prompt.js'

const speech = (sequence: number, text: string) => ({ sequence, startedAtMs: 0, endedAtMs: 1, text, confidence: 1 })

test('the user message lists answered QAs, then new speech', () => {
  const text = buildUserMessage({
    transcripts: [speech(1, '第一句'), speech(2, '第二句')],
    peerQas: [{ question: '甲？', answer: '乙。' }],
    peerInflight: null,
  })
  assert.match(text, /【对方已回答】\nQ: 甲？\nA: 乙。\n\n【新增语音】\n第一句\n第二句\n/)
})

test('with no peer QAs it says so', () => {
  const text = buildUserMessage({ transcripts: [speech(1, '一句')], peerQas: [], peerInflight: null })
  assert.match(text, /【对方已回答】\n暂无\n/)
})

test('the pair the other lane is still writing is included and marked unfinished', () => {
  const text = buildUserMessage({
    transcripts: [speech(1, '一句')],
    peerQas: [],
    peerInflight: { question: '甲？', answer: '写到一半' },
  })
  assert.match(text, /Q: 甲？\nA: 写到一半（未写完）/)
})

test('the same input always gives the same bytes', () => {
  const input = { transcripts: [speech(1, '一句')], peerQas: [{ question: 'q', answer: 'a' }], peerInflight: null }
  assert.equal(buildUserMessage(input), buildUserMessage(input))
})

test('stored turns are replayed unchanged and the new request goes last', () => {
  const past = [
    { inputText: 'in-1', outputText: 'Q: x\nA: y\n' },
    { inputText: 'in-2', outputText: '-' },
  ]
  const messages = buildLaneMessages(past, 'in-3')
  assert.deepEqual(messages, [
    { role: 'user', content: 'in-1' },
    { role: 'assistant', content: 'Q: x\nA: y\n' },
    { role: 'user', content: 'in-2' },
    { role: 'assistant', content: '-' },
    { role: 'user', content: 'in-3' },
  ])
})

test('earlier messages are a prefix of later ones', () => {
  const first = buildLaneMessages([], 'in-1')
  const second = buildLaneMessages([{ inputText: 'in-1', outputText: 'out-1' }], 'in-2')
  assert.deepEqual(second.slice(0, 1), first)
  assert.equal(second.length, 3)
})

test('the system prompt states the format, the length limit and the empty reply', () => {
  assert.match(qaSystemInstructions, /不超过 100 字/)
  assert.match(qaSystemInstructions, /Q: <问题/)
  assert.match(qaSystemInstructions, /只输出一个 -/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { QaLineParser, type ParserEvent } from '../src/agent/qa-line-parser.js'

function parse(text: string, chunkSize = text.length): { events: ParserEvent[]; parser: QaLineParser } {
  const parser = new QaLineParser()
  const events: ParserEvent[] = []
  const chars = [...text]
  for (let index = 0; index < chars.length; index += chunkSize) {
    events.push(...parser.push(chars.slice(index, index + chunkSize).join('')))
  }
  events.push(...parser.end())
  return { events, parser }
}

const pairs = (events: ParserEvent[]) => events.filter((e) => e.type === 'pair').map((e) => [e.question, e.answer])

test('parses consecutive Q/A pairs', () => {
  const { events } = parse('Q: 牛顿第二定律？\nA: F=ma。\nQ: 动能？\nA: 因运动而具有的能量。\n')
  assert.deepEqual(pairs(events), [['牛顿第二定律？', 'F=ma。'], ['动能？', '因运动而具有的能量。']])
})

test('the result does not depend on how the stream is chunked', () => {
  const text = 'Q: 第一题？\nA: 答案一。\nQ: 第二题？\nA: 答案二，\n续行。\n'
  const whole = pairs(parse(text).events)
  for (const size of [1, 2, 3, 7]) {
    assert.deepEqual(pairs(parse(text, size).events), whole, `chunk size ${size}`)
  }
  assert.deepEqual(whole[1], ['第二题？', '答案二，续行。'])
})

test('a pair is complete only when the next Q begins or the stream ends', () => {
  const parser = new QaLineParser()
  assert.deepEqual(parser.push('Q: 甲？\nA: 乙。\n').filter((e) => e.type === 'pair'), [])
  const next = parser.push('Q: 丙？')
  assert.deepEqual(next.filter((e) => e.type === 'pair'), [{ type: 'pair', question: '甲？', answer: '乙。' }])
  assert.deepEqual(parser.end().filter((e) => e.type === 'pair'), [])
})

test('the question event comes before any partial of that pair', () => {
  const { events } = parse('Q: 甲？\nA: 乙。\n', 1)
  const kinds = events.map((e) => e.type)
  assert.equal(kinds[0], 'question')
  assert.ok(kinds.indexOf('question') < kinds.indexOf('partial'))
  assert.deepEqual(events[0], { type: 'question', question: '甲？' })
})

test('partial events carry the answer written so far and only after A: begins', () => {
  const parser = new QaLineParser()
  assert.deepEqual(parser.push('Q: 甲？\n').filter((e) => e.type === 'partial'), [])
  assert.deepEqual(parser.push('A: 先写').filter((e) => e.type === 'partial'), [{ type: 'partial', question: '甲？', answer: '先写' }])
  assert.deepEqual(parser.pending(), { question: '甲？', answer: '先写' })
  assert.deepEqual(parser.push('一半').filter((e) => e.type === 'partial'), [{ type: 'partial', question: '甲？', answer: '先写一半' }])
})

test('pending is null before A: and after the pair is finished', () => {
  const parser = new QaLineParser()
  parser.push('Q: 甲？\n')
  assert.equal(parser.pending(), null)
  parser.push('A: 乙。\n')
  assert.notEqual(parser.pending(), null)
  parser.end()
  assert.equal(parser.pending(), null)
})

test('a lone dash means no question', () => {
  assert.deepEqual(parse('-').events, [])
  assert.deepEqual(parse('-\n').events, [])
  assert.deepEqual(parse('').events, [])
})

test('accepts full-width colons, lowercase labels and markdown bold', () => {
  const { events } = parse('Q：甲？\nA：乙。\n**Q:** 丙？\n**A:** 丁。\nq: 戊？\na: 己。')
  assert.deepEqual(pairs(events), [['甲？', '乙。'], ['丙？', '丁。'], ['戊？', '己。']])
})

test('a question without an answer is dropped', () => {
  const { events } = parse('Q: 没答案？\nQ: 有答案？\nA: 有。\n')
  assert.deepEqual(pairs(events), [['有答案？', '有。']])
  assert.deepEqual(pairs(parse('Q: 只有问题？').events), [])
})

test('text outside a pair is ignored', () => {
  const { events } = parse('好的，下面是答案：\nQ: 甲？\nA: 乙。\n')
  assert.deepEqual(pairs(events), [['甲？', '乙。']])
})

test('an answer that starts with the letter A is not mistaken for a label', () => {
  const { events } = parse('Q: 冠词？\nA: A 是不定冠词。\n')
  assert.deepEqual(pairs(events), [['冠词？', 'A 是不定冠词。']])
})

test('wrapped English lines are joined with a space, Chinese ones without', () => {
  const { events } = parse('Q: What is it?\nA: It is\na test.\nQ: 中文？\nA: 第一行\n第二行\n')
  assert.deepEqual(pairs(events), [['What is it?', 'It is a test.'], ['中文？', '第一行第二行']])
})

test('an unfinished answer at the end of the stream is still a pair', () => {
  assert.deepEqual(pairs(parse('Q: 甲？\nA: 乙').events), [['甲？', '乙']])
})

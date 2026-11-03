import assert from 'node:assert/strict'
import test from 'node:test'
import { isDuplicateQuestion, normalizeQuestion, questionSimilarity } from '../src/session/dedupe.js'

test('punctuation, spaces and case do not matter', () => {
  assert.equal(normalizeQuestion(' 牛顿第二定律，是什么？ '), '牛顿第二定律是什么')
  assert.equal(questionSimilarity('What is F=ma?', 'what is f ma'), 1)
})

test('identical and near-identical questions are duplicates at 0.9', () => {
  assert.equal(questionSimilarity('牛顿第二定律是什么？', '牛顿第二定律是什么'), 1)
  assert.ok(isDuplicateQuestion('请问牛顿第二定律的表达式是什么', ['请问牛顿第二定律的表达式是什么啊'], 0.9))
})

test('two different laws are not duplicates', () => {
  const similarity = questionSimilarity('牛顿第二定律的表达式是什么', '牛顿第一定律的表达式是什么')
  assert.ok(similarity > 0.8 && similarity < 0.9, `similarity was ${similarity}`)
  assert.equal(isDuplicateQuestion('牛顿第一定律的表达式是什么', ['牛顿第二定律的表达式是什么'], 0.9), false)
})

test('short questions that differ by one digit are not duplicates', () => {
  assert.equal(isDuplicateQuestion('2+3等于几', ['2+4等于几'], 0.9), false)
  assert.equal(isDuplicateQuestion('第一题选什么', ['第二题选什么'], 0.9), false)
})

test('unrelated and empty input', () => {
  assert.equal(questionSimilarity('动能是什么', '光合作用的场所'), 0)
  assert.equal(questionSimilarity('', ''), 0)
  assert.equal(isDuplicateQuestion('动能是什么', [], 0.9), false)
})

test('the threshold is respected', () => {
  const a = '牛顿第二定律的表达式是什么'
  const b = '牛顿第一定律的表达式是什么'
  assert.equal(isDuplicateQuestion(a, [b], 0.8), true)
  assert.equal(isDuplicateQuestion(a, [b], 0.9), false)
})

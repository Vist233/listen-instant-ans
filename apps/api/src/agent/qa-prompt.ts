import type { QaResult, TranscriptFinal } from '@listen-instant-ans/contracts'

export interface QaTurnInput {
  readonly transcripts: readonly TranscriptFinal[]
  readonly peerQas: readonly QaResult[]
}

export type QaChatMessage =
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string }

function formatTranscripts(transcripts: readonly TranscriptFinal[]): string {
  return transcripts.map((item) => item.text).join('\n')
}

function formatPeerQa(results: readonly QaResult[]): string {
  if (results.length === 0) {
    return '暂无'
  }
  return results.map((result) => {
    const sources = result.sources.map((source) => `${source.title}: ${source.url}`).join('\n')
    return [`问题：${result.question ?? '无'}`, `回答：${result.answer ?? '无'}`, sources.length > 0 ? `来源：${sources}` : '来源：无'].join('\n')
  }).join('\n\n')
}

/** One user message per turn: only what this slot has not seen yet. */
export function buildTurnMessage(turn: QaTurnInput): string {
  return [
    '【对方已整理 QA】',
    formatPeerQa(turn.peerQas),
    '',
    '【新增最终语音】',
    formatTranscripts(turn.transcripts),
    '',
    '输出老师提出问题的新 QA。',
  ].join('\n')
}

/** Fixed key order keeps the replayed assistant message byte-identical across turns. */
export function serializeQaResult(result: QaResult): string {
  return JSON.stringify({
    status: result.status,
    question: result.question,
    answer: result.answer,
    sources: result.sources,
    confidence: result.confidence,
  })
}

/** Append-only conversation: finished turns are replayed unchanged, the new turn goes last. */
export function buildQaMessages(past: readonly (QaTurnInput & { readonly result: QaResult })[], current: QaTurnInput): QaChatMessage[] {
  return [
    ...past.flatMap((turn): QaChatMessage[] => [
      { role: 'user', content: buildTurnMessage(turn) },
      { role: 'assistant', content: serializeQaResult(turn.result) },
    ]),
    { role: 'user', content: buildTurnMessage(current) },
  ]
}

export const qaSystemInstructions = [
  '你是课堂实时答题 Agent。',
  '根据此前对话、对方已整理 QA 和新增最终语音判断老师是否提出新问题。',
  '没有完整新问题时输出 ignore。',
  '已回答过的问题不要重复回答。',
  '稳定知识直接回答，不调用工具。',
  '涉及新闻、价格、赛程等需要最新事实的问题，若无法核实，请在回答中说明无法核实，sources 留空，并降低 confidence，不要编造来源。',
  '只输出指定的结构化 QA，不输出推理过程。',
].join('\n')

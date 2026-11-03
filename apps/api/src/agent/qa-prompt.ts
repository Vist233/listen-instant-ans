import type { QaResult, TranscriptFinal } from '@listen-instant-ans/contracts'

export interface QaPromptInput {
  readonly historyTranscripts: readonly TranscriptFinal[]
  readonly transcripts: readonly TranscriptFinal[]
  readonly peerQas: readonly QaResult[]
}

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

export function buildQaPrompt(input: QaPromptInput): string {
  return [
    '【历史记录】',
    formatTranscripts(input.historyTranscripts),
    '',
    '【对方已整理 QA】',
    formatPeerQa(input.peerQas),
    '',
    '【新增最终语音】',
    formatTranscripts(input.transcripts),
    '',
    '输出老师提出问题的新 QA。',
  ].join('\n')
}

export const qaSystemInstructions = [
  '你是课堂实时答题 Agent。',
  '根据历史记录、对方已整理 QA 和新增最终语音判断老师是否提出新问题。',
  '没有完整新问题时输出 ignore。',
  '稳定知识直接回答，不调用工具。',
  '只输出指定的结构化 QA，不输出推理过程。',
].join('\n')

import type { QaResult, TranscriptFinal } from '@listen-instant-ans/contracts'

export interface QaPromptInput {
  readonly transcripts: readonly TranscriptFinal[]
  readonly peerQa: QaResult | null
}

function formatTranscripts(transcripts: readonly TranscriptFinal[]): string {
  return transcripts.map((item) => item.text).join('\n')
}

function formatPeerQa(result: QaResult | null): string {
  if (result === null) {
    return '暂无'
  }
  const sources = result.sources.map((source) => `${source.title}: ${source.url}`).join('\n')
  return [
    `问题：${result.question ?? '无'}`,
    `回答：${result.answer ?? '无'}`,
    sources.length > 0 ? `来源：${sources}` : '来源：无',
  ].join('\n')
}

export function buildQaPrompt(input: QaPromptInput): string {
  return [
    '【新增语音转录】',
    formatTranscripts(input.transcripts),
    '',
    '【已整理 QA】',
    formatPeerQa(input.peerQa),
    '',
    '输出老师提出问题的新 QA。',
  ].join('\n')
}

export const qaSystemInstructions = [
  '你是课堂实时答题 Agent。',
  '只根据新增语音转录和已整理 QA 判断老师是否提出新问题。',
  '没有完整新问题时输出 ignore。',
  '稳定知识直接回答，不调用工具。',
  '只输出指定的结构化 QA，不输出推理过程。',
].join('\n')

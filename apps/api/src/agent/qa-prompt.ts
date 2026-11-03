import type { TranscriptFinal } from '@listen-instant-ans/contracts'

export interface PromptQa {
  readonly question: string
  readonly answer: string
}

export interface QaTurnInput {
  readonly transcripts: readonly TranscriptFinal[]
  /** Saved QAs written by the other lane since this lane's last request. */
  readonly peerQas: readonly PromptQa[]
  /** The pair the other lane is writing right now, cut off where it currently is. */
  readonly peerInflight: PromptQa | null
}

export type QaChatMessage =
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string }

export interface ReplayedTurn {
  readonly inputText: string
  readonly outputText: string
}

export const qaSystemInstructions = [
  '你是课堂实时答题助手。输入是老师讲课的语音转写，按时间顺序追加。',
  '任务：找出老师在讲话中提出的问题，并直接回答。',
  '规则：',
  '1. 只回答“新增语音”里出现的新问题；可结合此前的语音理解被拆开的问题。',
  '2. “对方已回答”里的问题不要重复回答，其中标注“未写完”的也算已回答。',
  '3. 答案只写核心要点，不超过 100 字；不铺垫，不复述题目，不写客套话。',
  '4. 一段话里有多个问题，分别回答。',
  '5. 没有新问题时，只输出一个 -',
  '6. 严格按下面的格式输出，不要输出任何其他文字：',
  'Q: <问题，一句话>',
  'A: <答案>',
].join('\n')

function formatQa(qa: PromptQa): string {
  return `Q: ${qa.question}\nA: ${qa.answer}`
}

/** The text of one request. It is stored verbatim, so it is never rebuilt later. */
export function buildUserMessage(input: QaTurnInput): string {
  const answered = input.peerQas.map(formatQa)
  if (input.peerInflight !== null) {
    answered.push(`Q: ${input.peerInflight.question}\nA: ${input.peerInflight.answer}（未写完）`)
  }
  return [
    '【对方已回答】',
    answered.length === 0 ? '暂无' : answered.join('\n\n'),
    '',
    '【新增语音】',
    input.transcripts.map((item) => item.text).join('\n'),
    '',
    '只回答新增语音里的新问题，已回答的不要重复；没有新问题只输出 -',
  ].join('\n')
}

/** Append-only conversation: stored turns are replayed unchanged, the new request goes last. */
export function buildLaneMessages(past: readonly ReplayedTurn[], inputText: string): QaChatMessage[] {
  return [
    ...past.flatMap((turn): QaChatMessage[] => [
      { role: 'user', content: turn.inputText },
      { role: 'assistant', content: turn.outputText },
    ]),
    { role: 'user', content: inputText },
  ]
}

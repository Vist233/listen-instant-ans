/** Lowercase, and drop whitespace, punctuation and symbols, so wording noise does not matter. */
export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  const chars = [...text]
  for (let index = 0; index < chars.length - 1; index++) {
    const pair = chars[index] + chars[index + 1]
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  return counts
}

/** Dice coefficient over character bigrams, 0..1. */
export function questionSimilarity(first: string, second: string): number {
  const a = normalizeQuestion(first)
  const b = normalizeQuestion(second)
  if (a === b) return a === '' ? 0 : 1
  const left = bigrams(a)
  const right = bigrams(b)
  const total = [...left.values()].reduce((sum, n) => sum + n, 0) + [...right.values()].reduce((sum, n) => sum + n, 0)
  if (total === 0) return 0
  let shared = 0
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0)
  return (2 * shared) / total
}

export function isDuplicateQuestion(question: string, recentQuestions: readonly string[], threshold: number): boolean {
  return recentQuestions.some((recent) => questionSimilarity(question, recent) >= threshold)
}

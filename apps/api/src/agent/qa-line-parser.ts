export type ParserEvent =
  /** The `Q:` text is final because `A:` has begun. Emitted before any partial of that pair. */
  | { readonly type: 'question'; readonly question: string }
  /** The pair being written right now (after `A:` has begun). */
  | { readonly type: 'partial'; readonly question: string; readonly answer: string }
  /** A complete pair: the next `Q:` began or the stream ended. */
  | { readonly type: 'pair'; readonly question: string; readonly answer: string }

type Section = 'q' | 'a' | null

const LABEL = /^[*_\s]*([QqAa])\s*[:：]/
const COULD_BECOME_LABEL = /^[*_\s]*([QqAa]\s*)?$/

/**
 * Incremental parser for the `Q: ... / A: ...` text the model streams.
 * Anything that is not part of a pair (for example a lone `-`) is ignored.
 */
export class QaLineParser {
  #section: Section = null
  #question = ''
  #answer = ''
  #atLineStart = true
  #head = ''
  #pendingBreak = false
  #lastPartialKey = ''

  push(delta: string): ParserEvent[] {
    const events: ParserEvent[] = []
    for (const char of delta) {
      this.#char(char, events)
    }
    this.#emitPartial(events)
    return events
  }

  /** Call when the stream ended normally. A pair without an answer is dropped. */
  end(): ParserEvent[] {
    const events: ParserEvent[] = []
    this.#flushHead()
    this.#finishPair(events)
    this.#emitPartial(events)
    return events
  }

  /** The pair in flight, including the text written so far. Null before `A:` has begun. */
  pending(): { question: string; answer: string } | null {
    if (this.#section !== 'a') return null
    return { question: this.#question.trim(), answer: this.#answer.trim() }
  }

  #char(char: string, events: ParserEvent[]): void {
    if (char === '\r') return
    if (char === '\n') {
      this.#flushHead()
      this.#atLineStart = true
      this.#pendingBreak = this.#section !== null
      return
    }
    if (!this.#atLineStart) {
      this.#append(char)
      return
    }
    this.#head += char
    const label = LABEL.exec(this.#head)
    if (label !== null) {
      this.#head = ''
      this.#atLineStart = false
      this.#pendingBreak = false
      this.#startSection(label[1].toUpperCase() === 'Q' ? 'q' : 'a', events)
      return
    }
    if (!COULD_BECOME_LABEL.test(this.#head)) {
      this.#flushHead()
      this.#atLineStart = false
    }
  }

  #startSection(section: 'q' | 'a', events: ParserEvent[]): void {
    if (section === 'q') {
      this.#finishPair(events)
      this.#section = 'q'
      return
    }
    if (this.#section === 'q' && this.#question.trim() !== '') {
      events.push({ type: 'question', question: this.#question.trim() })
      this.#section = 'a'
      this.#answer = ''
      return
    }
    // `A:` with no preceding question, or a repeated `A:` line: treat as plain text.
    if (this.#section === 'a') this.#append('A:')
  }

  #flushHead(): void {
    if (this.#head === '') return
    const head = this.#head
    this.#head = ''
    this.#atLineStart = false
    for (const char of head) this.#append(char)
  }

  #append(char: string): void {
    if (this.#section === null) return
    const current = this.#section === 'q' ? this.#question : this.#answer
    if (current === '' && /[\s*_]/.test(char)) return
    let text = current
    if (this.#pendingBreak) {
      this.#pendingBreak = false
      if (/[A-Za-z0-9]$/.test(current) && /[A-Za-z0-9]/.test(char)) text += ' '
    }
    text += char
    if (this.#section === 'q') this.#question = text
    else this.#answer = text
  }

  #finishPair(events: ParserEvent[]): void {
    const question = this.#question.trim()
    const answer = this.#answer.trim()
    if (this.#section === 'a' && question !== '' && answer !== '') {
      this.#emitPartial(events)
      events.push({ type: 'pair', question, answer })
    }
    this.#section = null
    this.#question = ''
    this.#answer = ''
    this.#pendingBreak = false
    this.#lastPartialKey = ''
  }

  #emitPartial(events: ParserEvent[]): void {
    const pending = this.pending()
    if (pending === null) return
    const key = `${pending.question}\u0000${pending.answer}`
    if (key === this.#lastPartialKey) return
    this.#lastPartialKey = key
    events.push({ type: 'partial', question: pending.question, answer: pending.answer })
  }
}

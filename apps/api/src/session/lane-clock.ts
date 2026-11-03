import type { AgentSlot } from '@listen-instant-ans/contracts'

export interface LaneClockOptions {
  readonly periodMs: number
  readonly staggerMs: number
  readonly onTick: (slot: AgentSlot) => void
}

/**
 * Lane A ticks right away and then every period; lane B starts `staggerMs`
 * later. Returns a function that stops both.
 */
export function startLaneClock(options: LaneClockOptions): () => void {
  const handles: NodeJS.Timeout[] = []
  const lane = (slot: AgentSlot, offsetMs: number): void => {
    const first = setTimeout(() => {
      options.onTick(slot)
      const interval = setInterval(() => options.onTick(slot), options.periodMs)
      interval.unref()
      handles.push(interval)
    }, offsetMs)
    first.unref()
    handles.push(first)
  }
  lane('A', 0)
  lane('B', options.staggerMs)
  return () => {
    for (const handle of handles) {
      clearTimeout(handle)
      clearInterval(handle)
    }
  }
}

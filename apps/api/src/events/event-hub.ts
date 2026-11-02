import { EventEmitter } from 'node:events'
import type { SessionEvent } from '@listen-instant-ans/contracts'

type Listener = (event: SessionEvent) => void

export class EventHub {
  readonly #emitter = new EventEmitter()

  publish(event: SessionEvent): void {
    this.#emitter.emit('event', event)
  }

  subscribe(listener: Listener): () => void {
    this.#emitter.on('event', listener)
    return () => this.#emitter.off('event', listener)
  }
}

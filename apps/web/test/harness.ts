import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import type { Application } from '../../api/src/bootstrap.js'
import { createHttpServer } from '../../api/src/http/create-http-server.js'

const webRoot = join(import.meta.dirname, '..')
let loadCounter = 0

export interface CaptureOptions {
  readonly deviceId: string
  readonly onChunk: (buffer: ArrayBuffer) => void
  readonly onLevel: (level: number) => void
}

/** A microphone that does what the test tells it to. */
export function createFakeCapture() {
  const state = {
    devices: [{ id: 'usb', name: 'External USB Microphone' }, { id: 'mac', name: 'MacBook Air Microphone' }] as Array<{ id: string; name: string }>,
    error: undefined as string | undefined,
    failStart: undefined as Error | undefined,
    started: [] as string[],
    stopped: 0,
    listCalls: 0,
    chunk: undefined as ((buffer: ArrayBuffer) => void) | undefined,
    level: undefined as ((level: number) => void) | undefined,
  }
  return {
    state,
    /** When set, the next detection waits for this and answers with what it returns. */
    nextDetection: undefined as undefined | (() => Promise<{ devices: Array<{ id: string; name: string }>; error?: string }>),
    async listInputDevices() {
      state.listCalls++
      const hook = this.nextDetection
      this.nextDetection = undefined
      if (hook !== undefined) return hook()
      return { devices: state.devices, error: state.error }
    },
    async startCapture(options: CaptureOptions) {
      if (state.failStart !== undefined) throw state.failStart
      state.started.push(options.deviceId)
      state.chunk = options.onChunk
      state.level = options.onLevel
      return { stop: async () => { state.stopped++ } }
    },
  }
}

/** EventSource is missing in jsdom: read the real server's event stream instead. */
function createEventSourceClass(base: string) {
  return class FakeEventSource {
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    readonly #abort = new AbortController()
    constructor(path: string) {
      void this.#read(new URL(path, base))
    }
    async #read(url: URL): Promise<void> {
      try {
        const response = await fetch(url, { signal: this.#abort.signal })
        const decoder = new TextDecoder()
        let buffer = ''
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true })
          let end: number
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const data = block.split('\n').find((line) => line.startsWith('data: '))
            if (data !== undefined) this.onmessage?.({ data: data.slice(6) })
          }
        }
      } catch {
        // closed on purpose, or the server went away
      }
    }
    close(): void { this.#abort.abort() }
  }
}

export async function until(condition: () => boolean, label = 'condition', timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export interface Ui {
  readonly app: Application
  readonly base: string
  readonly document: Document
  readonly window: JSDOM['window']
  text(selector: string): string
  texts(selector: string): string[]
  click(selector: string): void
  setValue(selector: string, value: string): void
  select(selector: string, value: string): void
  /** Waits until the first load has finished (devices listed, sessions drawn). */
  ready(): Promise<void>
  close(): Promise<void>
}

const globalNames = ['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'EventSource', 'Option', 'Event', 'HTMLElement', '__lia'] as const

/** Opens the real web page in jsdom, wired to the given application and a fake microphone. */
export async function openUi(
  app: Application,
  capture: ReturnType<typeof createFakeCapture>,
  storage: { local?: Record<string, string>; session?: Record<string, string> } = {},
): Promise<Ui> {
  const server: Server = createHttpServer(app, webRoot)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const dom = new JSDOM(readFileSync(join(webRoot, 'index.html'), 'utf8'), { url: `${base}/` })
  const { window } = dom
  window.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', '') }
  window.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open') }
  for (const [key, value] of Object.entries(storage.local ?? {})) window.localStorage.setItem(key, value)
  for (const [key, value] of Object.entries(storage.session ?? {})) window.sessionStorage.setItem(key, value)

  const realFetch = globalThis.fetch
  const saved = new Map<string, PropertyDescriptor | undefined>()
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  install('document', window.document)
  install('window', window)
  install('localStorage', window.localStorage)
  install('sessionStorage', window.sessionStorage)
  install('navigator', window.navigator)
  install('EventSource', createEventSourceClass(base))
  install('Option', window.Option)
  install('Event', window.Event)
  install('HTMLElement', window.HTMLElement)
  install('__lia', { capture })
  install('fetch', (input: string | URL, init?: RequestInit) => realFetch(new URL(String(input), base), init))

  const exports = import(`../app.js?load=${++loadCounter}`)
  let loaded = false
  void exports.then(() => { loaded = true })

  const $ = (selector: string): Element => {
    const element = window.document.querySelector(selector)
    if (element === null) throw new Error(`No element for ${selector}`)
    return element
  }

  return {
    app,
    base,
    document: window.document,
    window,
    text: (selector) => ($(selector).textContent ?? '').trim(),
    texts: (selector) => [...window.document.querySelectorAll(selector)].map((element) => (element.textContent ?? '').trim()),
    click: (selector) => { ($(selector) as HTMLElement).click() },
    setValue: (selector, value) => { ($(selector) as HTMLInputElement).value = value },
    select: (selector, value) => {
      const element = $(selector) as HTMLSelectElement
      element.value = value
      element.dispatchEvent(new window.Event('change'))
    },
    async ready() {
      await until(() => loaded, 'app.js to load')
      await until(() => (window.document.querySelector('#device') as HTMLSelectElement).options.length > 0 && capture.state.listCalls > 0, 'devices to load')
      await new Promise((resolve) => setTimeout(resolve, 150))
    },
    async close() {
      window.close()
      for (const name of [...saved.keys()]) {
        const descriptor = saved.get(name)
        if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name]
        else Object.defineProperty(globalThis, name, descriptor)
      }
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

export { globalNames }

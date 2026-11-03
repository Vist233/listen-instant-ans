import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { listenOnFreePort } from '../src/ports.js'

const open: Server[] = []
const track = (server: Server): Server => { open.push(server); return server }
test.afterEach(async () => {
  while (open.length > 0) {
    const server = open.pop()!
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

async function freeNumber(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return port
}

test('the preferred port is used when it is free', async () => {
  const preferred = await freeNumber()
  const port = await listenOnFreePort(track(createServer()), preferred)
  assert.equal(port, preferred)
})

test('another free port is used when the preferred one is taken', async () => {
  const taken = track(createServer())
  await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve))
  const busy = (taken.address() as AddressInfo).port
  const second = track(createServer((_, response) => response.end('second')))
  const port = await listenOnFreePort(second, busy)
  assert.notEqual(port, busy)
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'second')
})

test('it only listens on this machine', async () => {
  const server = track(createServer())
  await listenOnFreePort(server, 0)
  assert.equal((server.address() as AddressInfo).address, '127.0.0.1')
})

test('other errors are not hidden', async () => {
  await assert.rejects(listenOnFreePort(track(createServer()), 80, '203.0.113.1'), (error: NodeJS.ErrnoException) => error.code !== 'EADDRINUSE')
})

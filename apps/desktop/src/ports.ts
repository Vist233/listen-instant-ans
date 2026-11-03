import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Listens on the preferred port, or on any free port when it is taken
 * (another copy of the program, or a development server).
 */
export async function listenOnFreePort(server: Server, preferred: number, host = '127.0.0.1'): Promise<number> {
  for (const port of preferred === 0 ? [0] : [preferred, 0]) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          resolve()
        })
      })
      return (server.address() as AddressInfo).port
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error('No free port could be found.')
}

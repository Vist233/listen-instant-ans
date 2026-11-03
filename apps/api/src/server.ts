import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApplication } from './bootstrap.js'
import { createHttpServer } from './http/create-http-server.js'

const app = createApplication()
const port = Number(process.env.PORT ?? 3100)
const here = dirname(fileURLToPath(import.meta.url))
// A built copy keeps the page next to the server; a source checkout has it in apps/web.
const webRoot = [join(here, 'public'), join(here, '../../web')].find((path) => existsSync(join(path, 'index.html'))) ?? join(here, 'public')

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
      : ['xdg-open', url]
  spawn(command[0], command.slice(1), { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
}

createHttpServer(app, webRoot).listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`
  console.log(`ListenInstantAns is running at ${url}`)
  if (process.argv.includes('--open')) openBrowser(url)
})

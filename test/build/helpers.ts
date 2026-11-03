import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

export interface RunningServer {
  readonly base: string
  readonly process: ChildProcess
  readonly output: () => string
  stop(): Promise<void>
}

/** Starts a server process and waits for its "is running at" line. */
export async function startServer(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<RunningServer> {
  const port = await freePort()
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...options.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  const exited = new Promise<never>((_, reject) => child.once('exit', (code) => reject(new Error(`Server exited with code ${code}.\n${output}`))))
  const ready = new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (/is running at/.test(output)) { clearInterval(timer); resolve() }
    }, 50)
  })
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Server did not start in time.\n${output}`)), options.timeoutMs ?? 30_000))
  try {
    await Promise.race([ready, exited, timeout])
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  }
  return {
    base: `http://127.0.0.1:${port}`,
    process: child,
    output: () => output,
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) { resolve(); return }
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }),
  }
}

/** The environment a user's machine would have: no keys and a private home. */
export function cleanEnvironment(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, LISTEN_INSTANT_ANS_SETTINGS: `${home}/settings.json`, LISTEN_INSTANT_ANS_DATABASE: ':memory:', ...extra }
}

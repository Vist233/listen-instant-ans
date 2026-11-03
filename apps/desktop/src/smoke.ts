/** A self-check of a running server, used on the packaged program: no window, no microphone. */
export interface SmokeCheck {
  readonly name: string
  readonly ok: boolean
  readonly detail?: string
}

export interface SmokeResult {
  readonly ok: boolean
  readonly checks: SmokeCheck[]
}

export interface SmokeOptions {
  /** Also wait for a real answer from the model (needs a key). */
  readonly withModel?: boolean
  readonly modelTimeoutMs?: number
}

export async function runSmokeTest(base: string, options: SmokeOptions = {}): Promise<SmokeResult> {
  const checks: SmokeCheck[] = []
  const check = async (name: string, work: () => Promise<string | void>): Promise<boolean> => {
    try {
      const detail = await work()
      checks.push({ name, ok: true, detail: detail ?? undefined })
      return true
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
      return false
    }
  }
  const expect = (condition: boolean, message: string): void => { if (!condition) throw new Error(message) }
  const json = async (path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  await check('server answers /health', async () => {
    expect((await json('/health')).body.ok === true, 'health was not ok')
  })
  await check('the page and its scripts are served', async () => {
    const page = await (await fetch(`${base}/`)).text()
    expect(page.includes('Listen Instant Ans'), 'index.html has the wrong content')
    for (const path of ['/app.js', '/capture.js', '/pcm.js', '/pcm-worklet.js', '/styles.css']) {
      expect((await fetch(`${base}${path}`)).status === 200, `${path} is missing`)
    }
  })
  let sessionId = ''
  await check('a session can be created (database works)', async () => {
    const created = await json('/sessions', 'POST', {})
    expect(created.status === 201, `status ${created.status}`)
    sessionId = created.body.id
  })
  await check('a transcript is stored and read back', async () => {
    const posted = await json(`/sessions/${sessionId}/transcripts`, 'POST', { startedAtMs: 0, endedAtMs: 1, text: '冒烟测试一句话' })
    expect(posted.status === 202, `status ${posted.status}`)
    const timeline = await json(`/sessions/${sessionId}/timeline`)
    expect(timeline.body.transcripts[0]?.text === '冒烟测试一句话', 'the transcript did not come back')
  })
  await check('the settings can be read and no secret is exposed', async () => {
    const settings = await json('/settings')
    expect(settings.status === 200 && typeof settings.body.ready?.answering === 'boolean', 'bad settings answer')
    expect(!/sk-[A-Za-z0-9]{8,}/.test(JSON.stringify(settings.body)), 'a key was exposed')
  })
  await check('audio is refused while nothing is listening', async () => {
    const response = await fetch(`${base}/sessions/${sessionId}/audio`, { method: 'POST', body: new Uint8Array([1]) })
    expect(response.status === 400, `status ${response.status}`)
  })
  await check('requests from other web sites are refused', async () => {
    const response = await fetch(`${base}/sessions`, { method: 'POST', headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' }, body: '{}' })
    expect(response.status === 403, `status ${response.status}`)
  })

  if (options.withModel === true) {
    await check('the model answers a question', async () => {
      const created = await json('/sessions', 'POST', {})
      await json(`/sessions/${created.body.id}/transcripts`, 'POST', { startedAtMs: 0, endedAtMs: 1, text: '请问牛顿第二定律的表达式是什么？' })
      const deadline = Date.now() + (options.modelTimeoutMs ?? 40_000)
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const shown = (await json(`/sessions/${created.body.id}/timeline`)).body.qas.filter((qa: { status: string }) => qa.status === 'shown')
        if (shown.length > 0) return `${shown[0].question} -> ${shown[0].answer}`
      }
      throw new Error('no answer arrived in time')
    })
  }
  return { ok: checks.every((item) => item.ok), checks }
}

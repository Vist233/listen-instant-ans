import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadConfig, type AppConfig } from './env.js'

/** The user has to fix something in the settings; the web page opens the settings panel for it. */
export class SettingsError extends Error {}

export interface SettingsValues {
  readonly mimo?: { readonly apiKey?: string; readonly model?: string; readonly baseUrl?: string }
  readonly aliyun?: { readonly appKey?: string; readonly token?: string }
}

/** `undefined` keeps the stored value, an empty string clears it. */
export type SettingsPatch = SettingsValues

export interface SecretStatus {
  readonly set: boolean
  /** Never the value itself: only the last four characters. */
  readonly hint: string
  readonly source: 'file' | 'env' | 'none'
}

export interface SettingsStatus {
  readonly path: string | null
  readonly mimo: { readonly apiKey: SecretStatus; readonly model: string; readonly baseUrl: string }
  readonly aliyun: { readonly appKey: SecretStatus; readonly token: SecretStatus }
  readonly ready: { readonly answering: boolean; readonly transcription: boolean }
}

export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LISTEN_INSTANT_ANS_SETTINGS ?? join(homedir(), '.listen-instant-ans', 'settings.json')
}

function readFile(path: string): SettingsValues {
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as SettingsValues : {}
  } catch {
    const backup = `${path}.corrupt`
    renameSync(path, backup)
    console.warn(`Settings file was not valid JSON; moved to ${backup} and started empty.`)
    return {}
  }
}

function cleanText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new SettingsError(`${label} 必须是文本。`)
  const text = value.trim()
  if (text.length > 512) throw new SettingsError(`${label} 太长。`)
  if (/\s/.test(text)) throw new SettingsError(`${label} 不能包含空格或换行。`)
  return text
}

function hint(value: string | undefined): string {
  if (value === undefined || value === '') return ''
  return value.length >= 9 ? `····${value.slice(-4)}` : '····'
}

/**
 * Keys typed into the settings panel live in one file in the user's home
 * directory (mode 600). Environment variables still work as a fallback.
 */
export class SettingsStore {
  #values: SettingsValues
  readonly #listeners = new Set<() => void>()

  /** `path` null keeps everything in memory (tests). */
  constructor(
    private readonly path: string | null,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.#values = path === null ? {} : readFile(path)
  }

  /** The effective configuration: stored values win over environment variables. */
  current(): AppConfig {
    const base = loadConfig(this.env)
    const file = this.#values
    return {
      ...base,
      aliyun: {
        ...base.aliyun,
        appKey: file.aliyun?.appKey || base.aliyun.appKey,
        token: file.aliyun?.token || base.aliyun.token,
      },
      mimo: {
        baseUrl: file.mimo?.baseUrl || base.mimo.baseUrl,
        apiKey: file.mimo?.apiKey || base.mimo.apiKey,
        model: file.mimo?.model || base.mimo.model,
      },
    }
  }

  status(): SettingsStatus {
    const config = this.current()
    const env = loadConfig(this.env)
    const file = this.#values
    const secret = (stored: string | undefined, fromEnv: string | undefined): SecretStatus => {
      const value = stored || fromEnv
      return { set: Boolean(value), hint: hint(value), source: stored ? 'file' : fromEnv ? 'env' : 'none' }
    }
    return {
      path: this.path,
      mimo: {
        apiKey: secret(file.mimo?.apiKey, env.mimo.apiKey),
        model: config.mimo.model,
        baseUrl: config.mimo.baseUrl ?? '',
      },
      aliyun: {
        appKey: secret(file.aliyun?.appKey, env.aliyun.appKey),
        token: secret(file.aliyun?.token, env.aliyun.token),
      },
      ready: {
        answering: Boolean(config.mimo.apiKey),
        transcription: Boolean(config.aliyun.appKey && config.aliyun.token),
      },
    }
  }

  update(patch: unknown): SettingsStatus {
    if (typeof patch !== 'object' || patch === null) throw new SettingsError('设置格式不正确。')
    const input = patch as { mimo?: Record<string, unknown>; aliyun?: Record<string, unknown> }
    const next = {
      mimo: { ...this.#values.mimo },
      aliyun: { ...this.#values.aliyun },
    } as { mimo: Record<string, string>; aliyun: Record<string, string> }
    const apply = (group: 'mimo' | 'aliyun', field: string, label: string, raw: unknown): void => {
      const value = cleanText(raw, label)
      if (value === undefined) return
      if (value === '') delete next[group][field]
      else next[group][field] = value
    }
    apply('mimo', 'apiKey', 'MiMo API Key', input.mimo?.apiKey)
    apply('mimo', 'model', '模型', input.mimo?.model)
    apply('mimo', 'baseUrl', '接口地址', input.mimo?.baseUrl)
    apply('aliyun', 'appKey', '阿里云 AppKey', input.aliyun?.appKey)
    apply('aliyun', 'token', '阿里云 Token', input.aliyun?.token)
    if (next.mimo.baseUrl !== undefined) {
      let url: URL
      try { url = new URL(next.mimo.baseUrl) } catch { throw new SettingsError('接口地址不是有效的网址。') }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SettingsError('接口地址必须以 http:// 或 https:// 开头。')
    }
    this.#values = next
    this.persist()
    for (const listener of this.#listeners) listener()
    return this.status()
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  private persist(): void {
    if (this.path === null) return
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.#values, null, 2)}\n`, { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.path)
  }
}

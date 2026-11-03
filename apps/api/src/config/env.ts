export interface AppConfig {
  readonly databasePath: string
  readonly agentRunTimeoutMs: number
  readonly aliyun: {
    readonly appKey?: string
    readonly token?: string
    readonly endpoint: string
  }
  readonly mimo: {
    readonly baseUrl?: string
    readonly apiKey?: string
    readonly model: string
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    agentRunTimeoutMs: Number(environment.AGENT_RUN_TIMEOUT_MS ?? 30_000),
    databasePath: environment.LISTEN_INSTANT_ANS_DATABASE ?? 'data/listen-instant-ans.sqlite',
    aliyun: {
      appKey: environment.ALIYUN_NLS_APP_KEY ?? environment.ALIYUN_APP_ID,
      token: environment.ALIYUN_NLS_TOKEN ?? environment.ALIYUN_TMP_TOKEN,
      endpoint: environment.ALIYUN_NLS_ENDPOINT ?? 'wss://nls-gateway.aliyuncs.com/ws/v1',
    },
    mimo: {
      baseUrl: environment.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/v1',
      apiKey: environment.MIMO_API_KEY,
      model: environment.MIMO_MODEL ?? 'mimo-v2.6-flash',
    },
  }
}

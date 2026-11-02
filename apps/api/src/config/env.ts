export interface AppConfig {
  readonly databasePath: string
  readonly aliyun: {
    readonly appKey?: string
    readonly token?: string
    readonly endpoint: string
  }
  readonly opencode: {
    readonly baseUrl?: string
    readonly apiKey?: string
    readonly model: string
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databasePath: environment.LISTEN_INSTANT_ANS_DATABASE ?? 'data/listen-instant-ans.sqlite',
    aliyun: {
      appKey: environment.ALIYUN_NLS_APP_KEY,
      token: environment.ALIYUN_NLS_TOKEN,
      endpoint: environment.ALIYUN_NLS_ENDPOINT ?? 'wss://nls-gateway.aliyuncs.com/ws/v1',
    },
    opencode: {
      baseUrl: environment.OPENCODE_BASE_URL,
      apiKey: environment.OPENCODE_API_KEY,
      model: environment.OPENCODE_MODEL ?? 'deepseek-4.1-flash',
    },
  }
}

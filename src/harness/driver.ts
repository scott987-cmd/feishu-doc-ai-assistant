/**
 * Headless driver for the AI agent — used by the template-replication harness.
 * Mints a tenant token from feishu-app-config.txt, reads the LLM config from
 * deepseek-v4-pro.txt, and runs runAgent() end-to-end against the real Feishu API.
 */
import { readFileSync } from 'node:fs'
import { runAgent } from '../shared/ai/agent'
import { getTenantAccessToken } from '../shared/feishu/auth'
import * as API from '../shared/feishu/api'
import { DEFAULT_SETTINGS, type AppSettings, type PageContext, type ChatMessage } from '../shared/types'

export interface ToolTrace {
  name: string
  args: Record<string, unknown>
  result?: string
  isError?: boolean
}

export interface RunResult {
  finalText: string
  tools: ToolTrace[]
  errors: ToolTrace[]
}

let _token: string | undefined

export async function tenantToken(): Promise<string> {
  if (_token) return _token
  const cfg = readFileSync('feishu-app-config.txt', 'utf8')
  const appId = cfg.match(/APP_ID\s*=\s*(\S+)/i)![1]
  const appSecret = cfg.match(/App_Secret\s*=\s*(\S+)/i)![1]
  _token = await getTenantAccessToken(appId, appSecret)
  return _token
}

export function llmSettings(): AppSettings {
  const cfg = readFileSync('deepseek-v4-pro.txt', 'utf8')
  const baseUrl = cfg.match(/base_url\s*=\s*(\S+)/i)![1]
  const apiKey = cfg.match(/api_key\s*=\s*(\S+)/i)![1]
  const token = _token ?? ''
  return {
    ...DEFAULT_SETTINGS,
    openaiBaseUrl: baseUrl,
    openaiApiKey: apiKey,
    openaiModel: process.env.LLM_MODEL || 'deepseek-v4-pro',
    feishuAccessToken: token, // resolveToken() returns this when no built-in creds
  }
}

let _uid = 0
const uid = () => `m${++_uid}`

/** Run the agent with a single natural-language instruction against a given Base. */
export async function runReplication(prompt: string, appToken: string): Promise<RunResult> {
  await tenantToken()
  const settings = llmSettings()
  const context: PageContext = {
    url: `https://feishu.cn/base/${appToken}`,
    title: 'Base',
    selectedText: '',
    feishu: { isBase: true, appToken },
  }
  const history: ChatMessage[] = [
    { id: uid(), role: 'user', content: prompt, createdAt: 0 },
  ]

  const tools: ToolTrace[] = []
  let finalText = ''

  await runAgent(history, settings, context, {
    onChunk: () => {},
    onToolStart: (name, args) => tools.push({ name, args }),
    onToolEnd: (_id, result, isError) => {
      const last = tools[tools.length - 1]
      if (last) { last.result = result; last.isError = isError }
    },
    onAssistantMessage: (m) => { if (m.content) finalText = m.content },
    onToolMessage: () => {},
  })

  return { finalText, tools, errors: tools.filter((t) => t.isError) }
}

/** Create a fresh, disposable test Base and return its app_token. */
export async function freshBase(label: string): Promise<string> {
  const token = await tenantToken()
  const res = (await API.createApp(token, `复刻_${label}_${Date.now()}`)) as {
    app: { app_token: string }
  }
  return res.app.app_token
}

export interface ActualField { name: string; type: number }
export interface ActualStructure {
  tables: Array<{ name: string; fields: ActualField[] }>
}

/** Read back the real structure of a Base for verification. */
export async function readStructure(appToken: string): Promise<ActualStructure> {
  const token = await tenantToken()
  const tablesRes = (await API.listTables(token, appToken)) as {
    items: Array<{ table_id: string; name: string }>
  }
  const tables = []
  for (const t of tablesRes.items) {
    const fieldsRes = (await API.listFields(token, appToken, t.table_id)) as {
      items: Array<{ field_name: string; type: number }>
    }
    tables.push({ name: t.name, fields: fieldsRes.items.map((f) => ({ name: f.field_name, type: f.type })) })
  }
  return { tables }
}

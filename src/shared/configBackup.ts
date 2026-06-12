/**
 * 本地「配置 + 数据」备份（导出到文件 / 从文件恢复）—— 防止个人用户数据丢失（重装 / 换机 / 清缓存）。
 *
 * 没有服务端也能用：store/BYO 版用户把自己的配置、保存的产物（小程序/AI建站/PPT）、本地经验、会话
 * 导出成一个 JSON 文件，换设备或重装后导入即可。全程纯本地，不联网。
 *
 * 敏感字段：settings 里的 openaiApiKey / feishuAccessToken、BYO 的 App Secret 在本机是【设备加密】存的
 * （换设备无法解密），所以导出时若勾选「包含密钥」会解密成明文写进文件（文件含明文密钥，需妥善保管）；
 * 导入时再用【本设备】的密钥重新加密。默认不含密钥（产物/经验/会话才是难以重来的数据，密钥可再填）。
 */
import { encryptField, decryptField } from './crypto'
import { BUILD_CONFIG } from './config'

const MARKER = 'feishu-ai-assistant'
const MSG_PREFIX = 'session_msgs_v1::'
const CAP = { dataviz_v1: 50, slides_decks_v1: 50, _learned_recipes_v1: 300 } as const

export interface BackupFile {
  _backup: string
  version: number
  exportedAt: string
  appRev?: string
  secretsIncluded: boolean
  data: Record<string, unknown>
}
export interface ImportSummary {
  settings: boolean; appCreds: boolean; dataviz: number; slides: number; recipes: number; sessions: number
}

const getAll = (): Promise<Record<string, unknown>> =>
  new Promise((r) => { try { chrome.storage.local.get(null, (x) => r(x || {})) } catch { r({}) } })
const setAll = (items: Record<string, unknown>): Promise<void> =>
  new Promise((r) => { try { chrome.storage.local.set(items, () => r()) } catch { r() } })

/** Union two arrays of `{id}` by id (incoming fills what local lacks), newest-first, capped. Pure. */
export function mergeById<T extends { id: string; createdAt?: number }>(local: T[], incoming: T[], cap: number): T[] {
  const have = new Set(local.map((x) => x.id))
  const add = incoming.filter((x) => x && typeof x.id === 'string' && !have.has(x.id))
  if (!add.length) return local
  return [...local, ...add].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, cap)
}

/** Build a portable backup object from local storage. `exportedAt` is passed in by the caller. */
export async function buildBackup(opts: { includeSecrets: boolean; exportedAt: string }): Promise<BackupFile> {
  const all = await getAll()
  const data: Record<string, unknown> = {}

  // settings_v2 — non-secret fields always; secrets decrypted only when opted in.
  const s = (all['settings_v2'] || {}) as Record<string, string>
  const settings: Record<string, unknown> = {
    openaiBaseUrl: s.openaiBaseUrl, openaiModel: s.openaiModel, templateRegistryUrl: s.templateRegistryUrl,
    feishuOwnerOpenId: s.feishuOwnerOpenId, learnFromHistory: s.learnFromHistory, voiceInput: s.voiceInput,
    autoConfirm: s.autoConfirm, llmSource: s.llmSource,
  }
  if (opts.includeSecrets) {
    settings.openaiApiKey = s.openaiApiKey ? await decryptField(s.openaiApiKey) : ''
    settings.feishuAccessToken = s.feishuAccessToken ? await decryptField(s.feishuAccessToken) : ''
  }
  data.settings = settings

  // BYO app creds — App ID always; secret decrypted only when opted in.
  const creds = (all['_user_app_creds_v1'] || null) as { appId?: string; secretEnc?: string } | null
  if (creds?.appId) {
    const c: Record<string, unknown> = { appId: creds.appId }
    if (opts.includeSecrets && creds.secretEnc) c.appSecret = await decryptField(creds.secretEnc)
    data.appCreds = c
  }

  // The data that's painful to lose — saved outputs + local learning (no secrets in these).
  if (Array.isArray(all['dataviz_v1'])) data.dataviz = all['dataviz_v1']
  if (Array.isArray(all['slides_decks_v1'])) data.slides = all['slides_decks_v1']
  if (Array.isArray(all['_learned_recipes_v1'])) data.recipes = all['_learned_recipes_v1']

  // Conversations (index + per-session message shards).
  if (all['sessions_index_v1']) {
    const messages: Record<string, unknown> = {}
    for (const k of Object.keys(all)) if (k.startsWith(MSG_PREFIX)) messages[k.slice(MSG_PREFIX.length)] = all[k]
    data.sessions = { index: all['sessions_index_v1'], messages }
  }

  // Small non-secret prefs + UI theme.
  const prefs: Record<string, unknown> = {}
  if (all['docaudit_check_v1'] !== undefined) prefs.docaudit = all['docaudit_check_v1']
  if (all['docsummary_prompt_v1'] !== undefined) prefs.docsummary = all['docsummary_prompt_v1']
  try { const t = localStorage.getItem('fa-theme'); if (t) prefs.theme = t; const a = localStorage.getItem('fa-accent'); if (a) prefs.accent = a } catch { /* ignore */ }
  if (Object.keys(prefs).length) data.prefs = prefs

  return { _backup: MARKER, version: 1, exportedAt: opts.exportedAt, appRev: BUILD_CONFIG._rev, secretsIncluded: opts.includeSecrets, data }
}

/** Restore a backup into local storage. MERGES (never deletes local): arrays union by id, settings
 *  apply imported fields (secrets re-encrypted on THIS device, else kept), sessions add missing. */
export async function applyBackup(file: BackupFile): Promise<ImportSummary> {
  if (!file || file._backup !== MARKER || typeof file.data !== 'object' || !file.data) {
    throw new Error('不是有效的备份文件')
  }
  const d = file.data as Record<string, any>
  const all = await getAll()
  const writes: Record<string, unknown> = {}
  const summary: ImportSummary = { settings: false, appCreds: false, dataviz: 0, slides: 0, recipes: 0, sessions: 0 }

  // settings — apply non-secret fields over current; re-encrypt secrets when present (else keep local).
  if (d.settings && typeof d.settings === 'object') {
    const cur = (all['settings_v2'] || {}) as Record<string, unknown>
    const ns = d.settings as Record<string, unknown>
    const pick = (k: string) => (ns[k] !== undefined ? ns[k] : cur[k])
    const next: Record<string, unknown> = {
      ...cur,
      openaiBaseUrl: pick('openaiBaseUrl'), openaiModel: pick('openaiModel'),
      templateRegistryUrl: pick('templateRegistryUrl'), feishuOwnerOpenId: pick('feishuOwnerOpenId'),
      learnFromHistory: pick('learnFromHistory'), voiceInput: pick('voiceInput'),
      autoConfirm: pick('autoConfirm'), llmSource: pick('llmSource'),
    }
    if (typeof ns.openaiApiKey === 'string' && ns.openaiApiKey) next.openaiApiKey = await encryptField(ns.openaiApiKey)
    if (typeof ns.feishuAccessToken === 'string' && ns.feishuAccessToken) next.feishuAccessToken = await encryptField(ns.feishuAccessToken)
    writes['settings_v2'] = next
    summary.settings = true
  }

  // BYO app creds
  if (d.appCreds?.appId) {
    const cur = (all['_user_app_creds_v1'] || {}) as { appId?: string; secretEnc?: string }
    const next: { appId: string; secretEnc: string } = { appId: String(d.appCreds.appId), secretEnc: cur.secretEnc || '' }
    if (typeof d.appCreds.appSecret === 'string' && d.appCreds.appSecret) next.secretEnc = await encryptField(d.appCreds.appSecret)
    writes['_user_app_creds_v1'] = next
    summary.appCreds = true
  }

  // arrays — union by id (only add what's missing locally)
  for (const [key, incoming] of [['dataviz_v1', d.dataviz], ['slides_decks_v1', d.slides], ['_learned_recipes_v1', d.recipes]] as const) {
    if (!Array.isArray(incoming)) continue
    const local = (Array.isArray(all[key]) ? all[key] : []) as Array<{ id: string; createdAt?: number }>
    const merged = mergeById(local, incoming as Array<{ id: string; createdAt?: number }>, CAP[key])
    if (merged.length !== local.length) writes[key] = merged
    const added = merged.length - local.length
    if (key === 'dataviz_v1') summary.dataviz = added
    else if (key === 'slides_decks_v1') summary.slides = added
    else summary.recipes = added
  }

  // sessions — add missing sessions to the index + write their message shards
  if (d.sessions?.index?.sessions && Array.isArray(d.sessions.index.sessions)) {
    const curIdx = (all['sessions_index_v1'] || { sessions: [], activeId: null }) as { sessions: Array<{ id: string }>; activeId: string | null }
    const have = new Set(curIdx.sessions.map((x) => x.id))
    const addSessions = d.sessions.index.sessions.filter((x: { id: string }) => x && x.id && !have.has(x.id))
    if (addSessions.length) {
      writes['sessions_index_v1'] = { sessions: [...curIdx.sessions, ...addSessions], activeId: curIdx.activeId ?? d.sessions.index.activeId ?? null }
      const msgs = (d.sessions.messages || {}) as Record<string, unknown>
      for (const sess of addSessions) if (msgs[sess.id]) writes[MSG_PREFIX + sess.id] = msgs[sess.id]
      summary.sessions = addSessions.length
    }
  }

  // prefs + theme
  if (d.prefs && typeof d.prefs === 'object') {
    if (d.prefs.docaudit !== undefined) writes['docaudit_check_v1'] = d.prefs.docaudit
    if (d.prefs.docsummary !== undefined) writes['docsummary_prompt_v1'] = d.prefs.docsummary
    try {
      if (typeof d.prefs.theme === 'string') localStorage.setItem('fa-theme', d.prefs.theme)
      if (typeof d.prefs.accent === 'string') localStorage.setItem('fa-accent', d.prefs.accent)
    } catch { /* ignore */ }
  }

  await setAll(writes)
  return summary
}

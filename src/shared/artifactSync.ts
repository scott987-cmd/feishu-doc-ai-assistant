/**
 * 企业云备份（CLIENT）—— 把用户自己保存的产物（小程序/AI建站/PPT）镜像到【企业自有】对象存储，
 * 本地（chrome.storage.local）一旦清空/换设备/重装，可从云端拉回。
 *
 * 安全/隐私：产物是用户用本企业飞书数据生成的输出，仅备份进【公司自己的】私有对象存储；上传用
 * 用户【自己的飞书 user_access_token】鉴权，服务端校验租户成员 + 用校验出的 open_id 作存储路径
 * （客户端不可指定路径 → 互相读不到）。详见 docs/artifact-proxy-server.mjs。
 *
 * 开关：每个函数在 HAS_ARTIFACT_SYNC 关时都是 totally no-op（VITE_ARTIFACT_SYNC=1 且配了 proxy 才开）。
 * store/BYO 构建没有 proxy → HAS_ARTIFACT_SYNC 恒 false → 死代码消除，零网络、发版完全不受影响。
 */
import { BUILD_CONFIG, HAS_ARTIFACT_SYNC } from './config'
import { getValidUserToken } from './feishu/auth'

/** 备份分组：与本地 storage key 对应（dataviz_v1 / slides_decks_v1）。 */
export type ArtifactKind = 'dataviz' | 'slides'

const base = (): string => BUILD_CONFIG.oauthProxyUrl.replace(/\/+$/, '')
const headers = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(BUILD_CONFIG.oauthProxyKey ? { 'X-Proxy-Key': BUILD_CONFIG.oauthProxyKey } : {}),
})

/** 上传整组（覆盖镜像）。best-effort，失败不抛、不阻塞。 */
async function pushKind(kind: ArtifactKind, items: unknown[]): Promise<void> {
  const token = await getValidUserToken()
  if (!token) return // 未授权 → 静默跳过（恢复授权后下次保存会再备份）
  await fetch(`${base()}/artifacts/put`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ user_access_token: token, kind, items }),
  })
}

// 合并多次快速保存：3s 防抖，只发最后一版整组。
const DEBOUNCE_MS = 3000
const timers = new Map<ArtifactKind, ReturnType<typeof setTimeout>>()
const pending = new Map<ArtifactKind, unknown[]>()

/** 本地保存成功后调用：防抖把该分组整组备份到企业云。no-op off。 */
export function scheduleBackup(kind: ArtifactKind, items: unknown[]): void {
  if (!HAS_ARTIFACT_SYNC) return
  pending.set(kind, items)
  const t = timers.get(kind)
  if (t) clearTimeout(t)
  timers.set(kind, setTimeout(() => {
    timers.delete(kind)
    const latest = pending.get(kind) ?? []
    pending.delete(kind)
    void pushKind(kind, latest).catch(() => { /* best-effort; never block the user */ })
  }, DEBOUNCE_MS))
}

/** 从企业云拉取该分组整组。失败/未授权/未开 → []。 */
export async function restoreArtifacts<T = unknown>(kind: ArtifactKind): Promise<T[]> {
  if (!HAS_ARTIFACT_SYNC) return []
  try {
    const token = await getValidUserToken()
    if (!token) return []
    const res = await fetch(`${base()}/artifacts/pull`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ user_access_token: token, kind }),
    })
    const j = (await res.json()) as { items?: unknown }
    return Array.isArray(j.items) ? (j.items as T[]) : []
  } catch { return [] }
}

/**
 * 恢复：把云端该分组按 id 并集合并进本地——【只补不覆盖】本地（本地为主，永不因云端而删/改本地条目），
 * 合并后按 createdAt 取最新 50 条（与本地存储上限一致）。返回新增条数。精准服务「本地丢了→拉回」。
 */
export async function restoreAndMerge<T extends { id: string; createdAt?: number }>(
  kind: ArtifactKind,
  loadLocal: () => Promise<T[]>,
  replaceLocal: (list: T[]) => Promise<unknown>,
): Promise<number> {
  if (!HAS_ARTIFACT_SYNC) return 0
  const cloud = await restoreArtifacts<T>(kind)
  if (!cloud.length) return 0
  const local = await loadLocal()
  const have = new Set(local.map((x) => x.id))
  const add = cloud.filter((x) => x && x.id && !have.has(x.id))
  if (!add.length) return 0
  const merged = [...local, ...add].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 50)
  await replaceLocal(merged)
  return add.length
}

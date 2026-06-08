/**
 * 私有化 API 版本回退（动态探测，不写死）。
 *
 * 私有化部署的飞书往往落后于 SaaS：SaaS 构建里写的 `/<service>/vN/...` 路径，在旧实例上可能整段
 * 不存在 → 网关返回 HTTP 404。这里【不把版本写死】，而是运行时探测——vN 的 404 就降到 v(N-1)
 * 重试，逐级到 v1；并【记住】该服务实际可用的版本，之后的调用直接走对的版本，不再来回试。
 *
 * 安全性：HTTP 404 = 网关没匹配到该路径 = 请求【根本没执行】，所以即便是写操作，降级重试也不会
 * 重复创建（这与 http.ts「超时/5xx 的写不重试」是两回事——那是怕已执行）。只在私有化构建启用
 * （SaaS 端点一定存在、不会 404，零额外开销）。
 */

const VER_RE = /^(\/[a-z][a-z0-9_]*)\/v(\d+)(\/.*|$)/i

interface Parsed { prefix: string; service: string; ver: number; tail: string }

/** Split `/bitable/v2/apps/x` → { prefix:'/bitable', service:'bitable', ver:2, tail:'/apps/x' }. */
export function parseVersion(path: string): Parsed | null {
  const m = path.match(VER_RE)
  if (!m) return null
  return { prefix: m[1], service: m[1].slice(1).toLowerCase(), ver: Number(m[2]), tail: m[3] }
}

function withVersion(p: Parsed, ver: number): string { return `${p.prefix}/v${ver}${p.tail}` }

// service+originalVersion → discovered working version, e.g. "bitable/2" → 1.
const resolved = new Map<string, number>()
const keyOf = (p: Parsed): string => `${p.service}/${p.ver}`

/** Paths to try, highest→lowest version, starting from the already-discovered version if known.
 *  A path with no `/vN/` segment yields itself once (ver = 0). */
export function versionCandidates(path: string): Array<{ path: string; ver: number }> {
  const p = parseVersion(path)
  if (!p) return [{ path, ver: 0 }]
  const start = resolved.get(keyOf(p)) ?? p.ver
  if (start < 1) return [{ path, ver: 0 }] // defensive: never yield an empty candidate list
  const out: Array<{ path: string; ver: number }> = []
  for (let v = start; v >= 1; v--) out.push({ path: withVersion(p, v), ver: v })
  return out
}

/** Remember the version that actually responded (i.e. that endpoint EXISTS on this instance). */
export function rememberVersion(originalPath: string, ver: number): void {
  const p = parseVersion(originalPath)
  if (p && ver >= 1) resolved.set(keyOf(p), ver)
}

/** Test helper: clear the discovered-version cache. */
export function _resetVersionCache(): void { resolved.clear() }

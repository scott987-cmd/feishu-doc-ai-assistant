/**
 * Shared SKILL library (enterprise) — Phase 1 CLIENT side.
 *
 * The local recipe store (recipes.ts) learns per-device. This lifts it to a SHARED server (the
 * enterprise proxy): every user reports DE-IDENTIFIED successful patterns, the server aggregates +
 * dedups + scores them across all users, and clients pull the community's high-score skills to
 * inject as hints / use as a failure fallback. More users → smarter, fast.
 *
 * PRIVACY: only de-identified data ever leaves the client — an abstract `intent` (the LLM-distilled,
 * data-free lesson, additionally `redactSensitive`-scrubbed) + tool NAMES. No raw task text, no
 * field/table names with business meaning, no values. The proxy computes embeddings server-side.
 *
 * SWITCH: every function no-ops unless `HAS_SKILLS` (VITE_SKILLS_ENABLED=1 AND an oauth proxy is
 * configured). The store/BYO build has no proxy → HAS_SKILLS is always false → zero extra calls,
 * the store release is completely unaffected.
 */
import { BUILD_CONFIG, HAS_SKILLS } from '../config'
import { redactSensitive } from './redact'

/** What the client SENDS after a successful turn (already de-identified). */
export interface SkillObservation {
  resourceKind: string // base / sheet / doc / general
  intent: string       // de-identified abstract intent (lesson-style, no data)
  toolSequence: string[]
  outcome: 'success' | 'undone'
}

/** A community skill the server returns (aggregated + scored across users). */
export interface Skill {
  skillId: string
  level: 'recipe' | 'playbook' // low-level tool chain · high-level auto-synthesized playbook
  resourceKind: string
  intent: string
  toolSequence: string[]
  lesson: string
  score: number
}

const base = (): string => BUILD_CONFIG.oauthProxyUrl.replace(/\/+$/, '')

// Anonymous, per-install random id — lets the server count DISTINCT contributors (heat) without
// any link to the user's identity. Generated once, stored locally; never derived from open_id/PII.
const SRC_KEY = '_skill_src_v1'
let _src: string | null = null
async function srcId(): Promise<string> {
  if (_src) return _src
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([SRC_KEY], (r) => {
        let v = r?.[SRC_KEY] as string | undefined
        if (!v) { v = crypto.randomUUID().replace(/-/g, '').slice(0, 16); chrome.storage.local.set({ [SRC_KEY]: v }) }
        _src = v; resolve(v)
      })
    } catch { resolve('') }
  })
}
const headers = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(BUILD_CONFIG.oauthProxyKey ? { 'X-Proxy-Key': BUILD_CONFIG.oauthProxyKey } : {}),
})
const cleanIntent = (s: string): string => redactSensitive(s || '').trim().slice(0, 200)
const asSkills = (data: unknown): Skill[] => {
  const arr = (data as { skills?: unknown })?.skills
  return Array.isArray(arr) ? (arr as Skill[]).slice(0, 6) : []
}

/** Report a de-identified successful (or undone) pattern. Fire-and-forget, best-effort, no-op off. */
export async function reportSkill(obs: SkillObservation): Promise<void> {
  if (!HAS_SKILLS || !obs.intent?.trim() || !obs.toolSequence?.length) return
  try {
    await fetch(`${base()}/skills/report`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        resourceKind: obs.resourceKind, intent: cleanIntent(obs.intent),
        toolSequence: obs.toolSequence.slice(0, 24), outcome: obs.outcome,
        src: await srcId(),
      }),
    })
  } catch { /* best-effort; never block the turn */ }
}

/** Top relevant community skills for a task — used as a FAILURE FALLBACK + proactive hint. */
export async function matchSkills(q: { resourceKind: string; intent: string }): Promise<Skill[]> {
  if (!HAS_SKILLS || !q.intent?.trim()) return []
  try {
    const res = await fetch(`${base()}/skills/match`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ resourceKind: q.resourceKind, intent: cleanIntent(q.intent), k: 4 }),
    })
    return asSkills(await res.json())
  } catch { return [] }
}

/** Preload top skills for the user's current resource kind (on session / page open). */
export async function preloadSkills(resourceKind: string): Promise<Skill[]> {
  if (!HAS_SKILLS) return []
  try {
    const res = await fetch(`${base()}/skills/preload?kind=${encodeURIComponent(resourceKind || 'general')}`, { headers: headers() })
    return asSkills(await res.json())
  } catch { return [] }
}

/** Format community skills as a prompt hint block (de-identified). Empty when none. */
export function formatSkills(skills: Skill[]): string {
  if (!skills.length) return ''
  const lines = skills.map((s) =>
    `- ${s.level === 'playbook' ? '【套路】' : ''}${s.intent}：${s.lesson}（参考工具链：${s.toolSequence.join(' → ')}）`)
  return '【社区沉淀·高分做法（很多人这样成功，仅供参考；务必按当前真实数据/字段校准，别照搬名称与值）】\n' + lines.join('\n')
}

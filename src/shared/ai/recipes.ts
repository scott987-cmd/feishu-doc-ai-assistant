/**
 * "越用越聪明" — a LOCAL memory of successful operation patterns. After a turn succeeds we
 * record { what the user asked, which tools worked, on what resource kind } and — for a NEW
 * pattern — an LLM-distilled one-line LESSON ("下次这样做最稳"). Recurring patterns just bump
 * a counter (no extra LLM spend). Next time, the most relevant past lessons are fed back into
 * the system prompt so the agent repeats what worked instead of re-discovering it.
 *
 * Privacy & safety: stored only in chrome.storage.local, never sent anywhere except as a
 * prompt hint to (and, for the lesson, distilled by) the user's own configured model. We keep
 * the user's request text + tool NAMES + the distilled lesson only — NEVER table/doc data or
 * tool arguments (the summarizer is given names only). Execution still goes through every
 * security gate, so a recalled recipe can't widen what the agent is allowed to do.
 */
export interface Recipe {
  id: string
  kind: string // base / sheet / doc / wiki / general
  task: string // the user's request (truncated)
  tools: string[] // tool names used, in order
  lesson?: string // LLM-distilled reusable hint (no data); falls back to the tool chain
  count: number // how many times this pattern recurred
  ts: number // last-used epoch ms
}

/** Distill a successful turn into a one-line lesson. Given NAMES only (no data). */
export type Summarizer = (input: { kind: string; task: string; tools: string[] }) => Promise<string>

const KEY = '_learned_recipes_v1'
const MAX_RECIPES = 300
const DUP_SIMILARITY = 0.6

// ─── pure helpers (unit-tested) ───────────────────────────────────────────────

/** Character bigrams over letters/digits — a language-agnostic similarity basis (works
 *  for CJK without word segmentation). */
export function bigrams(s: string): Set<string> {
  const t = (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const g = new Set<string>()
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2))
  if (t.length === 1) g.add(t)
  return g
}

/** Jaccard-ish overlap of two bigram sets in [0,1]. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / Math.min(a.size, b.size)
}

/** Pick the most relevant recipes for a new request on a given resource kind. Pure. */
export function relevantRecipes(all: Recipe[], request: string, kind: string, k = 6): Recipe[] {
  const reqG = bigrams(request)
  return all
    .map((r) => ({ r, score: similarity(reqG, bigrams(r.task)) + (r.kind === kind ? 0.15 : 0) }))
    .filter((x) => x.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.r)
}

/** Merge a freshly-observed pattern into the list (dedup by kind+similar task), then cap
 *  to MAX_RECIPES keeping the most-used / most-recent. Pure — caller persists the result. */
export function mergeRecipe(
  all: Recipe[],
  next: { kind: string; task: string; tools: string[]; lesson?: string },
  newId: () => string,
  now: number,
): Recipe[] {
  const taskG = bigrams(next.task)
  const dup = all.find((r) => r.kind === next.kind && similarity(bigrams(r.task), taskG) >= DUP_SIMILARITY)
  let list: Recipe[]
  if (dup) {
    list = all.map((r) =>
      r === dup
        ? { ...r, count: r.count + 1, ts: now, tools: next.tools.length ? next.tools : r.tools, lesson: next.lesson ?? r.lesson }
        : r,
    )
  } else {
    list = [...all, { id: newId(), kind: next.kind, task: next.task.slice(0, 120), tools: next.tools, lesson: next.lesson, count: 1, ts: now }]
  }
  return list.sort((a, b) => b.count - a.count || b.ts - a.ts).slice(0, MAX_RECIPES)
}

/** Render recipes as a system-prompt section — the distilled lesson when present. */
export function formatRecipes(recipes: Recipe[]): string {
  if (!recipes.length) return ''
  const lines = recipes.map((r) => {
    const how = r.lesson?.trim() || (r.tools.length ? '用过：' + r.tools.join(' → ') : '直接对话')
    return `- 「${r.task}」（${r.kind}，用过 ${r.count} 次）：${how}`
  })
  return '## 过往成功经验（你本人在本机积累的，仅供参考，按当前任务灵活取舍，不要照搬）\n' + lines.join('\n')
}

// ─── storage ──────────────────────────────────────────────────────────────────

function get(): Promise<Recipe[]> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([KEY], (r) => resolve(Array.isArray(r?.[KEY]) ? (r[KEY] as Recipe[]) : []))
    } catch {
      resolve([])
    }
  })
}
function set(list: Recipe[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [KEY]: list }, () => resolve())
    } catch {
      resolve()
    }
  })
}

export const loadRecipes = get

export async function recordRecipe(
  next: { kind: string; task: string; tools: string[] },
  summarize?: Summarizer,
): Promise<void> {
  // Skip trivial follow-ups ("继续"/"好的"/…) — not a meaningful reusable task.
  if (next.task.trim().length < 4 || !next.tools.length) return
  const all = await get()
  // Dedup-first: a recurring pattern just bumps its counter — no LLM spend, and it keeps the
  // lesson already distilled. Only a genuinely NEW pattern is worth summarizing.
  const taskG = bigrams(next.task)
  const isNew = !all.some((r) => r.kind === next.kind && similarity(bigrams(r.task), taskG) >= DUP_SIMILARITY)
  let lesson: string | undefined
  if (isNew && summarize) {
    try { lesson = (await summarize(next)).trim().slice(0, 100) || undefined } catch { /* lesson is optional */ }
  }
  const merged = mergeRecipe(all, { ...next, lesson }, () => crypto.randomUUID(), Date.now())
  await set(merged)
}

export async function clearRecipes(): Promise<void> {
  await set([])
}

export async function recipeCount(): Promise<number> {
  return (await get()).length
}

import type { PageContext } from '../shared/types'

/**
 * Merge a resolved wiki node into the context, but ONLY if the panel is still showing
 * that exact wiki node. Wiki resolution is async (getWikiNode); if the user navigates
 * to another document while a resolution is in flight, the slow result must NOT
 * overwrite the new context — otherwise the session binds to / the assistant operates
 * on the wrong document (H4 race).
 *
 * Returns the context unchanged when it has moved on (different wiki token, or already
 * resolved to a non-wiki resource), so it is safe to call inside setCtx(prev => ...).
 */
export function mergeResolvedWiki(
  current: PageContext,
  wikiToken: string,
  feishu: PageContext['feishu'],
  title?: string,
): PageContext {
  if (current.feishu?.kind !== 'wiki' || current.feishu.wikiToken !== wikiToken) {
    return current // moved on — drop the stale resolution
  }
  return { ...current, title: title || current.title, feishu }
}

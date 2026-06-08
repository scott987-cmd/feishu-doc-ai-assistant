import { feishuReq } from './http'

/**
 * Minimal Task (v2) wrapper so a generated site's per-row quick action can create a task in the
 * current user's Tasks. As the user (user token via the caller). The Task SDK skill is CLI-only.
 */

/** Body for task v2 create — summary (+ optional plain-text description). Pure → unit-tested. */
export function buildTaskBody(summary: string, description?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: summary.slice(0, 256) }
  if (description?.trim()) body.description = description.slice(0, 3000)
  return body
}

/** Create a task in the current user's Tasks. */
export function createTask(token: string, summary: string, description?: string) {
  return feishuReq('POST', '/task/v2/tasks', token, buildTaskBody(summary, description), { user_id_type: 'open_id' })
}

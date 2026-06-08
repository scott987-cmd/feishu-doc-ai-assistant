import { feishuReq } from './http'

/**
 * Minimal IM wrappers (list the user's groups + send a text message) so the AISite panel can
 * push a generated report's link to a group. As the user (user token via the caller). The chat
 * SDK skills are CLI-only and not available in the extension runtime, hence these thin wrappers.
 */

export interface ChatBrief { chatId: string; name: string }

/** Groups the current user belongs to (capped) — for a "发到群" target picker. */
export async function listMyChats(token: string, pageSize = 100): Promise<ChatBrief[]> {
  const res = await feishuReq<{ items?: Array<{ chat_id?: string; name?: string }> }>(
    'GET', '/im/v1/chats', token, undefined, { page_size: String(pageSize) },
  )
  return (res.items ?? [])
    .filter((c) => c.chat_id)
    .map((c) => ({ chatId: c.chat_id as string, name: c.name?.trim() || '(未命名群)' }))
}

/** Build the `content` payload for a plain-text IM message. Pure → unit-tested. */
export function textContent(text: string): string {
  return JSON.stringify({ text })
}

/** Send a plain-text message to a chat (group) by chat_id. */
export function sendText(token: string, chatId: string, text: string) {
  return feishuReq(
    'POST', '/im/v1/messages', token,
    { receive_id: chatId, msg_type: 'text', content: textContent(text) },
    { receive_id_type: 'chat_id' },
  )
}

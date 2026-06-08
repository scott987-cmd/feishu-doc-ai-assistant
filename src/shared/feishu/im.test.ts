import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReq = vi.fn()
vi.mock('./http', () => ({ feishuReq: (...a: unknown[]) => mockReq(...a) }))

const { listMyChats, sendText, textContent } = await import('./im')

describe('textContent', () => {
  it('wraps text as the Feishu text-message content JSON', () => {
    expect(textContent('hi')).toBe('{"text":"hi"}')
  })
  it('keeps newlines (escaped) so multi-line reports send intact', () => {
    expect(JSON.parse(textContent('a\nb')).text).toBe('a\nb')
  })
})

describe('sendText', () => {
  beforeEach(() => mockReq.mockReset())
  it('POSTs to /im/v1/messages with receive_id_type=chat_id and a text payload', () => {
    mockReq.mockResolvedValue({})
    sendText('tok', 'oc_123', '标题\nhttps://x')
    expect(mockReq).toHaveBeenCalledWith(
      'POST', '/im/v1/messages', 'tok',
      { receive_id: 'oc_123', msg_type: 'text', content: '{"text":"标题\\nhttps://x"}' },
      { receive_id_type: 'chat_id' },
    )
  })
})

describe('listMyChats', () => {
  beforeEach(() => mockReq.mockReset())
  it('maps chat_id/name and drops entries without a chat_id', async () => {
    mockReq.mockResolvedValue({ items: [{ chat_id: 'oc_1', name: '群A' }, { name: '无ID' }, { chat_id: 'oc_2', name: '  ' }] })
    const chats = await listMyChats('tok')
    expect(chats).toEqual([{ chatId: 'oc_1', name: '群A' }, { chatId: 'oc_2', name: '(未命名群)' }])
  })
})

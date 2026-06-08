import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReq = vi.fn()
vi.mock('./http', () => ({ feishuReq: (...a: unknown[]) => mockReq(...a) }))

const { buildTaskBody, createTask } = await import('./task')

describe('buildTaskBody', () => {
  it('keeps summary; omits description when blank', () => {
    expect(buildTaskBody('跟进客户A')).toEqual({ summary: '跟进客户A' })
  })
  it('includes a non-blank description', () => {
    expect(buildTaskBody('s', '细节')).toEqual({ summary: 's', description: '细节' })
  })
  it('caps an overlong summary to 256 chars', () => {
    expect((buildTaskBody('x'.repeat(300)).summary as string).length).toBe(256)
  })
})

describe('createTask', () => {
  beforeEach(() => mockReq.mockReset())
  it('POSTs to /task/v2/tasks with the task body', () => {
    mockReq.mockResolvedValue({})
    createTask('tok', '跟进客户A')
    expect(mockReq).toHaveBeenCalledWith('POST', '/task/v2/tasks', 'tok', { summary: '跟进客户A' }, { user_id_type: 'open_id' })
  })
})

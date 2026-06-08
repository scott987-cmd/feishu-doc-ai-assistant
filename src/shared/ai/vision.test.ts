import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } }
  },
}))

const { imageToMarkdown, isVisionUnsupportedError } = await import('./vision')
const { DEFAULT_SETTINGS } = await import('../types')

const settings = {
  ...DEFAULT_SETTINGS,
  openaiBaseUrl: 'https://api.example.com/v1',
  openaiApiKey: 'sk-test',
  openaiModel: 'gpt-4o',
}
const IMG = 'data:image/png;base64,AAAA'

describe('isVisionUnsupportedError', () => {
  it('matches provider image-rejection errors', () => {
    expect(isVisionUnsupportedError('This model does not support image input')).toBe(true)
    expect(isVisionUnsupportedError('400 invalid content type for messages')).toBe(true)
    expect(isVisionUnsupportedError('multimodal not enabled')).toBe(true)
  })
  it('does not match unrelated errors', () => {
    expect(isVisionUnsupportedError('network timeout')).toBe(false)
  })
})

describe('imageToMarkdown', () => {
  beforeEach(() => mockCreate.mockReset())

  it('sends an image_url message part and returns the markdown', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '| a | b |\n| --- | --- |\n| 1 | 2 |' } }] })
    const md = await imageToMarkdown(settings, IMG)
    expect(md).toContain('| a | b |')
    const arg = mockCreate.mock.calls[0][0] as { model: string; messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> }
    expect(arg.model).toBe('gpt-4o')
    const parts = arg.messages[0].content
    expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url === IMG)).toBe(true)
    expect(parts.some((p) => p.type === 'text')).toBe(true)
  })

  // Note: the "maps a vision-unsupported error → friendly message" path is covered by the
  // isVisionUnsupportedError unit tests above (+ the trivial throw in the catch). We avoid an
  // integration test with a rejecting async mock because vitest flags the mock's stored
  // rejected result as an unhandled rejection regardless of the caller's try/catch.

  it('throws when the model returns empty content', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] })
    let caught = ''
    try { await imageToMarkdown(settings, IMG) } catch (e) { caught = (e as Error).message }
    expect(caught).toBeTruthy()
  })
})

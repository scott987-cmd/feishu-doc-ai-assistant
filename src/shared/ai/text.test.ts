import { describe, it, expect } from 'vitest'
import { stripFences } from './text'

describe('stripFences', () => {
  it('strips ```json … ``` (the JSON variant)', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('strips ```markdown / ```md / bare ``` (the prose variants)', () => {
    expect(stripFences('```markdown\n# Hi\n```')).toBe('# Hi')
    expect(stripFences('```md\nx\n```')).toBe('x')
    expect(stripFences('```\ncode\n```')).toBe('code')
  })
  it('strips any other language tag (js/text/…) — the whole point of one shared helper', () => {
    expect(stripFences('```js\nf()\n```')).toBe('f()')
  })
  it('leaves un-fenced content untouched', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}')
    expect(stripFences('  hello  ')).toBe('hello')
  })
})

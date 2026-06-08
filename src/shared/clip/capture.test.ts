// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { captureClip } from './capture'

const MAX = 50_000

beforeEach(() => {
  document.title = 'Attendance Docs'
  document.body.innerHTML = `
    <nav>导航不应被抓取 NAVNAV</nav>
    <article>
      ${'考勤记录管理：姓名、工号、日期、状态。'.repeat(20)}
      <form><input type="password" value="SUPERSECRET123" /><input name="user" value="alice" /></form>
    </article>
    <script>var leak = "SCRIPTLEAK"</script>
    <footer>页脚 FOOTERFOOTER</footer>`
})
afterEach(() => { vi.restoreAllMocks() })

describe('captureClip — page-world capture', () => {
  it('returns a well-formed ClipCapture (url/title/timestamp)', () => {
    const clip = captureClip(MAX)
    expect(typeof clip.url).toBe('string')
    expect(clip.title).toBe('Attendance Docs')
    expect(clip.capturedAt).toBeGreaterThan(0)
    expect(clip.truncated).toBe(false)
  })

  it('captures the article body but NOT password values, scripts, nav, or footer', () => {
    const clip = captureClip(MAX)
    expect(clip.content).toContain('考勤记录管理')
    expect(clip.content).not.toContain('SUPERSECRET123') // input values never captured
    expect(clip.content).not.toContain('SCRIPTLEAK')      // <script> stripped
    expect(clip.content).not.toContain('NAVNAV')          // <nav> stripped
    expect(clip.content).not.toContain('FOOTERFOOTER')    // <footer> stripped
  })

  it('uses the user selection when there is one', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '  选中的一段文字  ' } as unknown as Selection)
    const clip = captureClip(MAX)
    expect(clip.selectedText).toBe('选中的一段文字')
  })

  it('serializes an HTML table to a Markdown table (preserves rows/columns)', () => {
    document.body.innerHTML = `
      <table>
        <tr><th>名称</th><th>代码</th><th>价格</th></tr>
        <tr><td>谷歌</td><td>GOOG</td><td>$372.58</td></tr>
        <tr><td>苹果</td><td>AAPL</td><td>$201.00</td></tr>
      </table>`
    const clip = captureClip(MAX)
    expect(clip.content).toContain('| 名称 | 代码 | 价格 |')
    expect(clip.content).toMatch(/\|\s*---\s*\|/)            // separator row
    expect(clip.content).toContain('| 谷歌 | GOOG | $372.58 |')
    expect(clip.content).toContain('| 苹果 | AAPL | $201.00 |') // every row kept, not flattened
  })

  it('serializes an ARIA grid (role=table/row/cell) to Markdown', () => {
    document.body.innerHTML = `
      <div role="table">
        <div role="row"><div role="columnheader">A</div><div role="columnheader">B</div></div>
        <div role="row"><div role="cell">1</div><div role="cell">2</div></div>
      </div>`
    const clip = captureClip(MAX)
    expect(clip.content).toContain('| A | B |')
    expect(clip.content).toContain('| 1 | 2 |')
  })

  it('reconstructs an ag-Grid (separate header, col-id alignment)', () => {
    document.body.innerHTML = `
      <div class="ag-root">
        <div class="ag-header">
          <div class="ag-header-cell" col-id="name">名称</div>
          <div class="ag-header-cell" col-id="code">代码</div>
          <div class="ag-header-cell" col-id="px">价格</div>
        </div>
        <div class="ag-body">
          <div class="ag-row"><div class="ag-cell" col-id="name">谷歌</div><div class="ag-cell" col-id="code">GOOG</div><div class="ag-cell" col-id="px">$372.58</div></div>
          <div class="ag-row"><div class="ag-cell" col-id="px">$201.00</div><div class="ag-cell" col-id="name">苹果</div><div class="ag-cell" col-id="code">AAPL</div></div>
        </div>
      </div>`
    const clip = captureClip(MAX)
    expect(clip.content).toContain('| 名称 | 代码 | 价格 |')
    expect(clip.content).toContain('| 谷歌 | GOOG | $372.58 |')
    expect(clip.content).toContain('| 苹果 | AAPL | $201.00 |') // 2nd row's cells were out of order → realigned by col-id
  })

  it('detects a plain <div> grid with no semantic markup (repeated-row heuristic)', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      `<div class="row"><div>名${i}</div><div>C${i}</div><div>$${i}.00</div></div>`).join('')
    document.body.innerHTML = `<div class="grid">${rows}</div>`
    const clip = captureClip(MAX)
    expect(clip.content).toContain('| 名0 | C0 | $0.00 |')
    expect(clip.content).toContain('| 名5 | C5 | $5.00 |')
  })

  it('drops all-empty columns (e.g. a checkbox/select column)', () => {
    document.body.innerHTML = `
      <table>
        <tr><th>名称</th><th>价格</th><th>选取</th></tr>
        <tr><td>谷歌</td><td>$372</td><td></td></tr>
        <tr><td>苹果</td><td>$306</td><td></td></tr>
      </table>`
    const clip = captureClip(MAX)
    expect(clip.content).toContain('| 名称 | 价格 |')
    expect(clip.content).not.toContain('选取') // empty column removed
  })

  it('caps oversized content and flags truncated', () => {
    document.body.innerHTML = `<article>${'x'.repeat(200_000)}</article>`
    const clip = captureClip(100)
    expect(clip.content.length).toBe(100)
    expect(clip.truncated).toBe(true)
  })
})

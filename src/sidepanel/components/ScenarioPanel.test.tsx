// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { PageContext } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import ScenarioPanel from './ScenarioPanel'

afterEach(cleanup)

const ctx: PageContext = { url: '', title: '', selectedText: '' }
const settings = { ...DEFAULT_SETTINGS, templateRegistryUrl: '' }

// The build-time default registry may be set, so the panel briefly shows skeletons
// while the (offline, failing) remote fetch settles — wait for real builtin cards.
const realCard = (c: HTMLElement) => c.querySelector('.sc-card:not(.sc-card--skeleton)') as HTMLElement | null
// The 场景 tab lands on a grouped feature hub; the template gallery is reached via the
// 「场景模版库」entry card (now in its own 搭建/建库 group, so target it by label, not position).
const enterGallery = (c: HTMLElement) => {
  const card = Array.from(c.querySelectorAll('.sc-hub-card--entry'))
    .find((el) => el.textContent?.includes('场景模版库')) as HTMLElement
  fireEvent.click(card)
}

describe('ScenarioPanel — feature hub + template gallery', () => {
  it('lands on the hub with a template-library entry', () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} />)
    expect(container.querySelector('.sc-hub-card--entry')).toBeTruthy()
  })

  it('renders builtin template cards in the gallery', async () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} />)
    enterGallery(container)
    await waitFor(() => expect(realCard(container)).toBeTruthy())
  })

  it('clicking anywhere on a card enters the detail/config view', async () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} />)
    enterGallery(container)
    await waitFor(() => expect(realCard(container)).toBeTruthy())
    fireEvent.click(realCard(container)!)
    expect(container.querySelector('.sc-detail-title')).toBeTruthy()
  })

  it('detail is reachable even when disabled (browsing not gated), but 创建 is blocked', async () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={true} />)
    enterGallery(container)
    await waitFor(() => expect(realCard(container)).toBeTruthy())
    fireEvent.click(realCard(container)!)
    expect(container.querySelector('.sc-detail-title')).toBeTruthy()
    expect((container.querySelector('.btn-create') as HTMLButtonElement).disabled).toBe(true)
  })

  // ── Context-aware hub: features that don't fit the current page are dimmed, not hidden ──
  const groupOf = (c: HTMLElement, title: string) =>
    Array.from(c.querySelectorAll('.sc-hub-group')).find((g) => g.textContent?.includes(title)) as HTMLElement

  it('on a Base page, table-feature groups are active and the 文档处理 group is dimmed', () => {
    const baseCtx: PageContext = { url: '', title: '', selectedText: '', feishu: { isBase: true, kind: 'base', appToken: 'x' } }
    const { container } = render(<ScenarioPanel settings={settings} context={baseCtx} disabled={false} />)
    expect(container.querySelector('.sc-hub-status')?.textContent).toContain('多维表格')
    expect(groupOf(container, '把数据做成页面').className).not.toContain('sc-hub-group--dim')
    expect(groupOf(container, '数据加工与分析').className).not.toContain('sc-hub-group--dim')
    expect(groupOf(container, '文档处理').className).toContain('sc-hub-group--dim')
  })

  it('on a Doc page, the 文档处理 group is active and the table groups are dimmed', () => {
    const docCtx: PageContext = { url: '', title: '', selectedText: '', feishu: { isBase: false, kind: 'doc', documentId: 'd' } }
    const { container } = render(<ScenarioPanel settings={settings} context={docCtx} disabled={false} />)
    expect(container.querySelector('.sc-hub-status')?.textContent).toContain('飞书文档')
    expect(groupOf(container, '文档处理').className).not.toContain('sc-hub-group--dim')
    expect(groupOf(container, '把数据做成页面').className).toContain('sc-hub-group--dim')
  })

  it('off a Feishu resource, nothing is dimmed (we can\'t tell what the page is)', () => {
    const { container } = render(<ScenarioPanel settings={settings} context={ctx} disabled={false} />)
    expect(container.querySelector('.sc-hub-status')).toBeFalsy()
    expect(container.querySelector('.sc-hub-group--dim')).toBeFalsy()
  })
})

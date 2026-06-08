// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog'
import ChoiceDialog from './ChoiceDialog'

afterEach(cleanup)

describe('ConfirmDialog — dismissable + choices', () => {
  const req = { kind: 'create_base' as const, appName: '项目管理', currentApp: 'app1', currentBaseName: '当前库' }

  it('picking 新建独立 Base resolves "new"', () => {
    const onChoose = vi.fn()
    render(<ConfirmDialog req={req} onChoose={onChoose} />)
    fireEvent.click(screen.getByText('新建独立 Base'))
    expect(onChoose).toHaveBeenCalledWith('new')
  })

  it('✕ button cancels', () => {
    const onChoose = vi.fn()
    render(<ConfirmDialog req={req} onChoose={onChoose} />)
    fireEvent.click(screen.getByTitle('关闭'))
    expect(onChoose).toHaveBeenCalledWith('cancel')
  })

  it('Escape key cancels', () => {
    const onChoose = vi.fn()
    render(<ConfirmDialog req={req} onChoose={onChoose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onChoose).toHaveBeenCalledWith('cancel')
  })

  it('warns when open_id (owner) is not configured', () => {
    render(<ConfirmDialog req={{ ...req, ownerConfigured: false }} onChoose={vi.fn()} />)
    expect(screen.getByText(/只能查看、不能编辑/)).toBeTruthy()
  })
})

describe('ChoiceDialog (ask_user) — selectable + dismissable', () => {
  const req = { question: '用哪种字段？', options: [{ label: '单选' }, { label: '多选', description: '可多个' }] }

  it('clicking an option resolves its label', () => {
    const onChoose = vi.fn(); const onCancel = vi.fn()
    render(<ChoiceDialog req={req} onChoose={onChoose} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('多选'))
    expect(onChoose).toHaveBeenCalledWith('多选')
  })

  it('取消 button dismisses', () => {
    const onCancel = vi.fn()
    render(<ChoiceDialog req={req} onChoose={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Escape dismisses', () => {
    const onCancel = vi.fn()
    render(<ChoiceDialog req={req} onChoose={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

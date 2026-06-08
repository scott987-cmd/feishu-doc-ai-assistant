import type { ConfirmRequest, ConfirmChoice } from '../../shared/ai/agent'
import { useEscapeToClose } from './useEscapeToClose'
import './ConfirmDialog.css'

interface Props {
  req: ConfirmRequest
  onChoose: (choice: ConfirmChoice) => void
}

export default function ConfirmDialog({ req, onChoose }: Props) {
  const hasCurrent = !!req.currentApp
  useEscapeToClose(() => onChoose('cancel'))
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={() => onChoose('cancel')}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <button className="confirm-x" onClick={() => onChoose('cancel')} title="关闭">✕</button>
        <div className="confirm-icon">🆕</div>
        <h3 className="confirm-title">要新建一个 Base 吗？</h3>
        <p className="confirm-msg">
          助手准备新建独立的 Base「<b>{req.appName}</b>」。
          {hasCurrent && (
            <>
              <br />
              当前页面是 Base「{req.currentBaseName || '未命名'}」—— 也可以把表加到这里。
            </>
          )}
        </p>
        {req.ownerConfigured === false && (
          <p className="confirm-warn">
            ⚠️ 你尚未授权账号（未配置 open_id）。新建的 Base 将归应用所有，
            <b>你只能查看、不能编辑</b>。建议先到「设置 → 飞书鉴权」用飞书账号授权。
          </p>
        )}
        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn--primary" onClick={() => onChoose('new')}>
            新建独立 Base
          </button>
          {hasCurrent && (
            <button className="confirm-btn confirm-btn--secondary" onClick={() => onChoose('current')}>
              加到当前 Base
            </button>
          )}
          <button className="confirm-btn confirm-btn--ghost" onClick={() => onChoose('cancel')}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

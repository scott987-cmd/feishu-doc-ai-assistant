import type { AskUserRequest } from '../../shared/ai/agent'
import { useEscapeToClose } from './useEscapeToClose'
import './ConfirmDialog.css'

interface Props {
  req: AskUserRequest
  onChoose: (label: string) => void
  /** Dismiss without choosing (Esc / overlay / ✕ / 取消). */
  onCancel: () => void
}

/** Agent-driven choice card (the ask_user tool): the LLM supplies the question + options. */
export default function ChoiceDialog({ req, onChoose, onCancel }: Props) {
  useEscapeToClose(onCancel)
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm-card view-enter" onClick={(e) => e.stopPropagation()}>
        <button className="confirm-x" onClick={onCancel} title="关闭">✕</button>
        <div className="confirm-icon">🤔</div>
        <h3 className="confirm-title">{req.question}</h3>
        <div className="confirm-actions">
          {req.options.map((o, i) => (
            <button
              key={i}
              className="confirm-btn confirm-btn--secondary choice-btn"
              onClick={() => onChoose(o.label)}
            >
              <span className="choice-label">{o.label}</span>
              {o.description && <span className="choice-desc">{o.description}</span>}
            </button>
          ))}
          <button className="confirm-btn confirm-btn--ghost" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { preloadSkills, type Skill } from '../../shared/ai/skills'

/**
 * 主动推送：进入某类资源（base/sheet/doc）的新会话时，预加载社区「高分做法」，做成可点 chip。
 * 点一下把该做法填进输入框（用户复核后再发，不自动执行）。一个会话里关掉就不再打扰。
 *
 * 开关：preloadSkills 在 HAS_SKILLS 关时直接返回 []（store/BYO 无 proxy → 永远空）→ 本组件渲染
 * null，零网络、零影响。仅 enterprise+proxy 才会真正拉取。
 */
export default function SkillSuggest({
  resourceKind, show, onPick,
}: {
  resourceKind: string
  /** 仅在新/空会话时主动推送，避免持续占位打扰。 */
  show: boolean
  onPick: (text: string) => void
}) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [dismissed, setDismissed] = useState(false)
  // 同一资源类型只拉一次；切换类型重拉。
  const loadedKind = useRef<string>('')

  useEffect(() => {
    if (!show || loadedKind.current === resourceKind) return
    loadedKind.current = resourceKind
    let alive = true
    void preloadSkills(resourceKind).then((s) => { if (alive) setSkills(s) })
    return () => { alive = false }
  }, [resourceKind, show])

  if (!show || dismissed || !skills.length) return null

  return (
    <div className="skill-suggest" role="group" aria-label="社区常用做法">
      <span className="skill-suggest-lead" title="很多人这样做成功了，点一下填入输入框，按你的真实数据改改再发">
        💡 大家常用
      </span>
      <div className="skill-suggest-chips">
        {skills.slice(0, 4).map((s) => (
          <button
            key={s.skillId}
            className={`skill-chip${s.level === 'playbook' ? ' skill-chip--playbook' : ''}`}
            onClick={() => onPick(s.lesson || s.intent)}
            title={`${s.lesson || s.intent}${s.toolSequence?.length ? `（参考：${s.toolSequence.join(' → ')}）` : ''}`}
          >
            {s.level === 'playbook' ? '🧩 ' : ''}{s.intent}
          </button>
        ))}
      </div>
      <button className="skill-suggest-x" onClick={() => setDismissed(true)} title="不再提示">×</button>
    </div>
  )
}

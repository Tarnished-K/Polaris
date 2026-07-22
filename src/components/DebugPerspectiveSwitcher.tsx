import { useState } from 'react'

import type { Member } from '../domain/types'

interface DebugPerspectiveSwitcherProps {
  members: Member[]
  currentMemberId: string | null
  onChange: (memberId: string) => void
}

export function DebugPerspectiveSwitcher({ members, currentMemberId, onChange }: DebugPerspectiveSwitcherProps) {
  const [expanded, setExpanded] = useState(false)
  const current = members.find((member) => member.id === currentMemberId)
  return (
    <aside className={`debug-perspective ${expanded ? 'is-expanded' : ''}`} aria-label="デバッグ用の視点切り替え">
      <button
        type="button"
        className="debug-perspective__toggle"
        aria-expanded={expanded}
        aria-controls="debug-perspective-panel"
        onClick={() => setExpanded((currentValue) => !currentValue)}
      >
        <span aria-hidden="true">視</span>
        <strong>{current?.name ?? '未選択'}</strong>
        <i aria-hidden="true">{expanded ? '×' : '＋'}</i>
      </button>
      <div id="debug-perspective-panel" className="debug-perspective__panel" hidden={!expanded}>
        <div>
          <span>テスト視点</span>
          <strong>{current?.isOrganizer ? '幹事として確認' : '参加者として確認'}</strong>
        </div>
        <select value={currentMemberId ?? ''} onChange={(event) => onChange(event.target.value)} aria-label="確認する参加者">
          {members.map((member) => (
            <option value={member.id} key={member.id}>{member.name}（{member.isOrganizer ? '幹事' : '参加者'}）</option>
          ))}
        </select>
      </div>
    </aside>
  )
}

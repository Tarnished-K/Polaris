import type { Member } from '../domain/types'

interface DebugPerspectiveSwitcherProps {
  members: Member[]
  currentMemberId: string | null
  onChange: (memberId: string) => void
}

export function DebugPerspectiveSwitcher({ members, currentMemberId, onChange }: DebugPerspectiveSwitcherProps) {
  const current = members.find((member) => member.id === currentMemberId)
  return (
    <aside className="debug-perspective" aria-label="デバッグ用の視点切り替え">
      <div>
        <span>テスト視点</span>
        <strong>{current?.name ?? '未選択'}・{current?.isOrganizer ? '幹事' : '参加者'}</strong>
      </div>
      <select value={currentMemberId ?? ''} onChange={(event) => onChange(event.target.value)} aria-label="確認する参加者">
        {members.map((member) => (
          <option value={member.id} key={member.id}>{member.name}（{member.isOrganizer ? '幹事' : '参加者'}）</option>
        ))}
      </select>
    </aside>
  )
}

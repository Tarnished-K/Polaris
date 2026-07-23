import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DebugPerspectiveSwitcher } from './DebugPerspectiveSwitcher'

describe('DebugPerspectiveSwitcher', () => {
  it('keeps the development-only perspective and reset controls available', () => {
    const markup = renderToStaticMarkup(
      <DebugPerspectiveSwitcher
        members={[
          { id: 'organizer', name: 'Organizer', isOrganizer: true },
          { id: 'participant', name: 'Participant' },
        ]}
        currentMemberId="organizer"
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(markup).toContain('デバッグ用の視点切り替え')
    expect(markup).toContain('テスト視点')
    expect(markup).toContain('確認する参加者')
    expect(markup).toContain('最初から')
  })
})

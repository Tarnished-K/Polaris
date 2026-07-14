interface TestResetButtonProps {
  onReset: () => void
}

/** TODO: Remove this temporary control before the public release. */
export function TestResetButton({ onReset }: TestResetButtonProps) {
  const reset = () => {
    if (
      window.confirm(
        'テスト用リセットです。この端末のイベントデータを消して最初からやり直しますか？',
      )
    ) {
      onReset()
    }
  }

  return (
    <button
      type="button"
      className="test-reset-button"
      aria-label="テスト用: イベントをリセットして最初からやり直す"
      onClick={reset}
    >
      <span>TEST</span>
      最初から
    </button>
  )
}

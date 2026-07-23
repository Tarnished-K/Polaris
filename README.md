# Warikan Web

旅行や飲み会の支出を、1つの共有URLで記録・割り勘・精算するWebアプリです。

Supabase接続時は共有URL、参加、支出、精算、Realtime同期までクラウドで動作します。Supabase未設定時やデモ表示では、従来どおり`localStorage`だけでも主要画面を試せます。

## 開発

```bash
npm install
npm run dev
```

- 開発サーバー: `http://localhost:5173`
- 単体テスト: `npm test`
- 本番ビルド: `npm run build`

## Performance

初回表示をDesktop 1280px／Mobile 390pxでLighthouse計測し、初回JS/CSSと遅延ロード画面のチャンクサイズも合わせて回帰確認します。

```bash
# LIGHTHOUSE_BASELINES.jsonと比較（10%超で警告、20%超で失敗）
npm run audit:lighthouse

# 意図した性能変化を確認した後だけ基準値を更新
npm run audit:lighthouse:update
```

毎回の詳細値はgit管理外の`lighthouse-results.json`へ出力され、CIではartifactとして7日間保存されます。`LIGHTHOUSE_BASELINES.json`を更新する場合は、差分に初回JS/CSS、設定・ダッシュボード・精算チャンク、FCP/LCP/CLSの変化が妥当な理由を残してください。

## バックエンド

Dockerなしの軽量検証:

```bash
npm run backend:validate

# 任意: 作業完了報告をClaude CLIへ送り、次の作業指示を受け取る
powershell -ExecutionPolicy Bypass -File scripts/report-to-claude.ps1 -Report "実施内容と検証結果"
```

リンク済みSupabaseからDB型を再生成（migration変更後に実行）:

```bash
npm run backend:types
npm run build
```

生成先は`src/backend/database.types.ts`です。テーブル・enum・RPC名と引数は生成型を正とし、`jsonb_build_object`で返す画面向けJSON契約は`src/backend/types.ts`のドメイン型で補完します。

Docker Desktop導入後のSupabase完全検証:

```bash
npm run backend:start
npm run backend:reset
npm run backend:test
npm run backend:lint
```

詳しくは `supabase/README.md` を参照してください。

## 仕様とデザイン

- 実装仕様: `Warikan/kanji-app-spec.md`
- デザインリファレンス: `Warikan/割り勘アプリUIデザイン.html`
- デザイン比較: `Warikan/Warikan UI Options-print.dc.html.pdf`

機能・権限・計算ロジックは実装仕様を優先し、見た目はモバイルの「2a統合版」とPCの「3aブラウザ版」を基準にします。

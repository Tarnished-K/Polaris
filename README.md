# Warikan Web

旅行や飲み会の支出を、1つの共有URLで記録・割り勘・精算するWebアプリです。

現在の画面は `localStorage` で試せます。Supabaseの初期スキーマ、RLS、主要RPC、通知outboxと型付きクライアント境界も実装済みで、次の段階で画面の状態層をRPCへ接続します。

## 開発

```bash
npm install
npm run dev
```

- 開発サーバー: `http://localhost:5173`
- 単体テスト: `npm test`
- 本番ビルド: `npm run build`

## バックエンド

Dockerなしの軽量検証:

```bash
npm run backend:validate
```

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

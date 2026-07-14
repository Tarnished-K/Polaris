# Warikan backend

## 現在の範囲

- イベント、参加者、支出、精算スナップショット、監査ログ
- LINE／Discord接続先、外部ユーザー対応、通知outbox、配信履歴
- 幹事はSupabase Auth、参加者は `share_token + device_token` のSHA-256ハッシュで識別
- `anon` のテーブル直接操作は拒否し、参加者操作は `security definer` RPCだけを公開
- `get_event_state` は現在のフロント型に合わせたcamelCase JSONを返す

実装済みRPC:

- `create_event`
- `get_event_state`
- `join_event`
- `organizer_add_member`
- `organizer_issue_claim_token`
- `claim_member`
- `organizer_update_event`
- `organizer_remove_member`
- `add_expense`
- `update_expense` / `delete_expense`
- `save_own_fixed_amount` / `finalize_expense`
- `finalize_event` / `unfinalize_event`
- `report_settlement` / `confirm_settlement` / `revert_settlement`
- `organizer_upsert_integration`
- `organizer_queue_notification`

相手ごとの精算生成はフロントと同じく、確定済み支出をペアごとに集約し、反対方向を差し引いて内訳を保存する。暫定支出が残っている間はイベントを確定できない。

## 検証

Dockerがない環境でも、PGliteでマイグレーション構文と主要フローを検証できる。

```bash
npm run backend:validate
```

Supabase CLIの完全なローカルスタックにはDocker Desktopが必要。

```bash
npm run backend:start
npm run backend:reset
npm run backend:test
npm run backend:lint
```

pgTAPの結合・契約テストは `tests/database/` にある。Dockerなしの検証では、支出途中保存、編集、精算確定、報告、確認、取り消し、確定解除まで実際に実行する。

## 環境変数

`.env.example` を `.env.local` へコピーし、ローカルまたはクラウドプロジェクトの値を設定する。

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

秘密鍵やservice role keyをVite環境変数へ入れてはいけない。通知の実配送は将来のEdge Functionまたは専用workerからservice roleでoutboxを処理する。

## 通知設計

イベントごとにBotプロセスを作らず、共通Botと外部スペースを `event_integrations` でイベントへ紐付ける。アプリ本体は `notification_jobs` に送信意図を記録し、LINE／Discord固有の送信処理は別adapterで実行する。`dedupe_key` により同一リマインドの重複送信を防ぐ。

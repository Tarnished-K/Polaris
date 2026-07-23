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
- `get_payment_state` / `upsert_payment_profile` / `set_settlement_payment_link`
- `schedule_settlement_reminders`
- `get_settlement_status_for_bot`（service role限定）
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

秘密鍵やservice role keyをVite環境変数へ入れてはいけない。通知の実配送は`notification-dispatcher`、読み取り専用BOT照会は`event-assistant` Edge Functionがservice roleで処理する。

## クラウドプロジェクト

- Project name: `Warikan`
- Project ref: `nrixujdkgvexnnqfoned`
- 2026-07-14時点で4本のマイグレーションを適用済み
- フロントはpublishable keyのみを使用する

Googleログインを有効化するには、Google Cloud OAuthクライアントの承認済みリダイレクトURIへ次を登録し、Supabase DashboardのGoogle providerへClient ID / Secretを設定する。

```text
https://nrixujdkgvexnnqfoned.supabase.co/auth/v1/callback
```

## 通知設計

イベントごとにBotプロセスを作らず、共通Botと外部スペースを `event_integrations` でイベントへ紐付ける。アプリ本体は `notification_jobs` に送信意図を記録し、LINE／Discord固有の送信処理は別adapterで実行する。`dedupe_key` により同一リマインドの重複送信を防ぐ。

精算確定、支払い報告、受取確認、全員完了はDBの状態遷移から自動的にoutboxへ追加する。幹事の催促は`pending`の精算だけを対象とし、同じ精算・通知先への登録は1日1回まで。`reported`と`paid`は対象外。

共有URLのdeep linkは次の形に統一する。device token、claim token、外部アカウントIDは含めない。

```text
https://polaris-warikan.netlify.app/e/{shareToken}?view=payment
https://polaris-warikan.netlify.app/e/{shareToken}?view=payment&settlement={settlementId}
https://polaris-warikan.netlify.app/e/{shareToken}?view=settlement&settlement={settlementId}
```

`event-assistant`の前半実装は、内部adapterから`x-assistant-key`で呼ぶ読み取り専用`status`契約だけを公開する。`ASSISTANT_INTERNAL_KEY`はSupabase Function secretに置き、クライアントへ渡さない。LINE／Discordから直接受ける署名検証済みWebhookと、外部アカウント紐付け後の状態変更は後半実装で追加する。

外部アカウント連携は支払い画面で発行する8桁コードを5分・1回限りで使用する。DBにはコードのSHA-256と、Edge Functionで生成したprovider別HMACだけを保存し、LINE／DiscordユーザーIDの平文は保存しない。Webhookはprovider event IDで重複排除し、外部アカウントごとに5分10回へ制限する。

必要なSupabase Function secrets:

```text
EXTERNAL_ACCOUNT_HMAC_KEY=十分に長いランダム値
ASSISTANT_INTERNAL_KEY=十分に長い別のランダム値
LINE_CHANNEL_SECRET=LINE Developersで発行されたChannel secret
LINE_CHANNEL_ACCESS_TOKEN=LINE Developersで発行されたChannel access token
DISCORD_APPLICATION_PUBLIC_KEY=Discord Applicationの公開鍵（hex）
INTEGRATION_ENCRYPTION_KEY=既存Discord Webhook暗号化鍵
```

`EXTERNAL_ACCOUNT_HMAC_KEY`と`ASSISTANT_INTERNAL_KEY`を共用しない。いずれも`VITE_*`、`.env.production`、Git、通知payload、activity logへ入れない。

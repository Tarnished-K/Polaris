# Polaris(幹事アプリ / Warikan)開発ロードマップ — Codex向け

最終更新: 2026-07-23
対象読者: このリポジトリで作業するCodex(実装エージェント)。人間のオーナー向けの説明は含まない。すべてのタスクは既存コードを直接確認した上で記載している。着手前に該当ファイルを実際に読み、本書の記載と現状にズレがないか必ず確認すること。

---

## 0. このドキュメントの使い方

- 本書は上から順に着手する前提のフェーズ構成になっている。フェーズ番号は依存関係の順序であり、優先度の絶対順ではない(例: フェーズ0.5は並行着手可能)。
- 各フェーズには「やること」「受け入れ条件」「検証コマンド」を記載する。受け入れ条件を満たさない実装はマージしない。
- 「未解決の設計判断」セクションに列挙した項目は、着手前に必ず決定してからコードを書くこと。決定した内容は本書または`HANDOFF.md`に追記すること。
- 末尾の「バックログ」は着手承認待ちの機能。フェーズ番号がついていないものはユーザーの明示的な指示があるまで着手しないこと。

**2026-07-23総括**: コードで完結するフェーズ0〜8とバックログ6.1〜6.3は実装済み。独立した「支払い・受け取り」導線をフェーズ8として実装し、LINE／Discordを通知からイベントアシスタントへ拡張するフェーズ9は通知ライフサイクル、未払い催促、安全な読み取り専用状況照会まで完了した。従来の外部環境依存残件（実機PWA・オフライン復帰、実Sentryイベント、実Discord／LINE配送、Supabase WAF／Rate Limiting）は`HANDOFF.md`で別管理し、推測で完了扱いにしない。

---

## 1. プロダクト概要と恒久的な制約

### 1.1 コンセプト

グループイベント(飲み会・旅行)の割り勘・立て替え精算アプリ。幹事がイベントを作成しURLを共有、参加者はログイン不要でブラウザから参加する。

北極星: **「幹事業務が1つのURLで完結する」**。幹事の仕事は ①日程調整 → ②場所決め → ③出欠確定 → ④当日 → ⑤集金・精算 というパイプラインであり、現状は調整さん・LINE・PayPay等を行き来している。本アプリはこれを1イベント=1URLに統合する。ただし入口は⑤の精算で、v1は精算だけで独立して価値が成立する設計とする。

飲み会と旅行は別モードにしない。イベントの期間タイプ(終日 / 宿泊)がUIの複雑さを決める単一のデータモデルで両対応する。カテゴリはイベント作成時に事前選択せず、支出を追加するたびに全カテゴリから選ぶ。

対象通貨はJPYのみ(整数・円単位)。個人開発・低コスト運用が前提。

### 1.2 プロダクトロードマップ(仕様書由来、本書のフェーズ番号とは別軸)

- **v1**: 精算エンジン / 共有URL参加(デバイス紐付け) / 済管理・催促文生成
- **v1.5**: 日程調整・出欠(調整さん代替、eventsに候補日テーブルが増える想定) / リマインド(当面はコピペ用文面生成、LINE公式API連携はしない) / 傾斜割りプリセット(「先輩多め」「幹事無料」等。split_methodに'weighted'系の値が追加される想定 → 拡張しやすい設計にしておくこと)
- **v2(課金開始)**: レシートOCR(撮影で金額入力、Claude API vision使用) / Proプラン。PayPay等への外部送金導線は、ユーザー判断により課金前のフェーズ8へ前倒しする。ただし送金処理そのものは行わない。

### 1.3 恒久的な制約(変更する場合は要相談。実装時に絶対に破らないこと)

- **アプリ内で送金・決済・資金の預かりを行わない**。実装すると資金決済法の資金移動業ライセンスが必要になる。本アプリは記録・計算・可視化に徹し、実送金は外部(PayPay・現金等)に委ねる。これはv2以降も不変。
- **参加者はアカウントレス**。参加者に登録・インストールを要求しない。参加者体験は「URLを開いて名前をタップ」以上に重くしない。
- **精算は相手ごとに自動集約し手動設定不可**。同じ相手との複数支出をまとめ、反対方向の立て替えを差し引いた純額だけを支払う。差し引き前後の支出内訳と計算式を必ず表示する。
- **端数は支払者負担**。「誰か1人だけ1円多い」より説明しやすく、計算が決定的になる。
- **やらないことリスト(恒久)**: チャット機能(LINEと競合しない・共存する)、決済代行、店・宿の予約API連携(リンク共有で十分)。
- **精算金額は読み取り専用**。手入力での上書きは実装しない。
- **他人視点への切替UIは実装しない**(本番機能として。デバッグ用の視点切替はテスト目的でのみ存在し、リリース前に削除する)。

---

## 2. 現状のアーキテクチャ(実地検証済みの事実)

以下はリポジトリを実際にクローン・ビルド・実行して確認した内容。推測は含まない。

### 2.1 リポジトリとブランチの状態

- リポジトリ: `https://github.com/Tarnished-K/Polaris`
- `main`ブランチの直近コミットは`abc75f2`(2026-07-23、PR #1 "Improve settlement and dashboard UI"のマージコミット)。
- 精算画面のUI改善作業はPR #1として`main`へマージ済み。フェーズ4の内容と関係マップを含むUI改善は、以後`main`を基準に回帰確認する。

### 2.2 フロントエンド技術スタック

- React 19 / TypeScript 7 / Vite 8 / Vitest 4
- `vite-plugin-pwa`(Service Worker自動生成、`registerType: 'autoUpdate'`)
- ルーティングライブラリは未使用。`src/App.tsx`が`AppView = 'create' | 'home' | 'expense' | 'dashboard' | 'settlement' | 'payment' | 'settings'`という文字列型のstate 1つを持ち、if文の連鎖で画面を出し分けている。
- 状態管理: `src/state/useWarikanApp.ts`(764行)が単一のカスタムフックとして`event`・`members`・`currentMemberId`・`expenses`・`settlements`・`view`を保持し、変更のたびに`localStorage`(キー`warikan.web.mvp.v1`)へシリアライズして永続化する。Redux等の外部状態管理ライブラリは使用していない。
- ドメインロジックの分離: `src/domain/settlement.ts`に`splitExpense` / `calculateBalances` / `generatePairwiseSettlements`が純関数として実装されており、`useWarikanApp.ts`から呼ばれる。UIコンポーネント側はロジックを持たず、propsとコールバックのみで構成される表示層。
- スタイル: `src/styles.css`(3600行超)にCSS変数を定義したグローバル1ファイル構成。CSS Modules・styled-components等は未使用。

#### `:root`のデザイントークン(`src/styles.css`より抜粋。今後のUI実装は原則この変数を使うこと。ハードコード色を増やさない)

```css
--accent: #e4602f;
--accent-dark: #b44415;
--ink: #1d1b19;
--subtle: #7a756e;
--muted: #a8a29a;
--canvas: #f6f5f2;
--warm-canvas: #faf5ef;
--card: #ffffff;
--border: rgba(36, 28, 21, 0.1);
--green: #2c9663;
--green-dark: #1f7a4d;
--blue: #3b6fd4;
--amber: #a87514;
--radius-sm: 10px;
--radius-md: 14px;
--radius-lg: 18px;
--radius-xl: 24px;
--shadow-sm: 0 2px 7px rgba(46, 35, 25, 0.05);
--shadow-md: 0 10px 32px rgba(46, 35, 25, 0.09);
```

フォントは `"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif`。

#### メンバー色の生成ロジック(`src/components/ui.ts`)

```ts
// Golden-angle hues provide a stable palette for the maximum 50 participants.
export const memberColor = (index: number) => {
  const hue = Math.round((18 + index * 137.508) % 360)
  return {
    solid: `hsl(${hue} 58% 44%)`,
    soft: `hsl(${hue} 72% 94%)`,
    border: `hsl(${hue} 48% 82%)`,
  }
}
```

参加者の識別色は必ずこの関数経由で取得すること。新規UIで色を割り当てる際にハードコードした色相を使わない。

#### 表示名解決ロジック(`src/components/ui.ts`)

```ts
export const memberDisplayName = (
  members: Member[],
  id: string,
  currentMemberId: string | null,
) => {
  const member = members.find((item) => item.id === id)
  if (!member) return '不明な参加者'
  if (member.id === currentMemberId) return 'あなた'
  if (member.isOrganizer) return '幹事'
  return member.name
}
```

**注意**: このロジックは「メンバーの名前が文字列として"あなた"かどうか」ではなく、`isOrganizer`フラグと`currentMemberId`の一致で判定する。過去に文字列一致で判定していたバグ(名前が偶然「あなた」だった参加者が誤って幹事表示になる)を修正済み。表示名を扱う新規実装は必ずこの関数を経由すること。ただし、メンバーが自分で名前欄に「あなた」「幹事」と入力すること自体を防ぐバリデーションは未実装(→ Issue #2、本書6.2参照)。

### 2.3 バックエンド(Supabase)の実装状況

Postgresマイグレーション4本が実装済み。

| ファイル | 行数 | 内容 |
|---|---|---|
| `supabase/migrations/20260714000100_initial_schema.sql` | 262 | テーブル11本、RLS有効化、ポリシー(一部)、`set_updated_at`トリガー |
| `supabase/migrations/20260714000200_api_functions.sql` | 482 | `warikan_private`ヘルパー関数群、主要RPC(下記) |
| `supabase/migrations/20260714000300_expense_and_settlement_workflow.sql` | 417 | 支出編集・削除・暫定確定・精算ワークフローRPC |
| `supabase/migrations/20260714000400_organizer_actor_access.sql` | 56 | 認証済み幹事がdevice tokenなしでactor解決されるよう`add_expense`を修正 |

#### テーブル一覧

`events`, `members`, `member_claim_tokens`, `expenses`, `expense_targets`, `settlements`, `settlement_items`, `activity_logs`, `event_integrations`, `member_external_accounts`, `notification_jobs`, `notification_deliveries`

`event_integrations` / `member_external_accounts` / `notification_jobs` / `notification_deliveries` はLINE/Discord連携を見据えた受け皿で、現時点ではジョブをキューに積むところまでしか実装されていない(2.5節参照)。

#### RLSポリシー

23個のポリシーが定義済み。基本パターンは `for all to authenticated`(幹事=Auth済みユーザーとしてアクセス)と、`activity_logs` / `notification_jobs` / `notification_deliveries`向けの `organizer_select` のみのポリシー。**このRLSが「参加者は他人の支出を編集できない」等の権限マトリクス(仕様書2節)を実際に強制しているかは、実Postgres上で未検証**(2.4節参照)。RLSは主に「幹事(Auth済み)」と「それ以外」の区別に依存しており、参加者間の権限(支払者本人のみ編集可、等)はRPC関数内部の`warikan_private.require_actor` / `require_member`によるチェックに依存している可能性が高い。フェーズ0で実際の権限マトリクスとRLS+RPCチェックの対応関係を洗い出すこと。

#### RPC関数一覧(`public`スキーマ、クライアントから`supabase.rpc()`で呼び出す想定)

`get_event_state`, `create_event`, `join_event`, `organizer_add_member`, `organizer_issue_claim_token`, `claim_member`, `organizer_update_event`, `organizer_remove_member`, `add_expense`, `update_expense`, `save_own_fixed_amount`, `finalize_expense`, `delete_expense`, `finalize_event`, `unfinalize_event`, `report_settlement`, `confirm_settlement`, `revert_settlement`, `organizer_upsert_integration`, `organizer_queue_notification`

`warikan_private`スキーマの内部ヘルパー: `hash_token`, `random_token`, `require_organizer`, `require_member`, `require_actor`, `next_member_name`, `write_log`, `replace_expense_targets`, `event_charges`

### 2.4 バックエンド検証状況(重要なギャップ)

- `npm run backend:validate`(`scripts/validate-backend.mjs`、`@electric-sql/pglite`使用)は**成功する**。マイグレーション3〜4本がPGlite上で実行でき、主要フローが動作することは確認済み。
- しかし、この検証は`auth.uid()`・RLS・ロールを簡易モックしたものであり(スクリプト内で`auth`スキーマと`anon`/`authenticated`/`service_role`ロールを手動で再現している)、**実Postgres上でのRLS強制は一度も検証されていない**。
- `supabase/tests/database/001_backend_foundation.test.sql` / `002_workflow_contract.test.sql` / `003_authorization_matrix.test.sql` にpgTAPテスト(合計49アサーション)が存在する。
- 2026-07-23、リンク済みクラウドSupabase `nrixujdkgvexnnqfoned` の実Postgres上で49件すべて成功した。停止中だったプロジェクトを復旧し、pgTAPを`extensions`スキーマへ導入した上で、CLIの一時ログインロールから`postgres`へ切り替えて3ファイルを実行した。
- このPCにはDockerが無いため、`supabase test db --linked`はリモート接続後のテストランナー起動時にDocker要件で停止する。今回は同じSQLファイルをNode Postgresクライアントから直接実行して受け入れ条件を確認した。
- 結論: **フェーズ0の実Postgres権限検証は完了済み**。今後RPCまたはRLSを変更した場合は、同じ49件を実Postgresでも再実行すること。

### 2.5 通知連携(LINE/Discord)の実装状況

- `event_integrations` / `notification_jobs` / `notification_deliveries`、登録・キューRPC、暗号化された通知先登録UIまで実装済み。
- `supabase/functions/notification-dispatcher`はDiscord WebhookとLINE Push APIへの配送、atomic claim、配送履歴、指数バックオフ、最大試行回数を実装済み。`integration-settings`とともにクラウドへ反映済み。
- 実資格情報を使う外部配送だけが未確認。現在は送信専用で、LINE Postback／Discord Interaction等の受信処理と参加者アカウント紐付けは未実装。

### 2.6 フロントエンド⇔バックエンド接続状況

- `src/backend/supabase.ts`の`createWarikanBackend(config)`は、イベント作成・共有参加・幹事設定・支出・精算の17 RPCとRealtime Broadcastを型付きでラップし、`src/App.tsx`からクラウドイベント時に利用している。ローカルイベントとデモだけが`useWarikanApp`のローカル処理へフォールバックする。
- 認証: `src/backend/useSupabaseAuth.ts`がGoogle OAuth開始・セッション復元・ログアウトを実装済み。2026-07-23に共有URLのpathname/queryをOAuth後も保持するよう修正し、Supabase AuthのSite URLとローカルRedirect URLも設定済み。同日、Google Cloudプロジェクト`polaris-503219`でOAuth Web Clientを作成し、SupabaseのGoogleプロバイダーを有効化した。実ブラウザでGoogleログイン、認証済み`create_event`、共有URL発行まで成功している。
- 共有URL: `/e/{shareToken}`の初回解析、`get_event_state`、匿名参加、claim、自動本人復元まで実装済み。クラウド状態はlocalStorageへ複製せず、共有URLから再取得する。
- DB型: `src/backend/database.types.ts`をリンク済みSupabaseから生成し、Supabase clientのgenericへ適用済み。テーブル・enum・RPC名／引数は生成型、`jsonb_build_object`の内部構造は`src/backend/types.ts`の画面向け契約型で扱う。

### 2.7 ホスティング・インフラ方針(決定済み)

- ホスティングはNetlify(静的サイト配信 + SPAリダイレクト設定のみ、Netlify Functionsは使用しない方針)を継続する。利用者増加時のボトルネックはNetlifyではなくSupabase側(Postgres接続数・compute plan)であるため、Netlifyを見直す必要はないと判断済み。
- 将来、レシートOCR(Claude API vision)のようにサーバー側で秘密鍵を扱う処理が必要になった場合は、**Netlify Functionsではなく Supabase Edge Functions に実装を一本化する**。理由: (1) LINE/Discord通知dispatcherも同じ理由でSupabase Edge Functionsに実装する方針であり、秘密鍵を扱うサーバーレス実行環境を1箇所に集約したい。(2) Edge FunctionからPostgres・RLS・`auth.uid()`のコンテキストへ同一プロジェクト内でシームレスに接続できる。
- PayPay連携(v2)は仕様上「送金リンクへの誘導」のみであり、実送金APIの署名付き呼び出し等は行わない設計(1.3節の恒久制約)。そのためPayPay連携自体はサーバー側の秘密鍵管理を必要としない見込み(v2着手時に要再確認)。

### 2.8 テスト状況

- テストファイル6本(`src/backend/supabase.test.ts`, `src/backend/useSupabaseAuth.test.ts`, `src/components/ui.test.ts`, `src/data/demo.test.ts`, `src/domain/settlement.test.ts`, `src/lib/random.test.ts`)、**36件のユニットテストが成功**(`npm test`で確認済み)。
- E2Eテスト(Playwright等)は一切自動化されていない。過去の検証はすべて人力(または開発補助エージェントが都度手動でPlaywrightスクリプトを書いて実行)で行っている。
- GitHub Pagesプレビュー用の`.github/workflows/deploy-pages.yml`が存在する。2026-07-23にテスト・ビルド・`backend:validate`を実行する`.github/workflows/ci.yml`を追加し、PR #3のGitHub Actionsで全工程の成功を確認した。

### 2.9 デモ・デバッグ用データ

- `src/data/demo.ts`: `createDemoData`(箱根旅行の基本デモ)、`createFourPersonDemoData`(4人・2泊3日、全件金額指定、全員が1回以上立て替え、部分入力の暫定支出1件を含むテンプレート)。
- UI検証・回帰確認は必ず`createFourPersonDemoData`を用いること。これが以後のフェーズでも標準の検証データセットである。
- デバッグ用の視点切り替え(`DebugPerspectiveSwitcher`)と「最初から」ボタン(`TestResetButton`)はテスト目的のみに存在する。**本番リリース前に両方を削除すること**(HANDOFF.md記載の既知のTODO)。

---

## 3. 精算エンジンの仕様(確定ルール)

`src/domain/settlement.ts`に実装されている計算ルール。これを変更する場合は影響範囲(PL/pgSQL側の対応するRPCロジックとの整合含む)を必ず確認すること。

- **`equal`(均等割り)**: 各対象者は`floor(amount / n)`円を負担。端数は支払者負担。支払者が対象者に含まれない場合でも、端数は支払者が負担する。
- **`fixed`(金額指定)**: 対象者ごとに指定額を使用。未入力・一部入力の状態は「暫定支出」として保存できる。支出の確定(finalize)時には全員分の入力が揃い、かつ合計が一致していることが必須。
- **balance(個人収支)**: `支払った合計 - 負担した合計`。
- **相手ごと精算(pairwise settlement)**: 確定済み支出から対象者→立替え者の負担をペアごとに集約し、同じ2人の逆方向負担を差し引く。差し引き前の支出内訳、逆方向の支出内訳、計算式は必ず保持・表示する。完全に相殺された場合は0円・支払い不要として扱うが、内訳表示は残す。
- **暫定支出の扱い**: イベント合計には含むが、balanceと精算計算からは除外する。暫定支出が1件でも残っている間は、そのイベント全体の精算を確定(finalize_event)できない。
- **`dayIndex`は1始まり**。

---

## 4. 設計判断(着手前に決定すること)

以下はHANDOFF.mdおよび本書作成時点で未決定のまま残っている項目。該当フェーズに着手する前に必ず決定し、決定内容を`HANDOFF.md`および関連コードのコメントに残すこと。

1. **TypeScript精算エンジンとPostgres finalize処理の一貫性**: `src/domain/settlement.ts`(フロント用)とPL/pgSQL側の`finalize_event`等(バックエンド用)は、現状同じ計算ロジックを2箇所に実装している状態。フェーズ2着手時に以下のいずれかを決定すること。
   - (a) 契約テストを書く: 同一の入力データセットをTS版・RPC版の両方に投げ、出力が完全一致することをテストで保証する。
   - (b) Edge Functionで精算ロジックをTypeScriptとして一本化し、PL/pgSQL側は薄いラッパーにする。
   - (c) PL/pgSQL側を正とし、フロント側の計算はプレビュー表示専用(サーバー確定値と食い違い得る前提)と割り切る。
   いずれを選んでも、選定理由をHANDOFF.mdに残すこと。
   - **決定・完了(2026-07-23)**: (a) 契約テストを採用した。PL/pgSQLをEdge Functionへ移す変更は認証・RLS境界まで広げるため、同一入力と完全一致比較で現在の二重実装を固定する。`src/domain/settlement.contract.test.ts`で、4人デモの確定済み7支出をTS版と全migration適用済みPGlite版へ投入し、方向・差額・相殺前金額・支出内訳まで一致することを検証する。
2. **`unfinalize_event`時、既にreported/paidの精算が存在する場合の再確認フロー**: 現状RPC(`unfinalize_event`は`p_force`引数を持つ)はあるが、フロント側でどう確認ダイアログを出すか未設計。フェーズ2で設計すること。
   - **決定・完了(2026-07-23)**: 最初の解除確認後は必ず`p_force=false`で安全に問い合わせる。RPCが`requiresConfirmation=true`を返した場合だけ、変更済み精算件数を明示した2回目の確認を表示し、同意後に`p_force=true`で解除する。ブラウザ標準ダイアログではなく画面内確認を使う。
3. **精算内訳(`settlement_items`)をRPCレスポンスとしてどう返すか**: 型定義が未確定。フェーズ2で`src/backend/types.ts`(または自動生成型)に反映すること。
   - **決定・完了(2026-07-23)**: `get_event_state`が返す各`Settlement`の`charges` / `offsets`を`SettlementBreakdownItem[]`として扱う。支出ID・名称・カテゴリ・金額・方向・日付indexを型付きで保持し、別のトップレベルレスポンス型は追加しない。`EventState.settlements: Settlement[]`からそのままUIへ渡す。
4. **RLSポリシーと権限マトリクス(仕様書2節)の対応関係の明文化**: 現状「幹事=authenticated」「参加者=RPC内部の`require_actor`/`require_member`チェック」という二重構造になっている可能性が高い。フェーズ0でこの対応関係を実際に検証し、抜け漏れがあればRLSまたはRPC内部チェックを追加すること。

---

## 5. フェーズ別ロードマップ

### フェーズ0: バックエンド検証基盤を実地で固める — 完了(2026-07-23)

**背景**: 現状の検証はPGlite(auth/RLSを簡易モック)のみで、実Postgres上でのRLS強制は未検証。ここが崩れていると、以降のフェーズで「動いているつもり」のまま積み上げることになる。

**タスク**:
1. Docker Desktopを導入するか、クラウドSupabaseプロジェクト(既に`nrixujdkgvexnnqfoned`が存在する、HANDOFF.md参照)上で`supabase test db`を実行し、pgTAP 27件を実Postgresで通す。
2. 4節-4で挙げた権限マトリクス(仕様書2節「権限マトリクス」表)と、RLSポリシー23個+RPC内部の`require_organizer`/`require_member`/`require_actor`チェックの対応関係を突き合わせ、以下を必ずpgTATケースとして持つこと(存在しなければ追加):
   - 幹事以外が`finalize_event`/`unfinalize_event`/`organizer_update_event`/`organizer_remove_member`を呼べないこと
   - 支払者本人以外が対象支出を`update_expense`/`delete_expense`できないこと
   - 対象者本人以外が`save_own_fixed_amount`で他人の負担額を書き換えられないこと
   - 参加していないevent_idに対してどのRPCも操作できないこと(event跨ぎのデータ漏洩がないこと)
3. 検証済みの内容をHANDOFF.mdに追記する。

**受け入れ条件**: `npm run backend:test`(またはDocker経由の`supabase test db`)が実Postgres上で全件成功する。4節-4の対応関係が文書化されている。

**完了実績**: 実Postgres上でpgTAP 49件が成功した。権限マトリクスとRLS/RPCの対応関係は`HANDOFF.md`の「フェーズ0 権限検証の完了」へ記録済み。

---

### フェーズ0.5: CI導入 — 完了(2026-07-23)

**背景**: GitHub Pagesプレビュー用workflowは存在するが、ユニットテスト・本番ビルド・バックエンド検証をまとめて実行するCIが無かった。他のフェーズを待たずに着手可能。

**タスク**:
1. `.github/workflows/ci.yml`を新規作成。`push`(mainブランチ)と`pull_request`(全ブランチ対象)をトリガーに設定。
2. ジョブ内容: `actions/checkout` → `actions/setup-node`(Node.jsバージョンは`package.json`のengines指定 or 現行LTSに合わせる) → `npm ci` → `npm test` → `npm run build`(`tsc --noEmit && vite build`が内包されている) → `npm run backend:validate`。
3. 可能であれば`npm run backend:lint`(`supabase db lint --local`)もジョブに含める。ただしこれはSupabase CLI+Dockerを要する可能性があるため、CI環境での動作を個別に確認すること。動かない場合はこのステップを除外し、その旨をコメントに残す。
4. mainブランチへのマージ条件として、このCIワークフローの成功を必須にする(GitHubのブランチ保護ルール設定はリポジトリ管理者側の作業なので、Codexはワークフローファイルの作成までを担当し、保護ルール設定は提案として報告する)。

**受け入れ条件**: 任意のブランチへpushした際にGitHub Actions上でテスト・ビルド・backend:validateが自動実行され、成功/失敗がPR画面に表示される。

**完了実績**: PR #3で`Test, build, and validate backend`ジョブが成功し、34件のユニットテスト、本番ビルド、PGliteバックエンド検証がPR画面へ反映された。

---

### フェーズ1: Google認証を実際に有効化する — 完了(2026-07-23)

**タスク**:
1. Google CloudでOAuth Web Clientを作成し、承認済みリダイレクトURIへ`https://nrixujdkgvexnnqfoned.supabase.co/auth/v1/callback`を追加する。
2. Supabase Dashboard > Authentication > Sign In / Providers > Google にClient ID / Secretを設定し、有効化する。
3. Authentication > URL ConfigurationへローカルURL(`http://localhost:5173`等)を登録する。本番URLはフェーズ3でデプロイ先が確定した後に追加する。
4. コード側の対応: `src/backend/useSupabaseAuth.ts`の`signInWithGoogle`は実装済み。2026-07-23に`buildOAuthRedirectUrl`を追加し、共有URLのpathname/queryをログイン後も保持するよう改修・テスト済み。
5. E2E確認: ローカル画面の「Googleでログイン」から実ログイン→`create_event`→共有URL発行までを確認する。

**受け入れ条件**: 実ブラウザでGoogleログインが完了し、`auth.user`が取得でき、`create_event`が認証済みユーザーとして成功する。

**完了実績**: Google Cloudプロジェクト`Polaris`(`polaris-503219`)を作成し、外部・テストモードのOAuth同意画面、Webクライアント、Supabase callback URI、テストユーザーを設定した。Supabase側でGoogleプロバイダーを有効化し、`http://localhost:5173`から実ログインして認証済みメール表示を確認した。検証用イベント「フェーズ1 E2E確認」の`create_event`が成功し、`/e/{shareToken}`形式の共有URLが発行された。Client Secretはリポジトリや文書へ保存していない。

---

### フェーズ2: localStorage状態層をSupabaseへ接続する — 完了(2026-07-23)

**背景**: `createWarikanBackend`のRPCラッパーは14個中1個(`createEvent`)しか呼ばれていない。ここを埋めない限り、複数人での実利用は不可能。

**タスク(優先順位順)**:

1. **共有URL参加フローの新規実装**(現状これ自体が存在しない):
   - `src/App.tsx`(または新設するルーティング用フック)に、マウント時の`useEffect`で`window.location.pathname`を解析し、`/e/{shareToken}`形式であれば`backend.getEventState(shareToken)`を呼ぶ処理を追加する。ルーティングライブラリの新規導入は不要。単純なパス解析で足りる。
   - 取得した`EventState`を`loadRemoteEvent`(既に`useWarikanApp.ts`に存在するメソッド)へ渡し、画面に反映する。
   - 初回訪問(未参加)の場合は名前入力UIを表示し、`join_event`を呼ぶ。
   - 既知のデバイストークン(localStorageに保存済み)がある場合は`claim_member`または`get_event_state`のactor解決で自動的に本人と紐付ける。
   - デバイストークンの生成には既存の`generateDeviceToken()`(`src/backend/supabase.ts`)を使うこと。

   **完了(2026-07-23)**: `/e/{shareToken}`の初回ロード、未参加者向け名前入力、`join_event`、`?claim=`付きURLの`claim_member`、イベント単位のdevice token保存、ログイン済み幹事またはdevice token参加者のサーバー側actor解決を実装した。追加migrationをクラウドへ適用し、BrowserMCPで匿名参加と再読込後の本人復元まで確認済み。

2. **支出まわりの接続**: `add_expense` / `update_expense` / `save_own_fixed_amount` / `finalize_expense` / `delete_expense`を、`src/components/ExpenseForm.tsx`および`useWarikanApp.ts`内の対応するローカル関数(`addExpense` / `saveDraftExpense` / `finalizeExpense`等)から、`backend`が存在する場合はRPC経由に切り替える。`backend`が`null`(Supabase未設定)の場合は既存のlocalStorageロジックにフォールバックする設計を維持する(開発中のオフライン確認用途として)。

   **完了(2026-07-23)**: クラウドイベントでは5種の支出RPCへ接続し、ローカルイベント／デモでは既存状態処理へフォールバックするようにした。確定済み支出の編集・二段階削除UI、通信中表示、RPCエラー表示も追加した。BrowserMCPで匿名参加者による均等支出の追加・更新・削除、および別の立替者が作った金額指定暫定支出に対する`save_own_fixed_amount`を実クラウドで確認し、E2E支出データは確認後に削除した。

3. **精算まわりの接続**: `finalize_event` / `unfinalize_event` / `report_settlement` / `confirm_settlement` / `revert_settlement`を同様に接続する。`unfinalize_event`呼び出し時は、4節-2で決定した再確認フローをここで実装する。

   **完了(2026-07-23)**: クラウドイベントの確定・解除・支払い完了報告・受取確認・1段階取り消しを5種のRPCへ接続した。解除は`p_force=false`の安全確認後、変更済み精算がある場合だけ件数付きの再確認を経て`p_force=true`を送る。BrowserMCPで`pending → reported → paid → reported`、保護付き解除、通常状態への復帰まで実クラウドで確認した。4人デモ相当の精算計算はTS/Postgres契約テストで内訳まで一致を固定した。

4. **リアルタイム同期の追加**(このフェーズで一緒に行うのが効率的): Supabase Realtimeを使い、`expenses` / `expense_targets` / `settlements` / `settlement_items`テーブルのPostgres Changesを購読し、他の参加者の入力を画面へ即座に反映する。実装方針:
   - `supabase.channel('event:{eventId}').on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `event_id=eq.${eventId}` }, callback)`のようなチャンネル購読を`useWarikanApp.ts`(またはRealtime専用の新規フック`useEventRealtime.ts`)に実装する。
   - RLSが有効なテーブルに対するRealtime購読は、Supabase側でRealtime用のRLSポリシー(`for select`)が必要になる場合があるため、フェーズ0で洗い出した権限マトリクスと矛盾しないことを確認する。
   - 楽観的UI更新(自分の操作は即座に画面反映し、裏でRPCが確定する)も検討するが、必須ではない。まずは他者の変更が数秒以内に画面へ反映されることを優先する。

   **完了(2026-07-23)**: アカウントレス参加者はJWTにevent所属を持たず、Postgres ChangesのRLSで安全にイベント行だけを許可できないため、公開テーブルSELECT権限は追加しない方針に変更した。代わりに十分なエントロピーを持つshare token由来のRealtime Broadcastチャンネルへ、データを含まない`event_changed`通知だけを送る。受信側は既存の`get_event_state(shareToken, deviceToken)`で本人確認付きの全状態を再取得する。連続通知は再取得中に1回へまとめ、画面位置を保持する。実クラウドでブラウザからNode購読クライアントへの通知到達と、Node側の参加追加がブラウザへリロードなしで反映されることを確認した。

5. **localStorage永続化ロジックの縮小**: `backend`が存在する場合は`localStorage`への保存を段階的に無効化する。ただし、フェーズ7のオフライン対応(電波が無い間の下書き保存)と競合しないよう、「未送信の下書き」用途のlocalStorage利用は残す設計にすること。

   **完了(2026-07-23)**: 状態へ`persistence: local | remote`を追加し、クラウドから読み込んだイベント本体・参加者・支出・精算は`warikan.web.mvp.v1`へ保存せず、既存スナップショットも削除するようにした。ローカル作成イベントとデモだけは従来どおり再読込後も復元する。旧buildの保存データは、ローカル生成の36桁hex share tokenだけをローカル状態として移行し、32桁base64urlのクラウドスナップショットは復元しない。device token/member IDは別キー`warikan.web.event-sessions.v1`へ残すが、本人判定は引き続きサーバーRPCが行う。フェーズ7の未送信下書きはイベント本体と分離した専用ストアとして追加する方針とし、現時点ではサーバー保存済みdraftだけを扱う。

6. `src/backend/types.ts`の手書きinterfaceを、可能であれば`supabase gen types typescript`によるDBスキーマからの自動生成に置き換える(このタスクはフェーズ6と重複するため、フェーズ2で先に着手しても構わない)。

   **完了(2026-07-23)**: `npm run backend:types`でリンク済みSupabaseのpublic schemaを`src/backend/database.types.ts`へ再生成できるようにし、`createClient<Database>` / `SupabaseClient<Database>`へ適用した。RPC名・引数、table、enumは生成型で検査する。RPCが返す任意構造JSONは生成器上`Json`となるため、`EventState`等の画面向けレスポンス契約は`src/backend/types.ts`へ残す。CLI生成型がSQLのnullable function引数を非NULLとして出力する箇所は、該当キーだけを`allowSqlNull`で補正し、他の引数検査を維持する。再生成手順はREADMEへ記載した。

**受け入れ条件**:
- 別端末・別ブラウザで共有URLを開いた際に、実際のイベントデータ(参加者・支出・精算状況)が表示される。
- 参加者Aが支出を追加すると、参加者Bの画面が(リロードなしで)数秒以内に更新される。
- `createFourPersonDemoData`相当のシナリオを、Supabase接続状態で実際に複数ブラウザタブを使って再現し、精算結果がフロントのドメインロジック(`src/domain/settlement.ts`)と一致することを確認する。

**完了実績**: 実クラウドイベントへ「あなた・ブラウザ参加者・ケンタ・サキ」の4人と、標準4人デモの暫定支出を除く7支出(合計115,400円)を同じ固定内訳で投入した。幹事ブラウザと独立した2つのNode参加者クライアントで、4人・7支出の取得とRealtime反映を確認した。`finalize_event`後の6精算は、支払方向・差額・gross・offset・charge/offset支出IDまで同じ入力のドメイン計算と完全一致した。BrowserMCPでも確定済み6組(5,000円、2,200円、2,300円、14,000円、7,700円、14,400円)と4人の関係マップを確認した。さらにChromeの2タブで同じ共有URLを開き、片方で追加した支出がもう片方へリロードなしで表示されることを確認した。終了後は確定解除し、検証用支出・参加者を削除して、active・既存2人・0支出・0精算へ戻した。

---

### フェーズ3: 本番デプロイとマルチデバイス確認

**タスク**:
  1. NetlifyへHTTPSデプロイする(`netlify.toml`は既に存在するため設定変更は基本的に不要)。**完了 (2026-07-23)**: `polaris-warikan` を作成し、本番URL `https://polaris-warikan.netlify.app` へ1回だけ本番デプロイ。Supabaseの本番環境変数を設定し、HTTP 200とBrowserMCPでSPA表示を確認。Auth URL ConfigurationのSite URLと本番Redirect URL (`/**`) も登録済み。
  2. 複数スマートフォンで、共有URL発行→別端末で参加→支出入力→精算確定までのE2Eフローを確認する。
  3. PWAインストール(ホーム画面追加)を実機で確認する。**生成物確認済み (2026-07-23)**: 本番の`manifest.webmanifest` / Service Workerを確認。実機のホーム画面追加は未確認。

  **受け入れ条件**: 本番URL経由で複数デバイスから同時にイベントへ参加し、リアルタイムに反映される支出・精算状況を確認できる。

  **追加確認 (2026-07-23)**: 本番の「Googleでログイン」から`pokemonclub820@gmail.com`で実ログインし、認証済み表示を確認。イベント「本番OAuth確認」を作成し、共有URL発行まで成功。確認後にイベントを削除してクラウドをクリーンアップ済み。別アカウントではGoogle側の追加本人確認が発生したが、OAuth設定・本番リダイレクト自体の到達性は確認済み。
  **実機依存の明確化 (2026-07-23)**: BrowserMCPでは別端末／別ブラウザセッションを作成できないため、複数端末の最終受け入れとホーム画面追加は未完了のまま保持。実施手順を`HANDOFF.md`へ記録した。

---

### フェーズ4: UI改修 — 完了済み

このフェーズはPR #1として`main`へマージ済み。以下は実施済み内容の記録(今後の回帰確認・引き継ぎ用)。**新規の追加作業は本書のバックログセクションに切り出されたものを除き、発生しない。**

実施済み内容:

1. **精算ペアカードのサマリー化**: `SettlementView.tsx`の各ペアカードをデフォルト折りたたみの1行サマリー(支払い方向+金額+計算式)に変更。比較バーと内訳を単一の`<details>`(見出し「比較と内訳を見る」)へ統合し、ネストなしの構造にした。
2. **差額表示への変更**: 比較バー中央の「比較」ラベルを「差 ¥7,700 →」形式の実際の差額+方向矢印表示に変更。高い方のバーに破線の「超過分」ガイドラインを追加(低い方が¥0の場合はガイドライン省略)。差額0円のペアは「±0」表示。
3. **キャプションの重複解消**: 「同じ基準で、相手の分を立て替えた金額を比較しています」を各カードから削除し、セクション先頭に1回だけ表示。
4. **ダッシュボードのカード統合**: `AdvanceDashboardView.tsx`のチャートカードを4枚から2枚に統合し、カード内タブ(「イベント別 / 相手別」)で切り替え可能に。タブ状態はカードごとに独立。
5. **縦棒グラフのリスタイル**: 個別バーの背景トラックを廃止し、共通ベースライン+グリッド線に変更。パーセント表示を金額に併記(`¥13,000 · 67%`)。パーセント配分は`allocatePercentages`(`src/components/ui.ts`、最大剰余法、ユニットテスト済み)で常に合計100%になるよう保証。1%未満は「1%未満」と表示。
6. **円グラフのドーナツ化**: 中央に合計額を表示するドーナツ形式に変更。円グラフモード時はヘッダーの合計表示を非表示にする(縦棒モードでは表示のまま)。
7. **差し引きカードの導線化**: ダッシュボードの「差し引き」カードを`<button type="button">`化し、`onOpenSettlements`を呼んで精算画面へ遷移できるようにした(キーボード操作対応)。
8. **デバッグ視点スイッチャーの折りたたみ**: `DebugPerspectiveSwitcher`をデフォルト折りたたみ状態にし、`aria-expanded`で開閉。
9. **モバイル(390px)のバー整列バグ修正**: `.pair-bars`の`align-items: center`が原因で、左右の凡例項目数が異なるカードで比較バーのトラックが約20px縦にずれていた問題を修正。`align-items: start`に変更し、中央の差額ピルは`--pair-track-top` / `--pair-track-height`変数を使った`calc()`+`transform: translateY(-50%)`で再配置。360/390/430pxの3幅、全6ペアカードでトラック位置差0.0pxを確認済み。
10. **アクセシビリティ改善**: グラフコンテナの`role="img"`(内部テキストがスクリーンリーダーから隠れる問題があった)を`role="group"`に変更。
11. **表示名解決のバグ修正**: `memberDisplayName`関数を名前の文字列一致ではなく`isOrganizer`フラグ+`currentMemberId`ベースに変更(2.2節参照)。名前が偶然「あなた」「幹事」という参加者がいた場合の表示崩れは解消したが、そもそもそのような名前の登録自体を防ぐバリデーションは未実装のままIssue #2として分離済み(6.2節参照)。

**回帰確認の基準**: 今後このあたりのコードに触る際は、`createFourPersonDemoData`テンプレートを使い、幹事視点・参加者視点(特にミナ視点で「幹事」表記になっているか)・360/390/430/1024/1280pxの各幅で、上記1〜11の挙動が壊れていないことを確認すること。

---

### フェーズ5: LINE/Discord通知連携

**背景**: テーブル・登録用RPC(`organizer_upsert_integration` / `organizer_queue_notification`)は実装済み。ジョブを実際に送信するdispatcherが未実装。

**タスク**:
1. Supabase Edge Functions(Deno)としてdispatcherを新規実装する。`notification_jobs`テーブルの`status = 'pending'`かつ`scheduled_for <= now()`のジョブを取得し、`event_integrations`の`provider`(LINE / Discord)に応じてそれぞれのWebhook API(LINE Messaging API / Discord Webhook)へ送信する。
2. 送信結果を`notification_deliveries`テーブルへ記録する(成功/失敗、`provider_message_id`、エラーメッセージ)。
3. リトライロジック: `notification_jobs.attempts` / `max_attempts`を使い、失敗時は指数バックオフ等で再試行、上限到達で`status = 'failed'`に更新する。
4. dispatcherの起動方法: Supabase Cron(pg_cron)またはEdge Functionsのスケジュール実行機能を使い、一定間隔(例: 1分ごと)でdispatcherを呼び出す。
5. `organizer_upsert_integration`から実際にLINE公式アカウント/Discord Webhook URLを登録するUIを`EventSettingsView.tsx`(幹事専用設定画面)に追加する。

  **受け入れ条件**: 幹事がイベント設定画面からDiscord Webhook URLを登録し、催促通知を送信すると、実際にDiscordチャンネルへメッセージが届く。LINEも同様。

  **着手前確認 (2026-07-23)**: outboxテーブルと`organizer_upsert_integration` / `organizer_queue_notification`は存在するが、現在の登録RPCは`config`(Webhook秘密情報)を受け取らず、フロントにも登録UIがない。Edge Function実装前に、Webhook URLをクライアントへ返さず暗号化・秘密管理する境界と、Discord/LINEの外部送信結果を記録するRPCまたはservice-role更新処理を確定する。実Webhookへの送信はこの設計確定後に行う。
  **通知アダプター基盤 (2026-07-23)**: `src/notifications/adapters.ts`にDiscord Webhook / LINE Push向けのメッセージ正規化を追加し、空payload、タイトル+URLフォールバック、Discord mention無効化をユニットテストで固定した。外部送信・秘密情報はまだ扱わない。
  **dispatcher骨格 (2026-07-23)**: `supabase/functions/notification-dispatcher/index.ts`を追加。due jobの取得、processing遷移、Discord送信、配送履歴、指数バックオフ、最大試行回数到達時のfailed化まで実装。LINEは秘密管理境界確定まで明示的にunsupported。`20260723000200_notification_claim.sql`の`FOR UPDATE SKIP LOCKED`によるatomic claim RPCで多重Cron時の重複取得を防止する。
  **LINE dispatcher (2026-07-23)**: `LINE_CHANNEL_ACCESS_TOKEN`をEdge Function環境変数からのみ取得し、`external_space_id`を宛先としてLINE Push APIへ送信する経路を追加。request IDを配送履歴へ保存し、Discord 2,000文字／LINE 5,000文字の上限をアダプターとテストで固定した。実トークン設定・実配送は未実施。
  **通知先登録UI・秘密管理 (2026-07-23)**: 幹事設定にDiscord／LINE通知先の登録、接続済み表示、変更、削除、テスト通知キュー追加を実装。Discord Webhook URLは公開RPCや`VITE_*`へ渡して保存せず、認証・幹事権限を再確認する`integration-settings` Edge FunctionでAES-256-GCM暗号化し、DBには暗号文だけを保持する。LINEは秘密でないUser／Group／Room IDを登録し、画面には末尾だけを表示する。暗号鍵はSupabase Function secretへ設定し、`integration-settings`と暗号復号対応済み`notification-dispatcher`を本番へデプロイ。未認証呼び出しが401になること、ユニットテスト77件・Playwright 16件を確認し、Netlify Deploy `6a61c1aa254402e0ea1eea83`へ反映。実Webhook／LINE tokenによる外部配送は未確認。

---

### フェーズ6: フロントエンドの磨き込み

**タスク**:
1. **コード分割**: `React.lazy` + `Suspense`を使い、幹事専用画面(`EventSettingsView.tsx`)や使用頻度の低い画面を動的importに変更し、初回バンドルサイズを削減する。
2. **型の自動生成 — フェーズ2で完了**: `npm run backend:types`、`src/backend/database.types.ts`、型付きSupabase clientを導入済み。migration変更時に型生成とbuildを再実行する運用もREADMEへ記載済み。
3. **マイクロインタラクション**: ボタン押下時のフィードバック、データ取得中のスケルトンローディング表示、支出追加・精算操作の楽観的UI更新(サーバー応答を待たずに画面へ即時反映し、失敗時にロールバックする)を追加する。既存の`app-view-enter`アニメーション(`styles.css`)との一貫性を保つこと。
4. **E2Eテスト自動化**: Playwrightを導入し、以下の基本シナリオを自動テスト化する。
   - イベント作成 → 支出追加(均等割り・金額指定の両方) → 精算確定 → 支払い報告・確認の一連のフロー
   - `createFourPersonDemoData`を使った幹事視点・参加者視点の双方での精算画面表示確認
   - モバイル幅(390px)・デスクトップ幅(1280px)のレイアウト崩れがないことの確認
   これらをフェーズ0.5のCIワークフローに組み込む。

  **受け入れ条件**: Lighthouseパフォーマンススコアの初回計測値を記録し、コード分割後に初回読み込みJSサイズが計測可能な形で削減されていること。PlaywrightのE2EテストがCI上で自動実行され成功すること。

  **コード分割着手 (2026-07-23)**: 幹事専用`EventSettingsView`を`React.lazy` + `Suspense`で分離。初回JSは約502KBから約495KBへ、設定画面チャンク7.47KBへ分割された。残りは他の低頻度画面、Lighthouse計測、Playwright導入。
  **コード分割拡張 (2026-07-23)**: `AdvanceDashboardView`と`SettlementView`も遅延ロード化。初回JSは約462.6KBまで削減され、設定7.46KB、ダッシュボード8.24KB、精算25.06KBの独立チャンクを生成。残りはLighthouse計測、Playwright導入、マイクロインタラクション。
  **Lighthouse初回計測 (2026-07-23)**: 本番URLをデスクトップ設定で計測し、Performanceスコア0.93、FCPスコア0.83、LCPスコア0.96、TBTスコア1.00を記録。Speed Indexスコアは0.54で、ネットワーク条件に依存するため改善前の基準値として扱う。Playwright導入とCI接続は未着手。
  **Playwrightスモーク (2026-07-23)**: `@playwright/test`、Chromiumのデスクトップ／Pixel 5相当プロジェクト、ローカルpreview webServerを追加。作成画面・4人デモ表示・横スクロールなしを4ケース（Desktop 2 / Mobile 2）で確認。CIにChromium導入と`npm run test:e2e`を追加した。OAuth依存のクラウドE2Eは別の実機受け入れに残す。
  **画面遷移スモーク拡張 (2026-07-23)**: 4人デモから立替ダッシュボード、全員の精算状況、支払いタブへの遷移をDesktop／Pixel 5相当の両方で追加確認。Playwrightは6ケース全件成功。
  **支出フォームスモーク (2026-07-23)**: Desktop／Pixel 5相当で支出追加フォームを開き、キャンセル後に8件のデモ状態が維持されることを追加確認。Playwrightは8ケース全件成功。
  **支出追加E2E (2026-07-23)**: Desktop／Pixel 5相当で内容「E2Eテストの昼食」・1,200円を入力して追加し、9件目の一覧表示を確認。Playwrightは10ケース全件成功。
  **支出CRUD E2E (2026-07-23)**: ローカルデモで支出追加→1,200円から2,400円へ編集→削除→8件へ復帰する完全フローをDesktop／Pixel 5相当で追加。モバイル削除確認が固定アクションバーに遮られる不具合を検出し、確認中は固定バーを非表示にして修正。Playwrightは12ケース全件成功。`test:e2e`は実行前にbuildして古いpreview資産を避ける。
  **Playwright CIレポート (2026-07-23)**: list＋HTML reporterを有効化し、GitHub Actionsで`playwright-report`を成否に関係なく7日間artifact保存する。ローカル12ケース全件成功を再確認。
  **PWA配信E2E (2026-07-23)**: ビルド後のpreviewに対し、`manifest.webmanifest`のアプリ名・`standalone`表示・開始URLと、Service Worker `/sw.js`の配信成功をDesktop／Pixel 5相当で自動確認するケースを追加。Playwrightは14ケース全件成功。ホーム画面追加とオフライン復帰の実機確認は引き続きフェーズ3・7の受け入れ残件。
  **性能回帰バジェット (2026-07-23)**: `scripts/lighthouse-audit.mjs`でローカルproduction previewの初回表示をDesktop 1280px／Mobile 390pxで計測し、Performance、FCP、LCP、CLS、JS/CSS/JSON転送量をJSON出力する。SPA内の動的画面を同一URLの別ページとして水増しせず、設定・ダッシュボード・精算の遅延チャンクは`dist`実ファイルサイズで決定的に追跡する。`LIGHTHOUSE_BASELINES.json`比10%超で警告、20%超で失敗。基準値はDesktop 1.00（FCP 405ms/LCP 463ms）、Mobile 0.97（FCP 1,936ms/LCP 2,086ms）、初回JS 486,979 bytes。CIで自動実行し、結果artifactを7日保存する。

---

### フェーズ7: 運用耐性の強化

**タスク**:
1. **オフライン対応の強化**: 電波が無い状態で支出入力操作を行った場合、`localStorage`(またはIndexedDB)に「未送信の下書き」として保持し、オンライン復帰を検知した時点で自動的にRPCへ送信するキューイング機構を実装する。`navigator.onLine`とオンライン/オフラインイベントリスナーを使う。既存の`vite-plugin-pwa`のService Worker設定との整合を確認すること。
2. **エラー監視**: Sentry等のエラートラッキングサービスを導入し、フロントエンドの実行時エラーを収集する。個人情報(参加者名等)がエラーレポートに含まれないようスクラビング設定を行う。
3. **共有URLのセキュリティ強化**: 参加者はログイン不要で共有URL(`share_token`)のみでアクセスできる設計のため、総当たり攻撃やレートリミット未設定によるアクセス試行のリスクがある。Supabase側のRate Limiting機能、またはRPC呼び出し頻度に対する簡易的なレートリミット(例: 同一IPからの`get_event_state`呼び出し回数制限)を検討する。`share_token`の生成に十分なエントロピー(既存実装で32byteランダム値相当)が使われていることも改めて確認する。

  **受け入れ条件**: オフライン状態で入力した支出が、オンライン復帰後に自動送信され、他の参加者の画面にも反映されることを実機で確認する。エラー監視サービスのダッシュボードで実際のエラーが収集されることを確認する。

  **Sentry基盤 (2026-07-23)**: `VITE_SENTRY_DSN`が設定された場合だけ`@sentry/react`を初期化し、Error Boundaryを追加。`sendDefaultPii=false`に加え、共有token、claim、device token、参加者名、Authorization/Cookieを`beforeSend`で再帰的にマスクするテストを追加。DSN未設定時は送信しない。実Sentryプロジェクト・本番イベント到達確認は未実施。
  **オフライン支出キュー基盤 (2026-07-23)**: クラウドイベントで新規支出をオフライン送信した場合、device tokenを含めず専用キー`warikan.web.pending-expenses.v1`へ保存。`online`復帰時にイベント単位・登録順で`add_expense`を再送し、成功項目だけ削除してRealtime通知・状態再取得を行う。既存支出のオフライン編集は安全のため拒否。実機でのオフライン→復帰確認は未実施。
  **オフライン再送耐性・UI (2026-07-23)**: 未送信支出に`pending` / `sending` / `failed`、試行回数、最終エラーを保持し、即時・3秒後・9秒後の最大3回で登録順に再送する。待機中・送信中・失敗を支出一覧に表示し、失敗後の手動リトライと未送信データ削除を追加。旧形式キューの復元、イベント分離、順序、バックオフ、成功削除、失敗遷移をユニットテストで検証し、全68件が成功。実クラウドイベントを使う端末間のオフライン復帰確認は残件。
  **共有URLローテーション (2026-07-23)**: 新規イベントの`share_token`生成を32ランダムbyte（base64url 43文字）へ引き上げ、認証済み幹事だけが実行できる`organizer_regenerate_share_token`を追加。再発行時は旧tokenが即時無効になり、監査ログへ記録する。設定画面に影響説明・二段階確認を伴う再発行UIを追加し、PGliteで新tokenの長さ、旧token拒否、新token成功を検証。既存の24byte tokenも192bitのエントロピーを持つため即時移行は不要で、必要時に再発行できる。同一IPベースの制限はPostgres RPCから信頼できる送信元IPを取得できないためアプリ内では擬似実装せず、Supabase側のWAF／Rate Limiting設定を本番運用残件とする。

---

### フェーズ8: 支払い・受け取りアクションハブ

**決定済み方針 (2026-07-23)**:

- 現在の`payment`タブは`SettlementView`の同一内容を表示するだけなので、役割別の独立した「支払い・受け取り」画面へ置き換える。
- アプリ内で決済、送金、残高照会、資金の預かりを行わない。外部サービスへの導線と、既存の`pending → reported → paid`状態管理だけを担う。
- 初期対応する受取方法はPayPay ID、受取人が外部で作成した相手別のPayPay請求リンク、現金。銀行口座は個人情報・誤振込リスクのため対象外。
- PayPayリンクをアプリ側で生成せず、金額や支払先を自動推測しない。支払者が金額・相手を確認して外部サービスへ進む。

**タスク**:

1. `PaymentView`を新設し、支払者には相手、金額、受取方法、金額／PayPay IDのコピー、請求リンクを開く、支払い完了報告を表示する。
2. 受取者には受取予定、報告済み一覧、受取確認、自分のPayPay ID／現金対応の設定、精算ごとの任意請求リンク登録を表示する。
3. 幹事には全精算の未払い／報告済み／受取済み進捗、未払い対象だけへの催促、問題時の1段階取り消しを表示する。
4. 受取方法はイベント参加者だけに必要最小限を返す。device tokenまたは認証済み幹事をactorとして検証するRPC経由で登録し、他イベントや無関係な参加者から参照・変更できないことをpgTAPで固定する。
5. 通知から対象精算へ直接開ける共有URLのdeep linkを追加する。URLにdevice token、claim token、秘密情報を含めない。
6. PayPay IDと請求リンクには長さ・文字・許可scheme／hostの検証を追加する。銀行口座、カード情報、自由形式の秘密情報は保存しない。

**受け入れ条件**:

- 支払者、受取者、幹事の各視点で必要な操作だけが表示される。
- PayPayを使わない参加者は現金で完結でき、外部アプリの導入を強制されない。
- 支払い報告と受取確認は既存RPCを再利用し、二重操作・なりすまし・他イベント更新を拒否する。
- Desktop／MobileのE2Eで、支払いタブが精算タブとは異なる役割別画面になり、コピー、外部リンク、報告、確認、取り消しが回帰確認できる。
- `npm test`、`npm run build`、`npm run backend:validate`、対象pgTAP、`npm run test:e2e`が成功する。

**実装状況 (2026-07-23)**:

- 独立した`PaymentView`、参加者ごとのPayPay ID／現金設定、精算ごとの外部請求リンク、支払者／受取者／幹事の役割別操作、対象精算deep linkを実装した。
- 受取方法テーブルとactor検証RPC、PayPay ID／公式HTTPSホスト検証、監査ログ、direct table access拒否をマイグレーションとpgTAPへ追加した。PGliteでは8マイグレーションと主要RPCフローを検証済み。実PostgresでのpgTAPはフェーズ9のマイグレーションとまとめてクラウド反映後に実行する。
- Vitest 83件、Production build、Playwright Desktop／Mobile 18件、`git diff --check`が成功した。クラウドDBとNetlifyへの反映はデプロイ回数を抑えるためフェーズ9の検証済みチェックポイントまで保留する。

---

### フェーズ9: LINE／Discordイベントアシスタント

**決定済み方針 (2026-07-23)**:

- BOTを汎用チャットにはせず、通知、状況照会、アプリへの安全な導線を担うイベントアシスタントとする。
- 第一段階は読み取り専用。状態変更は外部アカウントと参加者をワンタイムコードで紐付けた後にだけ許可する。
- Discordの現在のIncoming Webhookは通知用として維持し、双方向操作にはDiscord Application／Interaction Endpointを別途導入する。LINE受信は署名検証済みWebhook／Postbackのみを受け付ける。

**タスク**:

1. 精算確定、支払い報告、受取確認、未払いリマインド、全員完了の通知テンプレートを追加し、対象の支払い画面deep linkを添える。
2. 幹事がアプリから未払い対象だけへ催促できるよう、対象、dedupe key、再送時刻を明示したジョブを生成する。
3. イベント単位の読み取り専用「現在の精算状況」応答を設計する。完了件数、未払い件数、残額を返し、秘密情報や不要な個人情報を含めない。
4. LINE Postback／Discord Interactionの署名検証、イベント連携解決、リプレイ防止、レート制限を実装する。プラットフォームの応答期限内に受付応答し、重い処理はoutboxへ渡す。
5. `member_external_accounts`を使い、アプリが発行する短時間・1回限りのコードで外部ユーザーと参加者を紐付ける。コードそのものはハッシュ保存し、失効・再発行・解除を可能にする。
6. 紐付け完了後に限り「自分の支払い確認」「支払い完了を報告」「受け取りを確認」をBOTから実行できるようにし、既存精算RPCと同等の権限を強制する。
7. レシート画像OCR下書きと日程／出欠操作は将来候補として残し、このフェーズでは実装しない。

**受け入れ条件**:

- 紐付け前はイベント全体の安全な読み取りとアプリへのリンクだけが利用でき、支払い状態を変更できない。
- 紐付け済みユーザーも自分が支払者／受取者である精算だけを操作できる。幹事権限を外部チャット上で暗黙に付与しない。
- 不正署名、期限切れコード、リプレイ、別イベントのID、重複操作を拒否するテストがある。
- LINE／Discordの片方が未設定でも、Webアプリともう一方の通知配送が影響を受けない。
- 実資格情報がない検証環境ではアダプター契約・署名・認可・outboxまでを自動検証し、実配送は`HANDOFF.md`の運用受け入れに残す。

**実装状況 (2026-07-23、前半完了)**:

- 精算確定、支払い報告、受取確認、全員完了をDB状態遷移から既存`notification_jobs`へ自動登録するライフサイクル通知を追加した。登録済みのactiveなDiscord／LINE通知先ごとにジョブを生成し、支払い画面deep linkを添える。
- 幹事の支払い画面へ「未払いの人だけに催促」を追加した。サーバーが`pending`だけを選び、同じ精算・通知先への催促は日本時間の暦日ごとに1回までdedupeする。`reported`／`paid`は対象外。
- service role限定`get_settlement_status_for_bot`は、完了／報告済み／未払い件数、未完了残額、全員完了だけを返し、氏名・受取方法・device tokenを返さない。`event-assistant` Edge Functionは内部secretで保護した読み取り専用`status`契約だけを実装した。
- `payment`／`settlement` deep linkを共通ビルダーへ整理し、共有URLから目的画面へ復帰できる。LINE／Discord署名Webhookと外部アカウント紐付け後の状態変更は後半で実装する。
- Vitest 89件、PGlite 9マイグレーションと通知フロー、Production build、Playwright Desktop／Mobile 20件、`git diff --check`が成功した。新規pgTAP 18 assertionsは追加済みで、フェーズ8・9後半をまとめてクラウドDBへ反映後に実Postgresで実行する。

---

## 6. バックログ(着手承認待ち・未確定の提案)

以下はこれまでの検討で具体的な設計まで詰めたが、**ユーザーからの明示的な着手承認がまだ出ていない**機能。フェーズ番号を割り当てず、承認が出た時点で適切なフェーズ(フェーズ4以降が妥当)に挿入すること。

### 6.1 精算画面の関係マップ(相関図)ビュー — 実装済み

2026-07-23、ユーザーの明示的な指示により`SettlementRelationshipMap`として実装済み。全体表示／自分中心表示、ノードフォーカス、比較カードとの連動、金額チップの非重複配置を含む。現在は選択中の人物に関係しない中立線を非表示にしている。以下の記載は当初仕様として残すが、回帰確認では現行コードと会話で確定した挙動を優先する。

**課題認識**: 幹事視点の精算画面は、参加者が増えるほどペアカード(n人でn(n-1)/2枚)が縦に並び、全体像(誰が誰にいくら支払うか)を把握しにくい。特に4人でも6枚のカードを読まないと構造が見えない。

**設計方針**: 参加者をノード、支払い関係を矢印としたSVG関係マップを、既存のペアカード一覧の**上に追加**する(置き換えではない)。「マップで全体像→カードで金額の根拠→内訳で明細」という3段のドリルダウンを完成させる。

**詳細仕様**:

- データソースは`SettlementView`が既に受け取っている`settlements: Settlement[]`(`fromMemberId` / `toMemberId` / `amount` / `status`を持つ)と`members: Member[]`をそのまま使う。新規ロジックの追加は不要。
- レイアウト: SVG、`viewBox`は幅680固定・高さは人数に応じて可変。ノードは円周上に等間隔配置(角度`360/n`度ずつ)。半径はn=4〜5で160px程度、人数増加時も矢印が重ならない間隔を確保。
- ノード: 円(半径28〜34px)+中央にイニシャル1文字+外側に名前ラベル。色は`memberColor(index)`(2.2節参照)をそのまま使用。
- エッジ: `fromMemberId → toMemberId`への矢印線。線の太さで金額の大小を表現(最大金額を太さ5px、最小金額を1.5pxとして線形補間、または`Math.sqrt(amount)`ベースで補間し極端な差を緩和)。矢印線中央に金額チップ(丸角pill、`--card`背景+`--border`)を配置。矢印同士が交差する場合は二次ベジェ曲線にする。
- 状態表現: `settlement.status`が支払い済みの場合、線を`opacity: 0.35`程度にトーンダウンし、金額チップにチェックマークを添える。
- インタラクション(フォーカスモード): ノードをクリック/タップすると、そのメンバーが`fromMemberId`または`toMemberId`に含まれるエッジだけを通常表示にし、それ以外を`opacity: 0.15`程度まで下げる。もう一度クリックで解除。React側は`useState<string | null>`でフォーカス中のmemberIdを保持する。
- 視点によるデフォルト状態: 幹事視点はフォーカスなし(全体表示)がデフォルト。参加者本人視点は、マウント時点でそのメンバーにフォーカス済みの状態(エゴセントリックビュー)をデフォルトにする。
- 人数スケールの分岐: `members.length <= 6`の場合のみ全体円形マップを描画。7人超の場合は常にエゴセントリックビュー固定とし、幹事視点でも全体図は描画しない(この閾値は定数化し調整しやすくする)。
- アクセシビリティ: SVGルートに`role="img"` + `<title>` + `<desc>`(「〇〇人の精算関係。矢印が支払い方向、太さが金額を表す」等)。ノードクリックは`role="button"` + `tabindex="0"` + Enterキー対応。金額チップのテキストはSVG内`<text>`としてそのまま読み上げ可能にする。
- 配色: 新規のハードコード色は追加せず、既存CSS変数(`var(--card)`, `var(--subtle)`, `var(--border)`等)+`memberColor()`を使用。
- テスト: エッジの太さ計算ロジック(`amountToStrokeWidth(amount, maxAmount): number`のような純関数)を`src/components/ui.ts`に切り出し、`ui.test.ts`にユニットテストを追加。6人以下/7人超の分岐ロジックも同様に純関数化してテスト可能にする。
- 検証: `createFourPersonDemoData`で、幹事視点は6本のエッジが全体表示され、ケンタに矢印が集中する構造が視覚的にわかること。ミナ視点はマウント時点でミナ関連の3本だけがフォーカス表示されること。390px/1280pxの両方でノード・矢印・ラベルが重ならないこと。

**スコープ外(明記)**: 既存のペアカード一覧・内訳表示のリデザインは対象外(現状維持のまま並存)。「まとめて精算(送金最小化アルゴリズムで送金本数そのものを減らす)」機能は対象外。今回はあくまで現行のペアごと精算結果を可視化するだけ。

### 6.2 精算画面の債務マトリクス(表形式)ビュー

**課題認識**: 関係マップは「構造(誰がハブか)」を直感的に見せるには強いが、正確な金額はノードをタップしないと出てこない。マップとカードの中間として、開いた瞬間に全ペアの金額が見える表形式のビューが有効。

**設計方針**: 行=支払う人、列=受け取る人としたグリッド表。対角線は空。有向グラフなので上三角/下三角ではなくフルグリッドが必要(あなた→ケンタとケンタ→あなたは別セル)。

**未確定事項**: このビューは会話内でモックアップ(HTMLウィジェット)としては提示したのみで、6.1のような詳細なコンポーネント設計(ファイル配置、props、状態管理方針)はまだ詰めていない。着手承認が出た場合は、6.1と同様の粒度で改めて詳細仕様を書き起こしてから実装に入ること。想定される位置づけは「マップ(構造把握)」「マトリクス(正確な金額の一覧性)」「カード(詳細根拠)」の3ビュー体制で、幹事視点のデフォルト表示をカード一覧からマトリクスに変更する案も出ている(未決定)。

**実装済み (2026-07-23)**: `SettlementMatrixView`を追加し、関係マップ／金額表のタブで切り替える。行=支払者、列=受取人、対角線と精算なしセルは空表示、有向の6精算を別セルで表示する。支払い済みはチェックと低opacity、金額セル選択は既存比較カード・内訳へ連動する。モバイルは表だけ横スクロール可能にしページ全体の横はみ出しを防止。4人デモの6金額（14,400円を含む）をDesktop／Pixel 5相当で確認し、Playwright全16件が成功。既存の関係マップと比較カードは維持する。

**本番反映 (2026-07-23)**: フェーズ7のオフラインキュー・Sentry基盤・共有URLローテーションと本マトリクスを1回にまとめ、Netlify Deploy `6a61be9b110f068539eaf479`へ反映。Supabaseには通知claimとURLローテーションの2マイグレーションを適用した。新規Chromiumで本番をDesktop 1280px／Mobile 390pxの両方から開き、HTTP 200、6金額、14,400円、ページ横はみ出しなし、console error 0件を確認した。

### 6.3 参加者名の予約語バリデーション(Issue #2)

`memberDisplayName`のロジック修正(フェーズ4で完了)により表示層のバグは解消したが、そもそも参加者が自分の名前として「あなた」「幹事」等の予約語を入力すること自体を防ぐバリデーションは未実装。入力バリデーション層(名前入力フォームの制約)として別途対応する。表示ロジック側で吸収しようとしない(過去にそれで表示バグが発生した経緯があるため)。

**完了 (2026-07-23)**: `validateMemberName`を純粋関数として追加し、共有URL参加画面と幹事代理登録でtrim後の「あなた」「幹事」を拒否する。前後空白、許可語（「あなたさん」「アナタ」「幹事さん」）を含むケースをユニットテストで固定し、入力欄へ`aria-invalid`を付与した。

---

## 7. 参照ファイル一覧(Codex用クイックリファレンス)

| 種別 | パス |
|---|---|
| プロダクト仕様書 | `Warikan/kanji-app-spec.md` |
| 開発引き継ぎメモ(一部古い、2026-07-14基準+07-22追記) | `HANDOFF.md` |
| マイグレーション | `supabase/migrations/20260714000{100,200,300,400}_*.sql` |
| pgTAPテスト | `supabase/tests/database/00{1,2,3}_*.test.sql` |
| Docker不要の検証スクリプト | `scripts/validate-backend.mjs`(`npm run backend:validate`) |
| フロント状態管理 | `src/state/useWarikanApp.ts` |
| フロントエントリ/画面切替 | `src/App.tsx`(ルーターなし、`AppView`列挙のswitch) |
| 精算ドメインロジック | `src/domain/settlement.ts`, `src/domain/types.ts` |
| バックエンドアダプター | `src/backend/supabase.ts`, `src/backend/types.ts`, `src/backend/useSupabaseAuth.ts` |
| デモ/デバッグデータ | `src/data/demo.ts`(`createDemoData`, `createFourPersonDemoData`) |
| スタイル/デザイントークン | `src/styles.css`(`:root`) |
| 共通UIヘルパー | `src/components/ui.ts`(`memberColor`, `memberDisplayName`, `allocatePercentages`等)、テストは`ui.test.ts` |
| 主要UIコンポーネント | `src/components/{HomeView,SettlementView,AdvanceDashboardView,ExpenseForm,EventSettingsView,CreateWizard,DebugPerspectiveSwitcher,TestResetButton}.tsx` |
| Netlifyデプロイ設定 | `netlify.toml` |
| PWA/ビルド設定 | `vite.config.ts` |

---

## 8. 着手前の最終チェックリスト

新しいセッションでこのロードマップに基づいて作業を始める際は、以下を必ず実施すること。

1. `git log --oneline`で`main`ブランチの現在のHEADを確認し、本書の記載(2.1節)と食い違いがないか確認する。
2. `npm ci && npm test && npm run build && npm run backend:validate`を実行し、本書記載のテスト件数(36件)と現状が一致するか確認する。数値が食い違う場合、本書の記載が古くなっている可能性があるため、実際のコードを優先し、必要であれば本書を更新する。
3. どのフェーズから着手するかが不明な場合は、フェーズ番号順(0 → 0.5 → 1 → 2 → …)を既定の優先順位とする。ただし人間のオーナーから明示的な指示があればそれに従う。
4. バックログ(6節)の項目には、明示的な着手指示がない限り着手しない。

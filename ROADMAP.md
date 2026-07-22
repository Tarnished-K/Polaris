# Polaris(幹事アプリ / Warikan)開発ロードマップ — Codex向け

最終更新: 2026-07-23
対象読者: このリポジトリで作業するCodex(実装エージェント)。人間のオーナー向けの説明は含まない。すべてのタスクは既存コードを直接確認した上で記載している。着手前に該当ファイルを実際に読み、本書の記載と現状にズレがないか必ず確認すること。

---

## 0. このドキュメントの使い方

- 本書は上から順に着手する前提のフェーズ構成になっている。フェーズ番号は依存関係の順序であり、優先度の絶対順ではない(例: フェーズ0.5は並行着手可能)。
- 各フェーズには「やること」「受け入れ条件」「検証コマンド」を記載する。受け入れ条件を満たさない実装はマージしない。
- 「未解決の設計判断」セクションに列挙した項目は、着手前に必ず決定してからコードを書くこと。決定した内容は本書または`HANDOFF.md`に追記すること。
- 末尾の「バックログ」は着手承認待ちの機能。フェーズ番号がついていないものはユーザーの明示的な指示があるまで着手しないこと。

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
- **v2(課金開始)**: レシートOCR(撮影で金額入力、Claude API vision使用) / 送金リンク連携(PayPay等へ誘導。membersに送金先情報カラムが増える想定) / Proプラン

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

- `event_integrations` / `notification_jobs` / `notification_deliveries` テーブルと、`organizer_upsert_integration` / `organizer_queue_notification` RPCまでは実装済み。つまり「連携の登録」「通知ジョブをキューに積む」ところまではできる。
- **実際にLINE/Discord APIへ送信するdispatcher(ワーカー)コードは存在しない**。`package.json`にLINE/DiscordのSDKも入っていない。Supabase Edge Functionsのディレクトリ自体もリポジトリに存在しない。
- 方針: dispatcherはSupabase Edge Functions(Deno)に実装する。理由は2.7節参照。

### 2.6 フロントエンド⇔バックエンド接続状況

- `src/backend/supabase.ts`の`createWarikanBackend(config)`は、上記RPCのうち14個(`createEvent`, `getEventState`, `joinEvent`, `claimMember`, `addExpense`, `updateExpense`, `saveOwnFixedAmount`, `finalizeExpense`, `deleteExpense`, `finalizeEvent`, `unfinalizeEvent`, `reportSettlement`, `confirmSettlement`, `revertSettlement`)をラップしたクライアントメソッドを既に持っている。
- しかし`src/App.tsx`から実際に呼ばれているのは**`backend.createEvent()`のみ**。それ以外の13メソッドはコード上に存在するがどこからも呼ばれていない。
- 認証: `src/backend/useSupabaseAuth.ts`がGoogle OAuth開始・セッション復元・ログアウトを実装済み。ただし**Supabaseダッシュボード側でGoogleプロバイダーがまだDisabled**であり、Google Cloud側のOAuth Web Client(Client ID / Secret)も未作成のため、実際にはログインボタンを押しても成功しない。
- 共有URL: `createEvent`成功時に`window.history.replaceState(null, '', `/e/${remote.event.shareToken}`)`でURLの見た目だけを書き換えている。**しかし、ページの初回マウント時にこのURLパスを解析して`get_event_state`を呼ぶ処理が一切存在しない**。つまり、この共有URLを別端末・別タブで開いても真っ白(または初期状態)にしかならない。フェーズ2で最優先に実装すること。
- `src/backend/types.ts`は手書きのTypeScript interfaceであり、`supabase gen types typescript`等によるDBスキーマからの自動生成は行われていない。マイグレーションを変更した際に型が追従しない(ズレる)リスクがある。

### 2.7 ホスティング・インフラ方針(決定済み)

- ホスティングはNetlify(静的サイト配信 + SPAリダイレクト設定のみ、Netlify Functionsは使用しない方針)を継続する。利用者増加時のボトルネックはNetlifyではなくSupabase側(Postgres接続数・compute plan)であるため、Netlifyを見直す必要はないと判断済み。
- 将来、レシートOCR(Claude API vision)のようにサーバー側で秘密鍵を扱う処理が必要になった場合は、**Netlify Functionsではなく Supabase Edge Functions に実装を一本化する**。理由: (1) LINE/Discord通知dispatcherも同じ理由でSupabase Edge Functionsに実装する方針であり、秘密鍵を扱うサーバーレス実行環境を1箇所に集約したい。(2) Edge FunctionからPostgres・RLS・`auth.uid()`のコンテキストへ同一プロジェクト内でシームレスに接続できる。
- PayPay連携(v2)は仕様上「送金リンクへの誘導」のみであり、実送金APIの署名付き呼び出し等は行わない設計(1.3節の恒久制約)。そのためPayPay連携自体はサーバー側の秘密鍵管理を必要としない見込み(v2着手時に要再確認)。

### 2.8 テスト状況

- `main`ブランチ: テストファイル5本(`src/backend/supabase.test.ts`, `src/components/ui.test.ts`, `src/data/demo.test.ts`, `src/domain/settlement.test.ts`, `src/lib/random.test.ts`)、**34件のユニットテストが成功**(`npm test`で確認済み)。
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

## 4. 未解決の設計判断(着手前に決定すること)

以下はHANDOFF.mdおよび本書作成時点で未決定のまま残っている項目。該当フェーズに着手する前に必ず決定し、決定内容を`HANDOFF.md`および関連コードのコメントに残すこと。

1. **TypeScript精算エンジンとPostgres finalize処理の一貫性**: `src/domain/settlement.ts`(フロント用)とPL/pgSQL側の`finalize_event`等(バックエンド用)は、現状同じ計算ロジックを2箇所に実装している状態。フェーズ2着手時に以下のいずれかを決定すること。
   - (a) 契約テストを書く: 同一の入力データセットをTS版・RPC版の両方に投げ、出力が完全一致することをテストで保証する。
   - (b) Edge Functionで精算ロジックをTypeScriptとして一本化し、PL/pgSQL側は薄いラッパーにする。
   - (c) PL/pgSQL側を正とし、フロント側の計算はプレビュー表示専用(サーバー確定値と食い違い得る前提)と割り切る。
   いずれを選んでも、選定理由をHANDOFF.mdに残すこと。
2. **`unfinalize_event`時、既にreported/paidの精算が存在する場合の再確認フロー**: 現状RPC(`unfinalize_event`は`p_force`引数を持つ)はあるが、フロント側でどう確認ダイアログを出すか未設計。フェーズ2で設計すること。
3. **精算内訳(`settlement_items`)をRPCレスポンスとしてどう返すか**: 型定義が未確定。フェーズ2で`src/backend/types.ts`(または自動生成型)に反映すること。
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

### フェーズ1: Google認証を実際に有効化する

**タスク**:
1. Google CloudでOAuth Web Clientを作成し、承認済みリダイレクトURIへ`https://nrixujdkgvexnnqfoned.supabase.co/auth/v1/callback`を追加する。(この作業自体は人間のオーナーがGoogle Cloud Consoleで行う必要がある。Codexが担当できるのは、必要な設定値・手順をドキュメント化するところまで。)
2. Supabase Dashboard > Authentication > Sign In / Providers > Google にClient ID / Secretを設定し、有効化する。(同上、ダッシュボード操作は人間側の作業。)
3. Authentication > URL ConfigurationへローカルURL(`http://localhost:5173`等)と本番URLを登録する。
4. コード側の対応: `src/backend/useSupabaseAuth.ts`の`signInWithGoogle`は実装済みのため、追加のコード変更は基本的に不要なはず。ただし、ログイン後のリダイレクト先(`redirectTo: new URL('/', window.location.origin).toString()`)が、共有URL経由でアクセスしていた場合に元のイベントページへ戻れるかを確認し、必要であれば`redirectTo`にリダイレクト前のパスを含める改修を行う。
5. E2E確認: ローカル画面の「Googleでログイン」から実ログイン→`create_event`→共有URL発行までを確認する。

**受け入れ条件**: 実ブラウザでGoogleログインが完了し、`auth.user`が取得でき、`create_event`が認証済みユーザーとして成功する。

---

### フェーズ2: localStorage状態層をSupabaseへ接続する(最重要の配線フェーズ)

**背景**: `createWarikanBackend`のRPCラッパーは14個中1個(`createEvent`)しか呼ばれていない。ここを埋めない限り、複数人での実利用は不可能。

**タスク(優先順位順)**:

1. **共有URL参加フローの新規実装**(現状これ自体が存在しない):
   - `src/App.tsx`(または新設するルーティング用フック)に、マウント時の`useEffect`で`window.location.pathname`を解析し、`/e/{shareToken}`形式であれば`backend.getEventState(shareToken)`を呼ぶ処理を追加する。ルーティングライブラリの新規導入は不要。単純なパス解析で足りる。
   - 取得した`EventState`を`loadRemoteEvent`(既に`useWarikanApp.ts`に存在するメソッド)へ渡し、画面に反映する。
   - 初回訪問(未参加)の場合は名前入力UIを表示し、`join_event`を呼ぶ。
   - 既知のデバイストークン(localStorageに保存済み)がある場合は`claim_member`または`get_event_state`のactor解決で自動的に本人と紐付ける。
   - デバイストークンの生成には既存の`generateDeviceToken()`(`src/backend/supabase.ts`)を使うこと。

2. **支出まわりの接続**: `add_expense` / `update_expense` / `save_own_fixed_amount` / `finalize_expense` / `delete_expense`を、`src/components/ExpenseForm.tsx`および`useWarikanApp.ts`内の対応するローカル関数(`addExpense` / `saveDraftExpense` / `finalizeExpense`等)から、`backend`が存在する場合はRPC経由に切り替える。`backend`が`null`(Supabase未設定)の場合は既存のlocalStorageロジックにフォールバックする設計を維持する(開発中のオフライン確認用途として)。

3. **精算まわりの接続**: `finalize_event` / `unfinalize_event` / `report_settlement` / `confirm_settlement` / `revert_settlement`を同様に接続する。`unfinalize_event`呼び出し時は、4節-2で決定した再確認フローをここで実装する。

4. **リアルタイム同期の追加**(このフェーズで一緒に行うのが効率的): Supabase Realtimeを使い、`expenses` / `expense_targets` / `settlements` / `settlement_items`テーブルのPostgres Changesを購読し、他の参加者の入力を画面へ即座に反映する。実装方針:
   - `supabase.channel('event:{eventId}').on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `event_id=eq.${eventId}` }, callback)`のようなチャンネル購読を`useWarikanApp.ts`(またはRealtime専用の新規フック`useEventRealtime.ts`)に実装する。
   - RLSが有効なテーブルに対するRealtime購読は、Supabase側でRealtime用のRLSポリシー(`for select`)が必要になる場合があるため、フェーズ0で洗い出した権限マトリクスと矛盾しないことを確認する。
   - 楽観的UI更新(自分の操作は即座に画面反映し、裏でRPCが確定する)も検討するが、必須ではない。まずは他者の変更が数秒以内に画面へ反映されることを優先する。

5. **localStorage永続化ロジックの縮小**: `backend`が存在する場合は`localStorage`への保存を段階的に無効化する。ただし、フェーズ7のオフライン対応(電波が無い間の下書き保存)と競合しないよう、「未送信の下書き」用途のlocalStorage利用は残す設計にすること。

6. `src/backend/types.ts`の手書きinterfaceを、可能であれば`supabase gen types typescript`によるDBスキーマからの自動生成に置き換える(このタスクはフェーズ6と重複するため、フェーズ2で先に着手しても構わない)。

**受け入れ条件**:
- 別端末・別ブラウザで共有URLを開いた際に、実際のイベントデータ(参加者・支出・精算状況)が表示される。
- 参加者Aが支出を追加すると、参加者Bの画面が(リロードなしで)数秒以内に更新される。
- `createFourPersonDemoData`相当のシナリオを、Supabase接続状態で実際に複数ブラウザタブを使って再現し、精算結果がフロントのドメインロジック(`src/domain/settlement.ts`)と一致することを確認する。

---

### フェーズ3: 本番デプロイとマルチデバイス確認

**タスク**:
1. NetlifyへHTTPSデプロイする(`netlify.toml`は既に存在するため設定変更は基本的に不要)。
2. 複数スマートフォンで、共有URL発行→別端末で参加→支出入力→精算確定までのE2Eフローを確認する。
3. PWAインストール(ホーム画面追加)を実機で確認する。

**受け入れ条件**: 本番URL経由で複数デバイスから同時にイベントへ参加し、リアルタイムに反映される支出・精算状況を確認できる。

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

---

### フェーズ6: フロントエンドの磨き込み

**タスク**:
1. **コード分割**: `React.lazy` + `Suspense`を使い、幹事専用画面(`EventSettingsView.tsx`)や使用頻度の低い画面を動的importに変更し、初回バンドルサイズを削減する。
2. **型の自動生成**: `supabase gen types typescript --project-id nrixujdkgvexnnqfoned`(またはローカルスキーマから)で生成した型を`src/backend/generated-types.ts`等に配置し、`src/backend/types.ts`の手書きinterfaceをこれで置き換えるか、これをベースにした型に統一する。マイグレーション変更時に型生成コマンドを再実行する運用をREADMEに明記する。
3. **マイクロインタラクション**: ボタン押下時のフィードバック、データ取得中のスケルトンローディング表示、支出追加・精算操作の楽観的UI更新(サーバー応答を待たずに画面へ即時反映し、失敗時にロールバックする)を追加する。既存の`app-view-enter`アニメーション(`styles.css`)との一貫性を保つこと。
4. **E2Eテスト自動化**: Playwrightを導入し、以下の基本シナリオを自動テスト化する。
   - イベント作成 → 支出追加(均等割り・金額指定の両方) → 精算確定 → 支払い報告・確認の一連のフロー
   - `createFourPersonDemoData`を使った幹事視点・参加者視点の双方での精算画面表示確認
   - モバイル幅(390px)・デスクトップ幅(1280px)のレイアウト崩れがないことの確認
   これらをフェーズ0.5のCIワークフローに組み込む。

**受け入れ条件**: Lighthouseパフォーマンススコアの初回計測値を記録し、コード分割後に初回読み込みJSサイズが計測可能な形で削減されていること。PlaywrightのE2EテストがCI上で自動実行され成功すること。

---

### フェーズ7: 運用耐性の強化

**タスク**:
1. **オフライン対応の強化**: 電波が無い状態で支出入力操作を行った場合、`localStorage`(またはIndexedDB)に「未送信の下書き」として保持し、オンライン復帰を検知した時点で自動的にRPCへ送信するキューイング機構を実装する。`navigator.onLine`とオンライン/オフラインイベントリスナーを使う。既存の`vite-plugin-pwa`のService Worker設定との整合を確認すること。
2. **エラー監視**: Sentry等のエラートラッキングサービスを導入し、フロントエンドの実行時エラーを収集する。個人情報(参加者名等)がエラーレポートに含まれないようスクラビング設定を行う。
3. **共有URLのセキュリティ強化**: 参加者はログイン不要で共有URL(`share_token`)のみでアクセスできる設計のため、総当たり攻撃やレートリミット未設定によるアクセス試行のリスクがある。Supabase側のRate Limiting機能、またはRPC呼び出し頻度に対する簡易的なレートリミット(例: 同一IPからの`get_event_state`呼び出し回数制限)を検討する。`share_token`の生成に十分なエントロピー(既存実装で32byteランダム値相当)が使われていることも改めて確認する。

**受け入れ条件**: オフライン状態で入力した支出が、オンライン復帰後に自動送信され、他の参加者の画面にも反映されることを実機で確認する。エラー監視サービスのダッシュボードで実際のエラーが収集されることを確認する。

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

### 6.3 参加者名の予約語バリデーション(Issue #2)

`memberDisplayName`のロジック修正(フェーズ4で完了)により表示層のバグは解消したが、そもそも参加者が自分の名前として「あなた」「幹事」等の予約語を入力すること自体を防ぐバリデーションは未実装。入力バリデーション層(名前入力フォームの制約)として別途対応する。表示ロジック側で吸収しようとしない(過去にそれで表示バグが発生した経緯があるため)。

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
2. `npm ci && npm test && npm run build && npm run backend:validate`を実行し、本書記載のテスト件数(main: 34件)と現状が一致するか確認する。数値が食い違う場合、本書の記載が古くなっている可能性があるため、実際のコードを優先し、必要であれば本書を更新する。
3. どのフェーズから着手するかが不明な場合は、フェーズ番号順(0 → 0.5 → 1 → 2 → …)を既定の優先順位とする。ただし人間のオーナーから明示的な指示があればそれに従う。
4. バックログ(6節)の項目には、明示的な着手指示がない限り着手しない。

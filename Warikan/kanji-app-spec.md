# 幹事アプリ v1 実装仕様書(Codex向け)

グループイベント(飲み会・旅行)の割り勘・立て替え精算アプリ。
幹事がイベントを作成しURLを共有、参加者はログイン不要でブラウザから参加する。

- フロントエンド: React + PWA(参加者はインストール不要、ブラウザで完結)
- バックエンド: Supabase(Postgres + Auth + RPC)
- 対象通貨: JPY のみ(整数・円単位)
- v1 スコープ: 精算コアのみ。日程調整・リマインド・課金は含まない

---

## 0. プロダクト背景とロードマップ(実装前に読むこと)

### 0.1 コンセプトと戦略
北極星は **「幹事業務が1つのURLで完結する」** こと。幹事の仕事は
①日程調整 → ②場所決め → ③出欠確定 → ④当日 → ⑤集金・精算 のパイプラインであり、
現状は調整さん・LINE・PayPay 等を行き来している。本アプリはこれを1イベント=1URLに統合する。
ただし入口は⑤の精算で、v1 は精算だけで独立して価値が成立する設計とする
(精算で使った幹事が「次は最初からこれで」となる導線で①②③へ拡張していく)。

飲み会と旅行は別モードとして作らない。イベントの期間タイプが UI の複雑さを決める
**単一のデータモデル** で両対応する。カテゴリはイベント作成時に事前選択せず、
支出を追加するたびに全カテゴリから選ぶ。「終日」なら実質シンプルな飲み会集金画面に縮退し、
宿泊イベントなら実際に登録されたカテゴリのタブと日別表示を持つ旅行画面になる。

個人開発・低コスト運用が前提。マネタイズは将来の Pro プラン(月額数百円 or イベント単位買い切り)
を想定するが、無料でも十分使える状態を常に維持する。

### 0.2 ロードマップ(v1 実装時に将来の拡張余地を意識すること)
- **v1(本仕様書)**: 精算エンジン / 共有URL参加(デバイス紐付け)/ 済管理・催促文生成
- **v1.5**: 日程調整・出欠(調整さん代替。events に候補日テーブルが増える想定)/
  リマインド(当面はコピペ用文面生成、LINE 公式 API 連携はしない)/
  傾斜割りプリセット(「先輩多め」「幹事無料」「飲まない人−1,000円」等。
  split_method に 'weighted' 系の値が追加される想定 → **拡張しやすい設計にしておく**)
- **v2(課金開始)**: レシートOCR(撮影で金額入力。Claude API vision 使用)/
  送金リンク連携(PayPay 等へ誘導。members に送金先情報カラムが増える想定)/
  Pro プラン(傾斜割り高度版・イベント数無制限・広告非表示など)

### 0.3 主要な設計判断とその理由(変更する場合は要相談)
- **参加者はアカウントレス**: 参加者に登録・インストールを要求した幹事系サービスは
  普及しない(調整さんが勝った理由)。参加者体験は「URLを開いて名前をタップ」以上に重くしない。
- **アプリ内でお金を動かさない**: 送金・預かりを実装すると資金決済法の資金移動業
  ライセンスが必要になる。本アプリは記録・計算・可視化に徹し、実送金は外部
  (PayPay・現金等)に委ねる。これは v2 以降も不変の制約。
- **精算は相手ごとに自動集約し手動設定不可**: 同じ相手との複数支出をまとめ、
  反対方向の立て替えを差し引いた純額だけを支払う。差し引き前後の支出内訳と計算式を必ず表示する。
- **端数は支払者負担**: 「誰か1人だけ1円多い」より説明しやすく、計算が決定的になる。
- **やらないことリスト(恒久)**: チャット機能(LINEと競合しない・共存する)、
  決済代行、店・宿の予約 API 連携(リンク共有で十分)。

---

## 1. 認証・識別モデル(最重要)

### 幹事(イベント作成者)
- Supabase Auth の Google ログインを使用する。
- 幹事は `events.organizer_user_id` で識別される。

### 参加者(ログインなし)
- 共有URL `https://<domain>/e/{share_token}` からアクセスする。
- 初回に名前を入力すると、クライアントがデバイストークン(ランダム32byte)を生成して
  localStorage に保存し、サーバーには **ハッシュ(SHA-256)のみ** を保存する。
- 以後、そのブラウザ = そのメンバー。`share_token + device_token` の組で本人性を検証する。

### 権限マトリクス

| 操作 | 幹事 | 参加者本人 | 他の参加者 |
|---|---|---|---|
| イベント作成・設定変更・削除 | ○ | × | × |
| 定員変更 | ○ | × | × |
| 代理メンバー登録 / 紐付け解除 / 名前統合 | ○ | × | × |
| 精算確定(finalize) | ○ | × | × |
| メンバー参加(名前入力) | ○ | ○(自分) | × |
| 支出の追加 | ○ | ○ | ○(全員可) |
| 支出の編集・削除 | ○ | 支払者本人のみ | × |
| 暫定支出の確定 | ○ | 支払者本人のみ | × |
| 暫定支出への自分の負担額の途中保存 | ○ | 対象者本人のみ | × |
| 支払い完了の報告(pending→reported) | ○(代行可) | from 本人のみ | × |
| 支払いの確認(reported→paid) | ○(代行可) | to 本人のみ | × |
| 直接 paid にする(現金手渡し等) | ○ | to 本人のみ | × |
| 報告・確認の取り消し(1段階戻す) | ○ | 当該操作をした本人 | × |
| 閲覧(支出一覧・精算状況) | すべて | 自分が関係する項目のみ | 自分が関係する項目のみ |

### セキュリティ実装方針
参加者は Supabase Auth を通らないため、**RLS だけで書き込み制御をしない**。
参加者側の読み書きはすべて Postgres 関数(RPC, `security definer`)経由とし、
関数内で `share_token` と `device_token` ハッシュを検証してから操作する。
anon ロールにはテーブルへの直接 SELECT/INSERT/UPDATE/DELETE を一切許可しない
(RLS を有効化し、ポリシーを作らないことで全拒否)。
幹事側は authenticated ロール + RLS(`organizer_user_id = auth.uid()`)で
直接テーブル操作してよいが、実装統一のため幹事操作も RPC に寄せて構わない。

---

## 2. テーブル定義

```sql
-- イベント
create table events (
  id                uuid primary key default gen_random_uuid(),
  share_token       text unique not null,           -- URL用。crypto乱数 22文字以上
  organizer_user_id uuid not null references auth.users(id),
  title             text not null,
  event_type        text not null check (event_type in ('single_day','overnight')),
  start_date        date not null,
  end_date          date not null,                  -- single_day の場合 start_date と同値
  capacity          int  not null check (capacity between 2 and 50),
  status            text not null default 'active' check (status in ('active','finalized')),
  finalized_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- メンバー
create table members (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  name              text not null,                  -- 同名は登録時にサフィックス付与(例: けんた(2))
  device_token_hash text,                           -- null = 代理登録済み・未紐付け
  is_organizer      boolean not null default false,
  claimed_at        timestamptz,                    -- 紐付け完了時刻
  created_at        timestamptz not null default now(),
  unique (event_id, name)
);

-- 支出
create table expenses (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  category          text not null check (category in ('lodging','transport','food','activity','shopping','other')),
  title             text not null,
  amount            int  not null check (amount > 0),   -- 円・整数
  payer_member_id   uuid not null references members(id),
  split_method      text not null default 'equal' check (split_method in ('equal','fixed')),
  status            text not null default 'finalized' check (status in ('draft','finalized')),
  day_index         int,                            -- 何日目か(1始まり・任意。overnight時のみUI表示)
  created_by_member_id uuid not null references members(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 支出の対象者
create table expense_targets (
  expense_id   uuid not null references expenses(id) on delete cascade,
  member_id    uuid not null references members(id),
  fixed_amount int check (fixed_amount >= 0),       -- draft では null/一部入力可。finalized 時に合計を検証
  primary key (expense_id, member_id)
);

-- 精算(確定時にスナップショットとして生成)
-- 状態遷移: pending(未払い) → reported(確認待ち) → paid(済)
--   ・from 本人が「支払い完了報告」→ reported
--   ・to 本人が「支払い完了確認」→ paid
--   ・to 本人は pending から直接 paid にもできる(現金手渡し等)
--   ・取り消しは1段階のみ戻せる(paid→reported は確認者、reported→pending は報告者 or 幹事)
create table settlements (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  from_member_id  uuid not null references members(id),
  to_member_id    uuid not null references members(id),
  amount          int  not null check (amount >= 0), -- 完全相殺は0円で内訳表示のみ
  gross_amount    int  not null check (gross_amount >= 0),
  offset_amount   int  not null check (offset_amount >= 0),
  status          text not null default 'pending' check (status in ('pending','reported','paid')),
  reported_at     timestamptz,
  reported_by_member_id  uuid references members(id),
  confirmed_at    timestamptz,
  confirmed_by_member_id uuid references members(id),
  created_at      timestamptz not null default now()
);

-- 精算内訳。direction='charge' は from の負担、'offset' は逆方向の立て替え
create table settlement_items (
  settlement_id uuid not null references settlements(id) on delete cascade,
  expense_id    uuid not null references expenses(id),
  direction     text not null check (direction in ('charge','offset')),
  amount        int not null check (amount > 0),
  primary key (settlement_id, expense_id, direction)
);

-- 操作ログ(監査用・全書き込み操作をRPC内で記録)
create table activity_logs (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references events(id) on delete cascade,
  member_id  uuid references members(id),
  action     text not null,        -- 'join','add_expense','edit_expense','delete_expense','report_payment','confirm_payment','revert_settlement','finalize','claim_member' など
  detail     jsonb,
  created_at timestamptz not null default now()
);
```

補足:
- 暫定精算(finalize 前)は **DB に保存しない**。クライアントが支出一覧から
  都度計算して表示する(§4 のエンジンをフロント側の純粋関数として実装し、
  finalize 時にサーバー側で同じロジックを実行して settlements に書き込む。
  ロジックは TypeScript の共有モジュールにして二重実装を避けること)。
- finalize 後は expenses への追加・編集・削除を RPC 側で拒否する。
  幹事は「確定解除」ができる(settlements を削除して status='active' に戻す。
  ただし reported / paid が1件でもあれば解除時に警告を返す)。
- 金額指定で対象者または負担額が未入力、もしくは合計が支出額と一致しない支出は
  `status='draft'` として保存する。イベント合計には含めるが、負担額・精算計算からは除外する。
- 暫定支出を確定できるのは立替え者本人または幹事のみ。すべての対象者と負担額を入力し、
  合計一致を検証して `finalized` にする。暫定支出が1件でもあればイベント全体を finalize できない。
- 金額指定の対象参加者は、自分の `fixed_amount` だけを途中保存できる。対象者の追加・除外、
  他人の金額変更、支出の最終確定はできない。立替え者または幹事は全員分を編集・途中保存できる。

---

## 3. RPC(Postgres 関数)一覧

すべて `security definer`。共通の最初の処理として
`share_token` からイベントを引き、`device_token` の SHA-256 が members に存在するか検証する。
検証に失敗したら例外。成功したら操作ごとの権限チェック(§1 の権限マトリクス)を行う。

| 関数 | 引数(share_token, device_token のほか) | 権限 |
|---|---|---|
| `get_event_state` | なし | 誰でも(device_token 不要。閲覧のみ) |
| `join_event` | name | 未参加者。定員チェック・同名サフィックス付与・トークンハッシュ登録 |
| `claim_member` | member_id | 未紐付けメンバーに対して自デバイスを紐付け |
| `add_expense` | category, title, amount, payer_member_id, split_method, day_index, targets[] | 参加者全員 |
| `update_expense` / `delete_expense` | expense_id, ... | 支払者本人 or 幹事 |
| `finalize_expense` | expense_id, targets[] | 支払者本人 or 幹事。金額指定の合計一致が必須 |
| `report_settlement`(pending→reported) | settlement_id | from 本人 or 幹事 |
| `confirm_settlement`(reported→paid / pending→paid) | settlement_id | to 本人 or 幹事 |
| `revert_settlement`(1段階戻す) | settlement_id | paid→reported は確認者本人 or 幹事 / reported→pending は報告者本人 or 幹事 |
| `finalize_event` / `unfinalize_event` | なし | 幹事のみ |
| `organizer_add_member`(代理登録) | name | 幹事のみ |
| `organizer_unclaim_member`(紐付け解除) | member_id | 幹事のみ |
| `organizer_update_event` | capacity など | 幹事のみ |

`get_event_state` は画面描画に必要な全データ(イベント・メンバー・支出・対象者・
確定済みなら settlements)を1回で返す JSON を設計すること。

---

## 4. 精算エンジン仕様(共有 TypeScript モジュール)

### 4.1 負担額の計算(split)
支出1件ごとに各対象者の負担額を決める。

- `equal`: n = 対象者数。各自 `floor(amount / n)` 円を負担し、
  端数 `amount mod n` 円は **支払者が負担**する(対象者に配らない)。
  支払者が対象者に含まれない場合も端数は支払者負担。決定的で説明しやすいルールを優先。
- `fixed`: expense_targets.fixed_amount をそのまま使う。
  追加時点では未入力・一部入力を許可して暫定支出にする。精算計算には含めず、
  `finalize_expense` 時に全対象者の入力と合計=amountを必須にする。

### 4.2 収支(balance)の計算
メンバーごとに `balance = 支払った合計 − 負担した合計` を求める。
正 = 受け取る側、負 = 払う側。全メンバーの balance 合計は必ず 0(端数ルールにより保証される)。

### 4.3 相手ごとの精算生成
確定済み支出ごとに「対象者が立替え者へ払う負担」を作り、同じ2人の組で集約する。
反対方向の負担があれば差し引き、純額の大きい方向を1件の精算として生成する。

- `gross_amount`: 支払う方向の負担合計
- `offset_amount`: 逆方向の立て替え合計
- `amount = gross_amount - offset_amount`
- `settlement_items` に両方向の元支出と金額を保存し、画面で計算式まで表示する
- 完全相殺時も0円の行を残して「支払い不要」と内訳を表示し、状態は自動的に paid とする
- 暫定支出は計算対象外

### 4.4 テスト(Codex は最初にここから着手すること)
エンジンは UI から独立した純粋関数として実装し、以下のケースを含む単体テストを先に書く:
1. 均等割り・割り切れる / 割り切れない(端数は支払者負担)
2. 支払者が対象者に含まれる / 含まれない
3. fixed の合計不一致で拒否
4. 全員の balance 合計 = 0 の不変条件
5. 同一相手への複数負担が1件に集約される
6. 逆方向の立て替えが差し引かれ、両方向の内訳と計算式が一致する
7. 途中参加(一部の支出のみ対象)のケース
8. 支出0件 → 送金0件

---

## 5. 画面仕様(デザイン確定版)

Claude Design の採用案 **「2a 統合版」(作成1a・ホーム1c・支出入力1a・精算=報告→確認フロー)+「3a ブラウザ版」** に基づく。
ビジュアル(色・余白・角丸・フォント)は DESIGN.md と design/reference/ を正とする。
デザイン上の主な特徴: クリーム系背景 + オレンジのプライマリ、ピル型チップ、カード型リスト、
カテゴリ別モノグラム(円形アイコンに漢字1文字: 宿/交/食/観/買/他 + カテゴリ別の色)。

### レスポンシブ方針
- モバイル(〜768px): 1カラム。下部固定バー + FAB。支出入力・精算は全画面遷移
- デスクトップ(768px〜, 3a準拠): ヘッダー横長化(イベント名・メンバーチップ・共有リンクコピーを1行に)。
  ホームは2カラム(左: 支出リスト / 右: 負担額カード + 支出追加ボタンのサイドレール)。
  支出入力はモーダル表示。精算は左に自分のカード・右に全員の状況リスト

### 5.1 イベント作成ウィザード(幹事・要ログイン)
- 上部: 「新しいイベント」+ ステップ進捗バー(1/3 表示、3分割のバーが順に塗られる)
- ステップ: ①イベント名(補足文「共有リンクを開いた参加者に表示されます。作成後にURLをLINEに貼るだけで招待できます」)
  → ②期間タイプ(終日/1泊2日/2泊以上、日付ピッカー)→ ③定員
- 下部: 「戻る」(セカンダリ・小)+「次へ」(プライマリ・大)。最終ステップは「作成する」
- 作成完了後: 共有URL(`/e/{share_token}`)を表示し「共有リンクをコピー」ボタン

### 5.2 イベントホーム(全員)
- ヘッダー: イベント名 + 期間バッジ(例「1泊2日」)+ 日付範囲 + メンバー名チップ一覧。
  デスクトップではここに「共有リンクをコピー」ボタン
- カテゴリタブ: 「すべて」+ 実際に支出が登録されているカテゴリのみをピル型で表示。横スクロール可
- 支出リスト: **日付見出しでグルーピング**(例「3/14(土)」)。overnight イベントのみ。
  day_index 未設定の支出は「日付未指定」グループに表示。single_day はグルーピングなしのフラットリスト
- 支出行: カテゴリモノグラム + 内容 + 金額(右寄せ・太字)。負担関係は
  「立替: 〇〇」「負担する人: 〇〇、〇〇」「n人で均等割り・1人あたり¥◯◯」
  または「金額指定・入力済み人数」のように、誰が誰の分を立て替えたかと割り方を明示する
- リスト末尾: 「イベント合計 ¥◯◯」
- 立替グラフはホーム右カラムに重複表示せず、ヘッダー中央のタブから専用ページへ移動する
- 支出カードはカテゴリ色の左罫線、カテゴリ、支出名、金額、立替者、割り方の順で視覚階層を作る。
  「負担する人」は「立替対象」と表記し、対象者名をカテゴリフィルターと同系統のピルで表示する
- 立替者も立替対象と同じ人物ピルで表示する。参加者色はメンバー配列順から決定的に生成し、
  最大定員50人の全員に異なる色を用意する。ヘッダー、支出カード、参加者フィルター、グラフで色を統一する
- カテゴリフィルターに加え参加者フィルターを設け、選択した人が立替者または立替対象の支出だけを表示する
- 金額指定の支出カードは「金額内訳を見る」で展開し、対象者ごとの指定額（未入力なら未入力）を表示する
- 上部イベントヘッダー中央に「支出イベント / 立替ダッシュボード / みんなの精算状況」の3タブを置く。
  PCではヘッダー全体の中央へ固定し、スマホでは3等分して1段で表示する
- ヘッダー右側には幹事視点だけ「イベント設定」を表示し、イベント自体の編集画面へ移動できるようにする
- ヘッダー右側にデバッグ用「最初から」を常設し、イベント作成トップへ戻せるようにする。リリース時に削除する
- 下部固定バー: 「あなたの負担額」+ 暫定バッジ(黄)+ 金額(大)+
  disabled の「精算へ（準備中）」ボタン。
  補足文「支出が追加されるたびに自動で再計算されます」
- Web MVPでは精算状況をヘッダータブから開く。「精算へ」は準備中のdisabledボタンとして残し、
  将来決める精算実行UIのために導線だけ確保する
- FAB(+)で支出入力へ

**立替ダッシュボード（全員）**:
- 視点切り替え中の本人について、確定済み支出だけを集計する。暫定支出は確定後に反映する
- 上部に「自分が立て替え中」「立て替えてもらった」「差し引き」の3指標を表示する
- 1段目は受け取る側の内訳として「自分が立て替えた支出イベントごとの割合」と
  「誰の分を立て替えたか」を2つのドーナツグラフで表示する
- 2段目は支払う側の内訳として「何の支出イベントで立て替えてもらったか」と
  「誰にいくら立て替えてもらったか」を2つのドーナツグラフで表示する
- 各凡例には支出名または人物名、割合、金額を併記する。支出はカテゴリ色、人物は共通の参加者色を使う

### 5.3 支出入力(全員)
- モバイル: 全画面(「‹ 支出を追加」ヘッダー)/ デスクトップ: モーダル(× で閉じる)
- フォーム順: 全カテゴリのチップ(宿泊/交通/食事/観光/買い出し/その他、モノグラム付き)→ 内容 → 金額 →
  支払った人(単一選択チップ・デフォルト自分)→ 割る相手(複数選択チップ・デフォルト全員・
  「タップで除外」の補助テキスト・選択数を「割る相手(n人)」に表示)→
  割り方(セグメント: 均等/金額指定)
- **日付選択(デザインからの追加)**: overnight イベントのみ、カテゴリの下に日付チップ
  (イベント日程から生成: 「3/14(土)」「3/15(日)」+「未指定」)。デフォルト未指定。
  ホームの日別グルーピングに必要なため必ず実装する
- 金額指定を選んだ場合: 割る相手や負担額の未入力・一部入力を許可し、未完成なら
  「暫定として追加」。暫定支出には黄バッジを表示し、立替え者または幹事が後から内訳を確定する
- 暫定支出では「途中保存」を用意する。対象参加者の画面では本人の入力欄だけを有効にし、
  「自分の金額を保存」で段階的に入力できる。割る相手の選択・除外は立替え者または幹事だけが行う
- 送信ボタン: 「追加する | 1人あたり ¥◯◯」(均等時。入力中にリアルタイム更新)

### 5.4 精算ページ(全員・視点によって最上部カードが変わる)
共通ヘッダー: 「‹ 精算」+ 「相手ごと精算」バッジ

現在のWeb MVPでは「〇〇の精算」という個人カードを廃止し、中央の「関係する精算状況」へ一本化する。
支払い完了報告・確認ボタンはいったん画面から外し、精算ペアの理解を優先する。

**払う側の視点(balance < 0)**:
- 最上部に強調カード(オレンジ枠): 「あなたの支払い・n件」「〇〇さんに払う」+ 金額(特大)
  + 「支払い完了報告を送信」ボタン(→ status: pending → reported)
- 精算相手が複数いる場合はカードを縦に並べ、件数を見出しに反映

**受け取る側の視点(balance > 0)**:
- 最上部に強調カード(青系): 「あなたの立て替え」+ 立て替え合計(自動計算・**表示のみ、入力欄にしない**)
  + 「受け取り予定の合計 ¥◯◯」
- その下に「支払い完了の報告」セクション: reported 状態の行を「〇〇さんから ¥◯◯」+
  「支払い完了確認」ボタン(緑)で表示(→ reported → paid)

**全員共通(下部)**:
- 「全員の精算状況」リスト + 「完了 n / 総数」カウンタ
- 行: 「from → to」+ 金額 + ステータスバッジ(未払い=グレー / 確認待ち=アンバー / 済=グリーン)
- 各行を展開すると、支払う方向の支出内訳、逆方向に差し引いた支出内訳、
  `支払う方向の合計 − 差し引き = 精算額` の計算式を表示する
- ペアごとに「各人が相手の分を立て替えた金額」を同じ尺度の太い縦棒グラフ2本で並べ、
  棒の高さで比較できるようにする。
  棒は元の支出ごとの積み上げとし、各区間は支出カテゴリ（宿泊・交通・食事等）と同じ色を使う。
  2本の棒は太く、中央付近へ寄せて配置する。中央は「VS」ではなく「比較」の区切りとし、
  支出名・金額のアノテーションは左棒の左外側、右棒の右外側へ表示する。
  その下に `多い側の立替額 − 少ない側の立替額 = 差額` と、
  「少ない側から多い側へ差額を支払う」を表示する。参加者視点では本人を常に左側に配置する
- 暫定表示中(finalize 前)は本セクションを送金プレビューとして表示し、
  報告・確認ボタンは非活性(finalize 後に活性化)

### 5.5 初回参加(参加者・デザイン未作成 → DESIGN.md のトーンで新規作成)
- 名前入力 or 代理登録済みリストから「これ自分」選択(§1 参照)
- localStorage 消失時: 既存メンバー名を選び復帰申請 → 幹事が紐付け解除 → 本人再 claim で代替可

### 5.6 幹事ダッシュボード / 幹事管理(デザイン未作成 → 同上)
- ダッシュボード: メンバー一覧(紐付け状態)、支出サマリー、URLコピー、精算確定(finalize)ボタン
- finalize 時の確認ダイアログ: 「支出◯件・イベント合計 ¥◯◯・メンバー◯人。支出の登録漏れが
  ないか確認してから確定してください」を表示して二段階確認にする。
  ※立て替え合計と支払い合計の一致チェックは不要(エンジンの不変条件により常に一致する。§4.2/§4.4-4)。
  検出できない唯一のリスクは支出の登録漏れであり、それはこの確認と確定解除(unfinalize)で運用的に担保する
- イベント設定: イベント名、終日・日帰り／宿泊の切り替え、開始日、終了日、定員を幹事が後から変更できる。
  日程短縮で範囲外になった支出の day_index は未指定へ戻す
- 参加者管理: 幹事が名前を入力して代理参加登録できる。既存支出から参照されていない参加者だけ削除可能とし、
  立替者・作成者・立替対象になっている参加者は精算整合性を守るため削除不可にする
- 代理登録された参加者が本人のアカウントへ引き継ぐための専用トークンURL発行ボタンを配置する。
  Web MVPでは「準備中」のボタンのみとし、トークン生成・claim処理はSupabase接続後に実装する
- 精算確定中は参加者構成を変更できない。幹事が確定解除してから追加・削除する
- 将来の管理: 紐付け解除、イベント削除
- 幹事のみ: 未払い(pending / reported)一覧 + 催促文生成(定型文テンプレートに
  イベント名・金額・URLを埋め込むだけ。LLM 不使用)

### 5.7 UI 挙動の要点
- カテゴリごとのデフォルト: lodging=全員均等 / transport=対象者選択を促す / food=全員均等 / shopping=全員均等
- 支出の「暫定」バッジは expenses.status='finalized' で消える。暫定支出が残る間は
  イベント全体の精算確定と報告・確認を開始できない
- ステータスバッジの意味色はアプリ全体で統一: 暫定=黄 / 未払い=グレー / 確認待ち=アンバー / 済=グリーン / 立替=青

### 5.8 デザインからの意図的な変更点(Codex はデザインファイルよりこちらを優先)
- **【重要】design/reference/ の HTML では、精算ページ(支払い完了報告・立て替え側カード)の
  金額が入力欄(editable)になっており、報告時に手動で金額を入力できてしまう見た目になっている。
  これはデザイン上の誤りであり、仕様上の正は「エンジンが計算した指定金額で固定(読み取り専用の表示)」。
  報告・確認はあくまで settlements.amount(自動計算値)に対するステータス操作であり、
  金額を変更・入力する手段は UI にもAPI にも一切設けないこと。**
  人ごとに負担額が異なるケースは支出入力の割り方「金額指定」(§5.3 / split_method='fixed')で
  支出登録時に扱う。精算段階での金額手入力は §0.3 の設計判断(送金は常に自動計算)と矛盾する
- デザイン中の「立て替えた金額を入力してください」「金額指定のときは自分で入力してください」という
  文言も上記と同じ理由で実装しない
- ブラウザ版デザインの「視点切替タブ(あなた/ケンタ)」はデザイン確認用のギミック。
  実アプリでは各ユーザーは自分の視点のみを見る(切替UIは実装しない)
- デザイン案 1b(ビッグナンバー)・1c の支出入力キーパッドは不採用。2a 統合版に従う

---

## 6. v1 でやらないこと(実装禁止)
- アプリ内での送金・決済・資金の預かり(法規制のため。表示と記録のみ)
- 日程調整・出欠管理、プッシュ通知・LINE API 連携
- レシートOCR、傾斜割りプリセット、課金機能
- 多通貨対応、外部アカウント連携(参加者側)

## 7. 推奨着手順
1. 精算エンジン(§4)+ 単体テスト
2. Supabase スキーマ + RPC + RPC の結合テスト
3. 参加者側画面(5 → 6 → 7 → 4)
4. 幹事側画面(1 → 2 → 3)
5. PWA 化(manifest / アイコン / ホーム画面追加)とデプロイ

### 2026-07-14 バックエンド実装状況

- 初期スキーマ、RLS、`get_event_state`、参加・claim・代理登録・イベント更新・支出追加RPCを実装済み
- LINE／Discordの将来連携に備え、外部スペース紐付けと通知outboxを実装済み（実配送はv1対象外）
- フロントはまだlocalStorageを使用しており、Supabaseアダプターへの切り替えは次段階
- 支出編集・削除・暫定入力・精算確定・支払い状態遷移RPCまで実装済み。フロント接続は未実装

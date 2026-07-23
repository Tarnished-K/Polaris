# Polaris 残存タスク・セキュリティロードマップ2

最終更新: 2026-07-24

## 0. 位置づけ

`ROADMAP.md`のフェーズ0〜9で主要なv1実装は完了している。本書は、公開運用へ移る前に残っている検証・セキュリティ強化・外部環境受け入れを優先順に管理する。

新しいプロダクト機能（日程調整、出欠、傾斜割り、レシートOCR、Proプラン）は本書の残存タスクへ混ぜず、v1.5以降として別途判断する。

### 進捗サマリー

- フェーズA〜D: 2026-07-24に実装・自動検証・実Postgres検証まで完了。
- フェーズE: Desktop／390px／320pxの自動回帰は完了。Android／iPadの物理端末受け入れが残る。
- フェーズF: 署名fixtureと内部処理は完了。実LINE／Discordテスト環境での少数配送が残る。
- フェーズG: payment dataの日次purgeとHTTP security headerは完了。Network Restrictions、WAF、バックアップ／鍵ローテーションの運用受け入れが残る。

## 1. フェーズA: PayPay IDと認可境界のセキュリティ監査

### 現状

- PayPay IDは`public.member_payment_profiles.paypay_id`へ平文で保存される。パスワードや送金認証情報ではないが、個人に紐づく識別子として扱う。
- テーブルはRLS有効、`public` / `anon` / `authenticated`の直接権限を剥奪済み。取得・更新は`SECURITY DEFINER` RPCだけを使い、各関数は`search_path = ''`を固定している。
- 参加者は本人と、未精算の正額settlementで自分が支払う相手のPayPay IDだけを取得できる。幹事権限だけで他参加者のプロフィールを取得する特例は廃止した。
- クラウドイベントのPayPay IDはReact stateにだけ展開し、アプリ独自のlocalStorageへは保存しない。参加者のdevice tokenはイベントセッション復元のためlocalStorageへ保存される。
- 監査ログにはPayPay IDそのものを保存せず、登録有無だけを記録する。

### やること

1. PayPay IDを「イベント内限定の個人識別情報」としてデータ分類し、プライバシーポリシーと画面説明へ保存目的・閲覧者・削除方法を明記する。
2. `get_payment_state`の幹事特例を廃止または縮小し、幹事本人・実際の支払者・受取者以外へPayPay IDを返さない。幹事用進捗にはIDを含めない。
3. イベント削除時のcascade削除を実Postgresで確認し、精算完了後の自動期限削除または利用者が即時削除できる運用を決める。
4. DBダンプ漏洩を脅威モデルへ含め、平文継続・アプリ層暗号化・保存廃止（短期請求リンクのみ）の3案を比較する。暗号化する場合は鍵をDBと分離し、Supabase Function secret等で管理してローテーション手順も実装する。
5. Sentryの秘匿キーへ`paypay` / `paymentProfile` / `paymentRequestUrl`を追加し、意図的な例外を使ってenvelopeへ値が含まれないことをテストする。
6. NetlifyへCSP、`Referrer-Policy`、`X-Content-Type-Options`、frame制御、適切な`Permissions-Policy`を追加し、Supabase・Google OAuth・Sentry・PayPay遷移に必要な送信先だけを許可する。
7. 最新13マイグレーションと全pgTAPを実Postgresで再実行する。PayPay ID、請求リンク、イベント別支払い、同名参加者を含む認可回帰を完了扱いの条件にする。

### 実施結果（2026-07-24）

- `20260724000200_payment_data_privacy.sql`で閲覧者を本人と未精算の実支払者へ縮小し、paid後の非返却、リンク即時削除、本人プロフィール削除、幹事のイベント完全削除を追加した。
- PayPay請求URLは`https`、`paypay.ne.jp`／`qr.paypay.ne.jp`完全一致、userinfoなし、portなし、2,048文字以下に固定した。
- PayPayプロフィールは全正額settlement完了から30日保持し、`service_role`だけが実行できる日次pg_cronで削除する。精算なしイベントは`finalized_at`を起点にする。
- 支払い画面へ保存目的、閲覧者、30日保持、即時削除、clipboard残存の説明を追加した。
- SentryはPayPay ID／請求URLをevent、breadcrumb、transaction、span、JSON文字列から伏字化し、NetlifyへCSP等のsecurity headerを追加した。
- Supabaseへセキュリティ境界強化を含む15本のmigrationを適用し、Hosted pgTAP 6ファイル・198 assertionsが成功。cronの有効化と`anon=false`／`authenticated=false`／`service_role=true`のpurge権限も確認した。
- 平文＋最小権限＋30日保持を採用した。DB dump／service role侵害は残余リスクとして`SECURITY_AUDIT.md`へ記録し、保持延長時にEdge Function AES-GCMを再評価する。

### 受け入れ条件

- 無関係な参加者、別イベントの参加者、share tokenだけの未参加者はPayPay IDを取得・変更できない。
- 幹事であっても支払い関係のない参加者のPayPay IDを取得しない。
- PayPay IDがlocalStorage、URL、activity log、Sentry、通知payloadへ残らない。
- ID削除後とイベント削除後にDB・RPCレスポンスから消える。
- 実Postgres pgTAPと本番相当のブラウザ回帰が成功する。

## 2. フェーズB: Claudeによる防御的ホワイトボックス監査

### 実行境界

- 対象は所有者が管理するPolarisリポジトリ、ローカル環境、専用Supabase検証プロジェクト、Netlifyの検証用Deployに限定する。
- 本番データ、実利用者、第三者のLINE／Discord／PayPayアカウントへ負荷・総当たり・大量送信を行わない。
- 最初のパスは読み取り専用にし、発見事項を`SECURITY_AUDIT.md`へ記録してから修正する。
- Claude Codeはsandboxまたは許可コマンドのallowlistで動かし、`.env*`、OS資格情報、ブラウザプロファイル、他リポジトリを読ませない。
- 検証データは全て専用の偽名・テストIDを使い、終了後に削除する。

### 推奨する監査手法

1. **データフロー追跡**
   - PayPay ID、device token、share token、claim token、Google session、通知secretが、入力→ブラウザstate→RPC→DB→ログ／Sentry／通知へどう流れるかを図示する。
   - 各データについて保存先、平文／ハッシュ／暗号化、閲覧可能な役割、保持期間、削除経路を表にする。
2. **権限マトリクスとBOLA／IDOR負のテスト**
   - 役割を未参加者、幹事、支払者A、受取者B、無関係参加者C、別イベント参加者X、service roleに分ける。
   - 全公開RPCについて、別イベントのUUID、他人のmember ID、settlement ID、expense ID、期限切れclaim、盗用を模した別device tokenを差し替える。
   - 成功すべき組み合わせと`42501`等で拒否すべき組み合わせをpgTAPへ固定する。
3. **`SECURITY DEFINER`監査**
   - 公開関数の`search_path`固定、完全修飾名、EXECUTE grant、actor再検証、service-role限定関数、想定外のanon実行可否を一覧化する。
   - 関数がRLSを迂回する前提で、関数内部のイベント境界と所有者確認を1本ずつ証明する。
4. **入力・出力・XSS検証**
   - イベント名、参加者名、支出名、メモ、PayPay ID、請求URL、通知文へHTML／SVG／Unicode境界値を入れ、DOM XSS、属性注入、表示崩れ、ログ汚染が起きないことを確認する。
   - PayPay URLはHTTPSと公式hostの完全一致、userinfo拒否、リダイレクト後の遷移先を確認する。
5. **認証・トークン検証**
   - share／device／claim／外部連携コードのエントロピー、期限、1回利用、ローテーション、リプレイ、ログ露出、localStorage露出を確認する。
   - Google OAuthのredirect固定、イベントURL復帰、別イベントへの混同がないことを確認する。
6. **Edge Function・BOT検証**
   - LINE HMAC、Discord Ed25519、timestamp、provider event ID、外部ID単位rate limit、内部secretなしの拒否を検証する。
   - 実サービスを使う前に署名付きfixtureで再現し、実配送は少数のテスト通知だけに限定する。
7. **依存関係・秘密・設定監査**
   - `npm audit`、Claude Codeの`/security-review`、秘密情報スキャン、Supabase Database Linter、HTTP security header確認を組み合わせる。
   - 単一ツールの結果を確定扱いにせず、到達可能性と実際の権限境界をコード・テストで再検証する。
8. **業務ロジック・競合検証**
   - 二重送信、部分支払いの同時報告、受取確認との競合、精算解除、通知重複、オフライン再送で金額・状態が不正にならないことを並行操作で確認する。

### Claudeの成果物

`SECURITY_AUDIT.md`へ、各指摘を次の形式で記録する。

- ID、タイトル、重大度、確信度
- OWASP API Top 10／WSTG／CWE対応
- 影響を受けるデータと役割
- 根拠となるファイル・関数・行
- 専用検証環境だけで再現できる最小手順
- 実害、既存の緩和策、推奨修正
- 修正後に追加すべき自動回帰テスト
- 誤検知と判断した場合の理由

Critical／Highは別の検証パスで再現してから修正し、修正後は同じ再現手順が失敗することを確認する。

### 実施結果（2026-07-24）

- Claude CLIを読み取り専用に制限した2回の監査を行い、すべての指摘をコードと実Postgresで独立再検証した。
- 2回目の監査で、旧Supabase default ACLにより幹事がRPCを経由せず自イベントの行を直接更新できるHighを確認した。`20260724000300_security_boundary_hardening.sql`で`PUBLIC`／`anon`／`authenticated`の全public table・sequence直接権限を剥奪し、既存・将来のオブジェクトを明示grant方式へ変更した。
- 通知dispatcherはservice-role bearerをコード内でも照合し、terminal／試行上限到達jobを再取得しない。旧`organizer_upsert_integration`はクライアント実行不可とし、通知先登録を検証・暗号化付きEdge Functionへ一本化した。
- オフライン支出はイベント単位のUUIDをDB unique制約と`add_expense`へ渡して冪等化した。参加者名の予約語・制御文字拒否、PayPay URLの制御文字拒否、URL encodeされたSentryキーの伏字化をDB／クライアント双方へ追加した。
- 修正後はクライアントロールのpublic table直接権限0件、旧連携RPC実行不可、Hosted pgTAP 198 assertions成功を確認した。未修正のCritical／Highは0件。外部連携コードの32-bit／5分仕様は署名検証と外部ID単位10回／5分制限を前提とするLowの残余リスクとして受容する。

## 3. フェーズC: 代理登録者の本人確認URL

1. 既存`organizer_issue_claim_token`をバックエンドadapterへ接続する。
2. 幹事が代理登録した未claim参加者を選び、7日間・1回限りの`?claim=`付きURLを発行・コピーできるようにする。
3. 再発行時は旧tokenを無効化し、claimed済み・別イベント・期限切れを拒否する。
4. claim tokenをログ、Sentry、通知本文へ残さない。

**完了 (2026-07-24)**: 未claim代理参加者ごとに7日・1回限りのURLを発行、自動コピー、再コピー、再発行による旧token無効化、期限表示、claimed済み非表示を実装した。claim成功時はRealtime更新を送る。PGliteで旧token拒否、新token成功、claimed後の再発行拒否を検証した。

## 4. フェーズD: 公開版のデバッグ機能撤去

1. `DebugPerspectiveSwitcher`と`TestResetButton`を本番bundleから除外する。
2. 4人デモと視点切替はPlaywright fixtureまたは開発専用buildへ移す。
3. 本番URLでデバッグ操作とローカル全消去操作が表示されないことを確認する。

**完了 (2026-07-24)**: `import.meta.env.DEV`限定のlazy importと専用CSS chunkへ分離した。production asset scannerをbuildへ組み込み、コード、CSS、文言が本番11 assetsに含まれないことと、3 viewportのPlaywrightで非表示を確認した。

## 5. フェーズE: Android／iPad実機受け入れ

1. AndroidとiPadでPWAをホーム画面へ追加し、standalone起動を確認する。
2. 2端末で同じ共有イベントへ別参加者として入り、支出・精算・支払い状態のRealtime反映を確認する。
3. Androidをオフラインにして新規支出を保存し、オンライン復帰後の自動再送とiPadへの反映を確認する。
4. Google OAuth、共有URL、claim URL、PayPay外部遷移からアプリへ安全に戻れることを確認する。

## 6. フェーズF: LINE／Discord実サービス受け入れ

1. 専用DiscordテストWebhookとLINEテストチャネルを用意し、資格情報はSupabase secretsだけへ登録する。
2. テスト通知、精算確定、支払報告、受取確認、全員完了、1日1回催促を少数のテストイベントで確認する。
3. 実LINE Postback／Discord Interactionから連携、状況照会、本人の報告・確認をE2E確認する。
4. 配送履歴、再試行、失敗、重複防止、署名不正、期限切れ、rate limitを確認する。

## 7. フェーズG: Supabase運用セキュリティ

1. 固定管理元IPまたは安全なCI経路を用意できた時点でDB Network Restrictionsを必要なCIDRへ絞る。
2. HTTPS API／Edge Function向けのWAF・Rate Limitingを実運用量に合わせて設定する。
3. Auth、DB、Edge Function、Netlify、Sentryの監査ログとアラート条件を決める。
4. バックアップ、秘密鍵ローテーション、インシデント時のshare token再発行・PayPay ID削除手順を文書化する。

**一部完了 (2026-07-24)**: PayPay data purgeのpg_cron、Netlify security header、Sentry秘匿化、share token再発行、PayPay ID／event完全削除は完了。固定管理CIDR、HTTPS WAF、バックアップ復元、全secretローテーション訓練は運用環境依存として残す。

## 8. 完了条件

- フェーズA〜Dを完了し、Critical／Highの未修正指摘がない状態を公開運用の最低条件とする。
- フェーズE〜Gは実端末・実外部サービス・運用環境を使った証拠を`HANDOFF.md`へ残す。
- 完了判定はテスト件数だけでなく、「誰が、どのデータへ、どの経路でアクセスできるか」の負のテスト結果を必須とする。

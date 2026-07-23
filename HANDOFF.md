# Warikan Web MVP 引き継ぎ

更新日: 2026-07-23

## 最終ステータス（2026-07-23）

- フェーズ0〜2、4〜6は実装・自動検証・必要な本番反映まで完了。フェーズ3は本番URL／OAuth／クラウドイベント／Realtime／PWA配信まで確認済みで、異なる物理端末からのホーム画面追加を含む最終受け入れだけが残る。
- フェーズ7はオフライン再送、Sentry本番受け入れ、共有URLローテーションまで実装済み。残る最終受け入れは実スマートフォンのオフライン→オンライン復帰。
- バックログ6.1（関係マップ）と6.3（予約語バリデーション）は実装済み。6.2（債務マトリクス）は一度実装したが、分かりにくいため2026-07-23にUIから撤去し、関係マップへ一本化した。
- 通知は暗号化されたDiscord／LINE登録UI、outbox、dispatcherまで本番反映済み。実WebhookとLINE channel access tokenを使う外部配送だけ未確認。
- フェーズ8「支払い・受け取りアクションハブ」は実装・自動検証・クラウドDB反映まで完了した。支払い画面はPayPay ID・外部生成の請求リンク・現金に対応し、銀行口座とアプリ内決済は扱わない。
- フェーズ9は精算ライフサイクル通知、未払いだけへの1日1回の催促、読み取り専用集計、5分・1回限りの外部アカウント紐付け、LINE HMAC／Discord Ed25519署名検証、リプレイ／レート制限、紐付け済み本人の支払い報告・受取確認まで実装・クラウド反映した。外部IDの平文や個人名をURLへ保存しない。
- 最終ローカル自動検証はVitest 113件、Playwright 31件成功・狭幅専用2件skip、PGlite 11マイグレーション、Production buildが成功。Lighthouseの直近値はDesktop 1.00／Mobile 0.97、本番NetlifyはDeploy `6a621bfb498a064e045ec13a`。
- フェーズ8・9の統合チェックポイント`c02a743`までGitHub `main`へpush済み。GitHub Actions `Validate application` run `30001049555`でunit、build、Playwright、Lighthouse、artifact upload、backend validateが全成功した。
- 実機接続を試みたが、この実行環境のADBブリッジは接続拒否（OS error 10061）、BrowserMCPは`Transport closed`のため、物理端末テストを完了扱いにはしていない。下記「フェーズ3実機依存確認」の手順で端末接続可能時に実施する。

### 運用受け入れ残件

1. 異なる物理端末で共有URLを開き、PWAホーム画面追加と、オフライン支出→オンライン復帰→別端末Realtime反映を確認する。
2. DiscordテストWebhookを設定画面から登録し、LINEはSupabase Function secret`LINE_CHANNEL_ACCESS_TOKEN`と送信先IDを設定して、dispatcherの実配送・delivery記録を確認する。
3. DB直結元を固定IPへ集約できる運用になった時点で、Supabase Network Restrictionsを`0.0.0.0/0`／`::/0`から必要なCIDRだけへ狭める。HTTPS APIにはこの制限が適用されないため、BOT受信は現在の署名・リプレイ防止・外部ID単位レート制限を維持する。

### 外部環境依存の残件

1. LINE Messaging APIとDiscord Applicationの本番資格情報をSupabase secretsへ登録し、実アカウントで署名付きWebhookをE2E確認する。
2. 実スマートフォン、実通知先、Supabase WAF／Rate Limitingの運用受け入れを上記手順で実施する。

## 2026-07-23 320px縦型UI・同名参加者対応

- 320px幅をPlaywrightの`narrow-mobile`プロジェクトへ追加した。主要タブは「支出・立替・精算・支払」の短縮表示にし、支出追加ボタンをカテゴリ絞り込みより上へ分離した。ヘッダー、支払い見出し、設定参加者一覧、立替グラフも320pxで切れない寸法へ調整した。
- 精算画面の債務マトリクスと切替タブを撤去し、関係マップを常時表示する。ペアカードと内訳は維持する。
- 同じ参加者名を登録できるようにし、最初の名前を維持して後続を`名前(1)`、`名前(2)`と自動採番する。共有参加、幹事代理登録、ローカルデモで同じ規則を使う。
- `20260723000700_duplicate_member_names.sql`をリンク済みSupabaseへ適用した。Docker不要検証では11マイグレーションと重複登録フローが成功した。実Postgres pgTAPの再実行はDB接続資格情報がこの端末にないため未実施。
- Vitest 113件、Playwright 31件、Production build、Lighthouse Desktop 1.00／Mobile 0.97、`git diff --check`が成功した。
- NetlifyはProduction contextで1回だけビルド・デプロイし、Deploy `6a621bfb498a064e045ec13a`へ反映した。`https://polaris-warikan.netlify.app`を新規Chromiumの320px幅で支出・精算・支払い・立替・設定まで巡回し、HTTP成功、ページ横はみ出しなし、console／page error 0件を確認した。

## 2026-07-23 Sentry本番受け入れ

- EUリージョンの実DSNをNetlify production環境変数`VITE_SENTRY_DSN`へ登録した。値はコード、文書、`.env.production`へ保存していない。
- Error MonitoringとTracingだけを有効化し、Logs、Session Replay、Application Metricsは無効のままとした。Tracingは10%サンプリングで、エラーとtransactionの両方に同じ再帰的スクラビングを適用する。
- `sendDefaultPii=false`、`dataCollection.userInfo=false`、`httpBodies=[]`を設定した。共有URL token、claim、device token、参加者名、Authorization/Cookie、通知先secretを送信前にマスクする。
- Sentry SDKとTracingは初回操作または12秒後に遅延ロードし、それ以前の実行時エラーは軽量listenerと独自Error Boundaryから即時ロードして送信する。SDKチャンクはPWA precacheから除外し、Lighthouse Desktop 1.00／Mobile 0.97と初期JS予算を維持した。
- 本番URLで制御した実行時エラーを発生させ、Sentry ingestが2xxで受理したことと、テスト用共有token・claim・device tokenが送信envelopeに含まれないことをPlaywrightで確認した。本番Deployは`6a620c8488d5e7867e7ba54c`。

## 2026-07-23 フェーズ8・9 クラウド統合

- `20260723000400_payment_handoff.sql`、`20260723000500_notification_lifecycle.sql`、`20260723000600_external_account_linking.sql`をリンク済みクラウドDBへ1回で反映した。
- pgTAPの基盤テストに以前から存在したplanの1件不足を修正した。実際の構成は基盤28、ワークフロー10、権限12、支払い11、通知18、外部連携33の計112件で、全6ファイルが実Postgres上で成功した。
- `EXTERNAL_ACCOUNT_HMAC_KEY`と`ASSISTANT_INTERNAL_KEY`を暗号乱数で生成してSupabase secretsへ設定した。値は標準出力、文書、リポジトリへ保存していない。
- `event-assistant`、`line-assistant-webhook`、`discord-assistant-webhook`を本番へデプロイし、3関数ともACTIVE、`verify_jwt=false`を確認した。内部鍵なし401、正しい内部鍵＋未知イベント404、LINE／Discordの未署名リクエスト401を本番URLで確認した。
- 統合後にVitest 111件、PGlite 10マイグレーション、Playwright Desktop／Mobile 20件、Production build、Lighthouse Desktop 1.00／Mobile 0.97、`git diff --check`が成功した。
- Netlify Deploy `6a61f34636b0e4e5c55a8360`へ本番反映した。`https://polaris-warikan.netlify.app`はHTTP 200、新しいmain assetと設定chunkが配信され、Google OAuthが`accounts.google.com`へ遷移し、390pxの支払い画面に横あふれとconsole／page errorがないことを確認した。通知設定はクラウドイベントの認証済み幹事だけに表示されるため、権限を迂回せず本番設定chunkの秘密再表示禁止文言まで確認した。
- Supabase Management APIでプロジェクトが`ACTIVE_HEALTHY`、Authの各組み込みrate limitが有効、DB Network RestrictionsがIPv4 `0.0.0.0/0`／IPv6 `::/0`で適用中と確認した。Network RestrictionsはPostgres／poolerだけを対象にし、PostgREST・Auth・Storage・Edge Function等のHTTPS APIには適用されない。現在は固定の管理元IPがないため、CLI、マイグレーション、実Postgres検証を遮断するCIDR変更は行っていない。
- Edge Functionの受信保護はプラットフォーム任せにせず、LINE HMAC／Discord Ed25519、5分timestamp、provider event IDリプレイ防止、HMAC化した外部アカウント単位10回/5分を実装済み。汎用的な追加制限が必要になった場合はEdge Function内の共有ストア方式を検討し、Postgres RPC内で送信元IPを推測しない。

## 2026-07-23 フェーズ1 Google認証の完了

- Supabase AuthのSite URLを`http://localhost:5173`へ変更し、`http://localhost:5173/**`と`http://127.0.0.1:5173/**`を追加Redirect URLとしてクラウドへ反映した。`supabase/config.toml`も同じ値へ更新した。
- Google OAuth開始時の`redirectTo`が常に`/`を指していたため、現在のpathnameとqueryを保持する`buildOAuthRedirectUrl`を追加した。共有URL`/e/{shareToken}`からログインしても同じイベントへ戻れる。
- リダイレクトURLのユニットテスト2件を追加し、対象テストと本番ビルドが成功した。
- Google Cloudプロジェクト`Polaris`(`polaris-503219`)を作成し、外部・テストモードのOAuth同意画面と`Polaris Web` OAuthクライアントを構成した。承認済みリダイレクトURIは`https://nrixujdkgvexnnqfoned.supabase.co/auth/v1/callback`。
- 現在のGoogleアカウントをOAuthテストユーザーへ追加し、Supabase DashboardでGoogle ProviderへClient ID / Secretを登録してEnabledにした。Client Secretはリポジトリや文書へ保存していない。
- BrowserMCPで`http://localhost:5173`からGoogleログインを実行し、認証済みメール表示を確認した。検証用イベント「フェーズ1 E2E確認」の`create_event`が成功し、`/e/{shareToken}`形式の共有URLが発行された。

## 2026-07-23 フェーズ2 共有URL参加フローの完了

- `/e/{shareToken}`を初回表示した際に`get_event_state`を呼び、クラウド上のイベント・参加者・支出・精算状態を復元するようにした。
- 未参加者にはログイン不要の名前入力画面を表示し、`join_event`成功後にイベント画面へ遷移する。`?claim={claimToken}`付きURLでは`claim_member`を自動実行する。
- device tokenはイベントごとに生成してlocalStorageへ保存する。生tokenはサーバーへ本人確認時だけ送り、DBには従来どおりハッシュのみを保存する。
- `get_event_state(text, text)` overloadを追加し、ログイン中の幹事またはdevice tokenに一致する参加者の`currentMemberId`をサーバー側で返す。localStorageのmember IDだけを信用して本人扱いしない。
- migration `20260723000100_shared_event_actor.sql`はリンク済みSupabaseへ適用済み。BrowserMCPで匿名の名前入力、参加、参加者画面表示、再読込後の本人復元まで確認した。
- 精算エンジンの一貫性方針は契約テスト方式を採用する。同一の4人入力をTypeScript版と実Postgres版へ渡し、完全一致を保証してから精算RPC配線を完了させる。

## 2026-07-23 フェーズ2 支出RPC配線の完了

- クラウドイベントの支出追加・編集・本人負担額保存・暫定支出確定・削除を、`add_expense` / `update_expense` / `save_own_fixed_amount` / `finalize_expense` / `delete_expense`へ接続した。
- ローカルイベントとデモは従来のlocalStorage状態処理へフォールバックする。確定済み支出のローカル編集・削除処理も追加した。
- 支出フォームはPromiseを待っている間に操作を無効化し、RPCエラーをフォーム内に表示する。削除はブラウザ標準confirmではなく、フォーム内の二段階確認に変更した。
- BrowserMCPで匿名参加者による均等支出の追加、タイトル更新、削除、金額指定の暫定支出追加、自分の負担額の再保存を実クラウドで確認した。検証用支出は確認後にクラウドから削除済み。

## 2026-07-23 フェーズ2 精算RPC配線の完了

- クラウドイベントの精算確定・確定解除・支払い完了報告・受取確認・1段階取り消しを、`finalize_event` / `unfinalize_event` / `report_settlement` / `confirm_settlement` / `revert_settlement`へ接続した。ローカルイベントとデモは従来の状態処理へフォールバックする。
- 幹事操作は画面内の二段階確認にした。確定解除は最初に必ず`p_force=false`で問い合わせ、reported/paidの精算がある場合はRPCが返す変更件数を表示してから、明示的な同意後だけ`p_force=true`を送る。
- 参加者の役割と精算状態に応じて「支払い完了を報告」「受け取りを確認」「1段階戻す」を表示し、通信中の重複操作を無効化してRPCエラーをその場に表示する。
- `settlement_items`は`get_event_state`内の`Settlement.charges` / `Settlement.offsets`として返し、既存の`SettlementBreakdownItem[]`で型付けする方針に確定した。
- `src/domain/settlement.contract.test.ts`を追加した。標準4人デモの確定済み7支出をTypeScript精算エンジンと全migration適用済みPGliteへ同じID・内訳で投入し、支払方向、差額、相殺前金額、charge/offsetの支出内訳が完全一致することを検証する。
- BrowserMCPで実クラウド上の`pending → reported → paid → reported`と、変更済み1件を検知する保護付き確定解除、強制解除後のactive復帰を確認した。検証用支出は解除後に削除済み。

## 2026-07-23 フェーズ2 Realtime同期の完了

- `src/backend/supabase.ts`へイベント単位のRealtime Broadcast購読・送信を追加した。支出、精算、参加、イベント設定のRPC成功後に、share token由来の`event:{shareToken}`チャンネルへ空の`event_changed`通知を送る。
- 通知へイベントデータは含めない。受信側は既存の`get_event_state(shareToken, deviceToken)`を再実行し、ログイン済み幹事またはdevice token参加者としてサーバー側でactorを解決する。
- Postgres Changesを直接採用しなかった理由は、アカウントレス参加者のevent所属がJWTに無く、テーブルのSELECT/RLSをイベント単位で安全に許可できないため。匿名テーブル直接参照を拒否するフェーズ0の権限境界を維持した。
- 同期中に通知が重なった場合は、現在の再取得完了後に1回だけ追加取得する。表示中のhome/dashboard/settlement/settings画面は維持する。
- Realtimeチャンネルの共有、通知受信、送信、解除を`src/backend/supabaseRealtime.test.ts`で固定した。
- 実クラウド検証では、ブラウザ操作から独立Node購読クライアントへの`event_changed`到達を確認した。逆方向ではNodeクライアントが追加した「Realtime参加者」が、ブラウザにリロードなしで表示された。検証用参加者と「Realtime確認」支出は確認後に削除済み。
- あわせて設定画面の`organizer_update_event` / `organizer_add_member` / `organizer_remove_member`をクラウドへ接続し、通信中制御とRPCエラー表示を追加した。

## 2026-07-23 フェーズ2 localStorage縮小の完了

- `useWarikanApp`の状態へ`persistence: local | remote`を追加した。クラウドイベントを`loadRemoteEvent`で取り込んだ場合、イベント本体・参加者・支出・精算のスナップショットは`warikan.web.mvp.v1`へ保存せず、以前の値も削除する。
- ローカル作成イベント、箱根デモ、4人デモは従来どおりlocalStorageへ保存し、再読込後も利用できる。
- 旧buildの無印スナップショットは、クライアント生成仕様である36桁hex share tokenだけをローカルイベントとして移行する。Supabase生成の32桁base64url share tokenを持つクラウドスナップショットは、古いサーバー状態を誤表示しないよう復元しない。
- `warikan.web.event-sessions.v1`のdevice tokenとmember IDは自動再参加のため残す。member ID単独は信用せず、共有URL読込時に`get_event_state(shareToken, deviceToken)`でactorを再解決する。
- 将来のオフライン未送信下書きは、クラウドイベント本体のキャッシュを再導入せず、専用のキュー／下書きストアとしてフェーズ7で追加する。
- `src/state/useWarikanApp.storage.test.ts`で、ローカル状態の継続保存、remote状態の削除、旧ローカル状態の移行、旧クラウド状態の拒否を検証する。
- BrowserMCPで共有URLからクラウドイベントが復元され、その後ルートURLを開くと古い複製ではなく作成画面になることを確認した。

## 2026-07-23 フェーズ2 DB型生成の完了

- リンク済みSupabaseのpublic schemaから`src/backend/database.types.ts`を生成した。再生成コマンドは`npm run backend:types`。
- `createClient<Database>`と`SupabaseClient<Database>`を適用し、table、enum、RPC名、RPC引数を実クラウドスキーマ由来の型で検査する。
- `get_event_state`や`finalize_event`が`jsonb_build_object`で返す内部構造は生成器では`Json`までしか表現されないため、`EventState` / `Settlement`等の画面向け契約型は`src/backend/types.ts`へ残した。これはDB生成型の代替ではなく、RPC JSONレスポンスのアプリ契約層として扱う。
- Supabase CLI生成型がnullable SQL function parameterを非NULLとして出力する差分があるため、`p_device_token`、`p_day_index`、`p_fixed_amount`の該当箇所だけ`allowSqlNull`で補正した。他の引数名・型は生成型の検査を維持する。
- migration変更後は`npm run backend:types` → `npm run build`を実行し、生成型の差分もmigrationと同じ変更へ含める。

## 2026-07-23 フェーズ2 最終受け入れE2Eの完了

- 実クラウドの検証イベントに4人(あなた、ブラウザ参加者、ケンタ、サキ)を揃え、`createFourPersonDemoData`の確定済み7支出を同じ金額指定内訳で登録した。合計は115,400円。
- 幹事ブラウザに加えて、ケンタ・サキを独立したdevice tokenのNodeクライアントとして参加させた。複数クライアントが4人・7支出を取得でき、Broadcast後にブラウザへリロードなしで反映された。
- `finalize_event`は6組の精算を生成した。実クラウドレスポンスを同一入力の相手ごと相殺計算と比較し、from/to、差額、gross、offset、charge/offsetの支出IDと金額が完全一致した。
- BrowserMCPで確定済み6組と4人の精算関係マップを確認した。差額は、ブラウザ参加者→あなた5,000円、サキ→あなた2,200円、ブラウザ参加者→サキ2,300円、サキ→ケンタ14,000円、あなた→ケンタ7,700円、ブラウザ参加者→ケンタ14,400円。
- Chromeで同じ共有URLを2タブ同時に開き、タブ2で追加した「タブ同期確認」支出がタブ1へリロードなしで表示されることも確認した。確認後に同支出を削除した。
- 検証後に`unfinalize_event`を実行し、E2E支出7件と追加参加者2人を削除した。DB直接確認とBrowserMCPの両方で、イベントがactive・既存2人・0支出・0精算へ戻ったことを確認した。
- これによりフェーズ2のタスク1〜6と、共有表示・Realtime・4人精算一致の受け入れ条件をすべて完了した。

## 2026-07-23 フェーズ0 権限検証の完了

- `scripts/validate-backend.mjs`の参加者操作時に、幹事の認証状態が残ったままになっていた検証上の問題を修正した。参加者操作では認証ユーザーを外し、デバイストークンだけで本人確認する。
- Docker不要の検証へ、他の参加者による支出編集・削除・確定、自分が対象外の負担額変更、別の幹事によるイベント確定・解除・設定変更・メンバー削除が拒否されることを追加した。
- 実Postgres向けに`supabase/tests/database/003_authorization_matrix.test.sql`を追加した。上記に加え、イベントをまたぐ支出編集・削除と、anonによるテーブル直接参照の拒否を含む12項目を検証する。
- 停止中だったSupabase `Warikan`プロジェクトをManagement APIで復旧し、2026-07-23に実Postgres上でpgTAP 50件(基盤28、ワークフロー契約10、権限12)がすべて成功した。テストSQLはトランザクション末尾で`rollback`するため、テストデータは残らない。
- クラウドにはpgTAPが未導入だったため、`extensions`スキーマへ拡張を導入した。このPCにはDockerが無く、`supabase test db --linked`はリモート接続後のテストランナー起動時にDockerを要求するため、CLIの一時ログインロールとIPv4 poolerを使い、同じ3本のSQLをNode Postgresクライアントから直接実行した。
- 匿名参加者のテーブル直接参照は、RLSで0件になる前にテーブル権限で`42501 permission denied`となる。権限テストはこの強い拒否を期待値として検証する。

権限マトリクスと実装境界:

- 幹事の本人確認はSupabase Authの`auth.uid()`と`events.organizer_user_id`を`warikan_private.require_organizer`で照合する。イベント確定・解除、設定変更、メンバー削除はこのチェックで他の認証ユーザーを拒否する。
- アカウントレス参加者は共有トークンとdevice tokenを`require_actor` / `require_member`で解決する。生tokenは保存せずSHA-256ハッシュだけを保持する。
- 支出の編集・削除・確定はRPC内部で立替者本人または幹事に限定する。他の参加者は`PAYER_OR_ORGANIZER_REQUIRED`で拒否する。
- `save_own_fixed_amount`は対象参加者本人の行だけを更新でき、対象外の参加者は`MEMBER_NOT_TARGET`で拒否する。
- RPCは共有トークンから解決したeventと対象expenseの所属を照合する。別イベントのexpense IDを渡しても`EXPENSE_NOT_FOUND`となり、イベント越境操作はできない。
- `anon`には`events` / `expenses`への直接SELECT権限がなく、公開読み取りは権限チェックを含むRPC契約に限定される。
- `.github/workflows/ci.yml`を追加し、PRごとに`npm ci`、ユニットテスト、本番ビルド、PGliteバックエンド検証を自動実行する構成にした。PR #3で初回実行が成功した。`backend:lint`はDockerが必要なため、このCIには含めていない。

## 0. 2026-07-14 クラウドSupabase接続の進捗

- Supabaseプロジェクト `Warikan`（ref: `nrixujdkgvexnnqfoned`）へローカルをリンク済み
- `20260714000100`〜`20260714000400` の4マイグレーションをクラウドDBへ適用済み
- `.env.local` にクラウドURLとpublishable keyを設定済み（gitignore対象、service role keyは未使用）
- フロントへSupabaseクライアント共有、セッション復元、Google OAuth開始、ログアウトを実装
- ログイン済み幹事のイベント作成を `create_event` RPCへ接続し、返却された状態と共有URLを画面へ反映
- GoogleプロバイダーはSupabase上でEnabled。Google CloudのOAuth Web Clientとテストユーザーを設定済み
- Browser MCPは接続・読み取り成功。Supabaseダッシュボードとローカル画面を確認済みだが、クリック操作はWebSocket timeoutになることがある
- 4本目で、認証済み幹事がdevice tokenなしで参加者系支出RPCのactorとして解決されるよう修正
- 検証: `npm test` 19件成功、`npm run build` 成功、`npm run backend:validate` 成功

次の最短手順:

1. `/e/{shareToken}`の初回ロードで`get_event_state`を呼び、共有URLを別タブ・別端末でも復元できるようにする
2. 参加画面を`join_event` / `claim_member`へ接続する
3. 支出・精算RPCを状態hookへ段階的に接続する
4. 本番URL決定後、Supabase AuthのSite URL / Redirect URLsへ追加する

### 2026-07-14 UIレビュー反映

- 立替ダッシュボードの4つのドーナツグラフを、金額の大きい順に並ぶ横棒グラフへ変更
- 各棒に支出名／相手名、金額、全体比率を併記し、偏りと絶対額を同時に読める構成へ変更
- 精算比較カードの支払／受取結論をカード上部中央へ移動
- 参加者視点では `あなた → 相手に支払う` または `相手 → あなたが受け取る` と明示
- 幹事名「あなた」と参加者本人を示す「あなた」の重複を避けるため、参加者向け結論では幹事を「幹事」と表記
- 比較する各人の名前カードを、それぞれの縦棒グラフ直下へ移動
- 支払側は淡い赤、受取側は淡い緑、幹事の全体表示はオレンジ系の中立色に設定
- ダッシュボードと精算画面の主要文字・補助文字・金額・凡例を拡大し、ウェイトを上げた

## 1. 目標と方針

旅行・飲み会の割り勘と立て替え精算を、1イベント1 URLで扱うアプリを開発中。

まずはWeb版を完成させ、その後Android / iOSへ展開する方針。UIと精算ロジックを分離し、将来モバイルクライアントから同じロジックを再利用できる構成にしている。

参照資料:

- 機能・権限・計算仕様: `Warikan/kanji-app-spec.md`
- デザインリファレンス: `Warikan/割り勘アプリUIデザイン.html`
- デザイン比較資料: `Warikan/Warikan UI Options-print.dc.html.pdf`

優先順位は「機能・権限・計算はMarkdown仕様書」「見た目はHTML/PDF」。デザイン案はモバイルの2a統合版とPCの3aブラウザ版を採用している。

仕様書の明示的な修正に従い、精算金額は読み取り専用。他人視点への切替UIは実装しない。

## 2. 現在の到達点

React + TypeScript + ViteのWeb MVPをリポジトリルートへ実装済み。Supabase未接続でも、ブラウザ内の `localStorage` だけで主要フローを試せる。

実装済み:

- 3ステップのイベント作成
  - イベント名
  - 期間タイプと日付
  - 定員（2〜50人）
- 箱根旅行のデモデータ
- 4人・2泊3日・全件金額指定のデバッグテンプレート（全員が1回以上立て替え、部分入力の暫定支出1件を含む）
- テスト用の幹事／参加者視点切り替え
- イベントホーム
  - PCは2カラム
  - モバイルは1カラム、固定負担額バー、FAB
  - カテゴリ絞り込み
  - 宿泊イベントの日別グルーピング
- 専用の立替ダッシュボード
  - 自分が立て替えた支出別／相手別の2ドーナツ
  - 自分が立て替えてもらった支出別／立替者別の2ドーナツ
  - 立替中、立て替えてもらった額、差し引きの集計
- 幹事専用のイベント設定
  - イベント名、終日・日帰り／宿泊、開始日、終了日、定員の変更
  - 参加者の代理追加と、支出未参照の参加者の削除
  - 本人確認用トークンURL発行の準備中ボタン
- 支出追加
  - PCはモーダル、モバイルは全画面
  - 全カテゴリから選択、日付、内容、金額、支払者、対象者
  - 均等割り、金額指定
- 精算
  - 暫定プレビュー
  - 支払い対象者ごとに複数支出を集約
  - 逆方向の立て替えを差し引き
  - 元支出・差し引き項目・計算式の内訳表示
  - 幹事による確定・解除
  - `pending → reported → paid`
  - 1段階の取り消し
  - 金額はすべて自動計算・読み取り専用
- ブラウザ内自動保存
- PWAビルド設定
- Netlify設定
- リリース前に削除するテスト用「最初から」ボタン（ヘッダーと固定ボタン）

2026-07-13変更: カテゴリはイベント単位の設定ではなく、支出ごとに選択する。ホームのカテゴリタブは実際に登録済みのカテゴリだけを表示する。

2026-07-13変更: 金額指定は対象者・負担額が未完成でも暫定支出として保存できる。暫定支出はイベント合計には含むが負担・精算計算から除外し、立替え者または幹事だけが確定できる。暫定が残る間はイベント全体の精算を確定できない。

2026-07-13変更: 金額指定の対象参加者は自分の負担額だけを途中保存できる。対象者の追加・除外と他人の金額変更、最終確定は立替え者または幹事のみ。デバッグ用視点切り替えで各権限を確認できる。支出行は立替え者・負担対象者・均等/金額指定を明示する。

2026-07-13変更: 精算画面は個人カードと全員一覧の二重表示をやめ、中央の関係する精算状況だけに統合。各人が相手の分を立て替えた金額を、支出カテゴリと同じ色の積み上げ縦棒2本で高さ比較する。`多い側 − 少ない側 = 差額`を少ない側から多い側へ支払う。参加者視点では本人を必ず左側に表示する。完了報告・確認ボタンはUIから一時的に外している（状態管理ロジックは残存）。

縦棒は太めにして中央へ寄せ、中央ラベルは「比較」。支出名・金額のアノテーションは左棒の左外側と右棒の右外側に置く。

PC精算画面は最大幅1040pxへ拡大し、カード・文字・グラフ・内訳をデスクトップだけ一段大きく表示する。1440px時の左右余白は約200px、縦棒は180×190px。モバイルの密度は維持する。

2026-07-14変更: 「自分の立替状況」を専用の立替ダッシュボードへ移動。確定済み支出について、本人負担を除いた立替額を支出イベント別・立替相手別で表示し、さらに自分が立て替えてもらった額を支出イベント別・立替者別で表示する4ドーナツ構成。支出カードはカテゴリ色、見出し、立替者、立替対象ピル、割り方へ再構成し、金額指定は対象者別内訳を展開できる。4人テンプレートは8件すべて金額指定（1件は部分入力の暫定）。ヘッダー中央の「支出イベント / 立替ダッシュボード / みんなの精算状況」タブで切り替え、「精算へ」は準備中としてdisabled。ヘッダー右側にデバッグ用「最初から」も追加。

人物色はGolden Angleで最大50人分を決定的に生成し、ヘッダー・立替者・立替対象・参加者フィルター・相手別グラフで統一する。参加者フィルターはその人が立替者または立替対象の支出を表示。PCホームは最大1240px、右カラム420px、ドーナツ約154pxへ拡大。

2026-07-14変更: ヘッダーを全体的に拡大し、幹事視点だけ「イベント設定」を追加。イベント名・予定タイプ・日程・定員を後から変更でき、幹事による参加者の代理登録と安全な削除ができる。既存支出に関係する参加者は精算データ保護のため削除不可。代理登録した本人へ渡すclaim用トークンURLはボタンのみ準備中。

## 3. 技術構成

- React 19
- TypeScript 7
- Vite 8
- Vitest 4
- `vite-plugin-pwa`
- 現在の保存先: `localStorage`
  - キー: `warikan.web.mvp.v1`
- 本番ビルド出力: `dist/`

主要ファイル:

- `src/App.tsx`: 画面遷移と状態hookの統合
- `src/styles.css`: HTML/PDF準拠のレスポンシブデザイン
- `src/components/CreateWizard.tsx`: イベント作成
- `src/components/HomeView.tsx`: イベントホーム
- `src/components/ExpenseForm.tsx`: 支出入力
- `src/components/SettlementView.tsx`: 精算画面
- `src/components/OrganizerControls.tsx`: 幹事操作
- `src/state/useWarikanApp.ts`: 状態管理とlocalStorage永続化
- `src/data/demo.ts`: 箱根旅行デモ
- `src/domain/types.ts`: ドメイン型とカテゴリ定義
- `src/domain/settlement.ts`: 精算エンジン
- `src/domain/settlement.test.ts`: 精算テスト
- `src/lib/random.ts`: LAN内HTTP対応のID生成
- `src/lib/random.test.ts`: ID生成テスト
- `vite.config.ts`: React / PWA設定
- `netlify.toml`: NetlifyビルドとSPAリダイレクト

## 4. 精算エンジンのルール

- `equal`
  - 各対象者は `floor(amount / n)` 円
  - 端数は支払者負担
  - 支払者が対象外でも端数だけ支払者負担へ加える
- `fixed`
  - 対象者ごとの指定額を使用
  - 未入力・一部入力なら暫定支出として保存
  - 支出確定時は全員分の入力と合計一致が必須
- balance
  - `支払った合計 - 負担した合計`
- 相手ごと精算
  - 確定済み支出から対象者→立替え者の負担を集約
  - 同じ2人の逆方向負担を差し引く
  - 差し引き前の支出、逆方向の支出、計算式を保持・表示
  - 完全相殺は0円・支払い不要として内訳を残す
- 暫定支出はイベント合計に含むが、balanceと精算には含めない
- `dayIndex` は1始まり

## 5. 起動方法

PC内だけで確認:

```bash
npm install
npm run dev
```

同じWi-Fi上のスマホから確認:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

PCのIPv4アドレスを確認し、スマホで次の形式を開く。

```text
http://<PCのIPv4>:5173/
```

2026-07-12時点のURLは `http://192.168.1.13:5173/`。IPは再起動やネットワーク変更で変わる可能性がある。

現在は開発サーバーが `0.0.0.0:5173` で起動中。ただし翌日まで起動している保証はない。

## 6. 実機確認で発見・修正した問題

### LAN内HTTPで「作成する」が反応しない

原因:

- `http://192.168.x.x` はブラウザ上で非セキュアコンテキストになる
- `crypto.randomUUID()` は非セキュアコンテキストでは未提供
- イベントID生成時に例外となり、画面遷移しなかった

修正:

- `src/lib/random.ts` を追加
- `crypto.randomUUID()` があれば使用
- なければ `crypto.getRandomValues()` からUUID v4を生成
- Web Crypto自体がない非常に古い環境のみ最終フォールバック
- イベント作成・デモ読込で例外が出た場合は画面にエラー表示

実機相当のLAN HTTP条件で確認済み:

- `isSecureContext === false`
- `crypto.randomUUID === undefined`
- `crypto.getRandomValues` は利用可能
- 「作成する」からイベントホームへ遷移成功
- 36文字の共有トークン生成成功

注意: 本番の共有トークンは最終的にバックエンド側で暗号学的乱数から生成し、クライアント生成値を認証境界として信用しないこと。

## 7. 検証結果

```bash
npm test
```

- 2テストファイル成功
- 2テストファイル、14テスト成功

```bash
npm run build
```

- TypeScript型検査成功
- Vite本番ビルド成功
- PWA Service Worker生成成功

ブラウザ相当の操作確認:

- 1440px PC表示: 横はみ出しなし
- 390px モバイル表示: 横はみ出しなし
- 支出入力からlocalStorage保存まで成功
- 暫定支出の部分入力保存 → 内訳確定 → イベント精算確定の制御を確認
- 相手ごとの集約と逆方向差し引き内訳を確認
- ページ再読込後の状態復元成功
- 実行時コンソールエラーなし
- デモ計算は資料と一致
  - 合計: ¥98,500
  - あなたの負担: ¥16,865
  - あなた → ケンタ: ¥8,465

## 8. 未実装・現在の制約

画面はまだlocalStorageを使用中。Supabase基盤は実装済みだが、実際のグループ利用に必要な以下は未接続または未実装。

- フロント状態層からSupabase RPCへの切り替え
- 共有URLを別端末で開いた際のイベント取得
- 参加画面から `join_event` / `claim_member` への接続
- フロント画面から支出編集・削除・暫定入力・精算確定・支払い状態遷移RPCへの接続
- 支出の編集・削除
- 本格的な幹事ダッシュボード
- 催促文生成
- 監査ログ
- 公開環境へのデプロイ
- HTTPS実機確認
- PWAインストール確認
- Android / iOSネイティブアプリまたはラッパー

2026-07-14バックエンド基盤追加:

- Supabase CLI 2.109.1を開発依存として固定し、`supabase/config.toml` を作成
- 2本の初期マイグレーションでコアテーブル、RLS、主要RPCを実装
- LINE／Discordを見据えた `event_integrations`、`notification_jobs`、`notification_deliveries`、`member_external_accounts`
- 生device tokenとclaim tokenは保存せずSHA-256ハッシュだけを保存
- `get_event_state` のcamelCase JSON契約と `src/backend/` の型付きSupabaseアダプターを追加
- pgTAP 27項目と、Dockerなしで実行できる `npm run backend:validate` を追加
- このPCにはDockerがないためSupabase完全スタックのテストは未実行。PGliteではマイグレーション3本と主要フローが成功

2026-07-14精算RPC追加:

- 3本目のマイグレーションで支出編集・削除・本人負担額保存・暫定確定を実装
- 確定済み支出からペアごとの両方向負担を生成し、反対方向を差し引いて `settlements` / `settlement_items` へ保存
- 暫定支出が残る場合はイベント確定を拒否
- 支払い報告、受取確認、1段階取り消し、変更済み精算がある場合の確定解除確認を実装
- PGlite検証で `6,000円 - 2,000円 = 4,000円` の精算と状態遷移を確認

現状の「共有リンクをコピー」は `/e/{shareToken}` を生成するが、別端末にはイベントデータがないため、まだ本当の共有リンクとしては機能しない。

新規作成したイベントは幹事「あなた」1人だけで開始する。一般参加者を追加するUIがまだないため、複数人の動作確認には4人・2泊3日のデバッグテンプレートを使う。

## 9. 次に着手する推奨順

1. `/e/{shareToken}` の参加画面から `get_event_state` / `join_event` / `claim_member` を使用
2. localStorage状態層をSupabaseリポジトリへ置き換える
3. NetlifyへHTTPSデプロイし、複数スマホで共有・参加・精算をE2E確認
4. LINE／Discord adapterと通知workerを追加
5. Web版安定後、Android / iOS展開方法を決定

## 10. 仕様上、実装前に決める必要がある点

- TypeScript精算エンジンとPostgres finalize処理をどう一貫させるか
  - Edge FunctionでTypeScriptを再利用する
  - またはPL/pgSQL版と契約テストを持つ
- 幹事Authユーザーの `members` 行は `create_event` と同一トランザクションで作成する方針に決定済み
- `get_event_state` は現在のTypeScript型に合わせたcamelCase JSONに決定済み
- unfinalize時にreported / paidがある場合の再確認方法
- 精算内訳を `settlement_items` として保存する際のRPCレスポンス型

## 11. Git状態

リポジトリはまだ初回コミット前。現在の実装および `Warikan/` の資料はすべてuntracked状態。

作業再開時は、意図しない生成物がないことを確認してからコミットすること。

## 12. 2026-07-23 フェーズ3初回デプロイ

- Netlifyサイト `polaris-warikan` を作成し、本番URL [https://polaris-warikan.netlify.app](https://polaris-warikan.netlify.app) へ初回デプロイ済み。
- Netlify Site ID: `fec9493a-b012-4b72-86b9-1445a73efb03`。Deploy ID: `6a612c07ffb3e83254440af2`。
- Netlifyには `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` を本番・Deploy Preview用に設定済み（値はリポジトリへ保存しない）。
- 本番トップページはHTTP 200、BrowserMCPでも「割り勘をはじめる」画面とGoogleログイン導線を確認済み。
- Supabase Auth URL ConfigurationはSite URLを本番URLへ変更し、本番Redirect URL `https://polaris-warikan.netlify.app/**` を追加。ローカルURLは維持。
- ドキュメント更新だけでは再デプロイせず、次回デプロイはアプリ機能変更をまとめてから実施する。
- PWAマニフェストの説明文を正しい日本語へ修正し、ビルド・本番デプロイ（Deploy ID `6a612cdf14e4725bff517444`）を追加で1回実施。`manifest.webmanifest`とService Workerの配信を確認済み。実機のホーム画面追加は未確認。
- 本番URLのGoogle OAuth入口を再確認し、Supabase callback経由でGoogleアカウント選択画面まで到達。選択したGoogleアカウントで再設定用電話番号の追加本人確認が発生したため、電話コード入力は行わず停止。アプリ側のリダイレクト設定不備ではない。
- `pokemonclub820@gmail.com`を選択した本番OAuthでは、認証済みメール表示、イベント「本番OAuth確認」の作成、共有URL発行まで成功。確認後にイベントを削除し、クラウド上の検証データを残していない。

## 13. フェーズ3実機受け入れ手順

BrowserMCPでは同一ブラウザ内の別セッション／実機を作れないため、以下は実端末で実施する残件。

1. 端末Aで `https://polaris-warikan.netlify.app` を開き、Googleログイン後にイベントを作成して共有URLをコピーする。
2. 端末Bで共有URLを開き、ログインなしで表示される参加者名入力から参加する。端末Aの参加者一覧に反映されることを確認する。
3. 端末Bで支出を1件追加し、端末Aへリロードなしで反映されることを確認する。
4. 端末Aで支出内訳を確定し、精算を確定する。端末Bで同じ精算状態・支払方向・金額を確認する。
5. Android ChromeまたはiOS Safariでブラウザの「ホーム画面に追加」を実行し、standalone起動、manifestアイコン、再起動後の表示を確認する。
6. 確認後はイベント設定から検証イベントを削除し、検証データを残さない。

合格条件は、共有URL参加・支出・精算・Realtimeが端末間で反映され、PWAがホーム画面から起動できること。

オフライン実機確認では、端末Bで共有イベントを開いた状態でネットワークをオフラインにし、新規支出を送信する。「オフライン中」の表示後にオンラインへ戻し、支出が自動追加され、端末Aへリロードなしで反映されることを確認する。失敗時は`warikan.web.pending-expenses.v1`が残り、再度onlineイベントが発生した際に再試行されることを確認する。

## 14. フェーズ5着手前の設計境界

通知outbox (`notification_jobs` / `notification_deliveries`) と登録・キューRPCは既にDBへ存在する。一方、`organizer_upsert_integration`は現在Webhook秘密情報を受け取らず、`event_integrations.config`もクライアント登録経路へ公開していない。したがって次の実装は、Webhook URLをブラウザへ再表示しない秘密管理、Edge Functionのservice-role限定取得、Discord/LINE別adapter、配送結果の原子的な記録を先に設計する。秘密情報を`VITE_*`やリポジトリへ追加しない。

通知本文の共通正規化は`src/notifications/adapters.ts`へ先行実装し、`src/notifications/adapters.test.ts`で3ケースを検証済み。dispatcher実装時はこの契約をEdge Function側へ移植し、外部送信前に空本文・mention展開を制御する。

`supabase/functions/notification-dispatcher/index.ts`へdispatcher骨格を追加した。`POST`でatomic claim RPCからdue jobを最大20件取得し、Discord送信、`notification_deliveries`記録、指数バックオフ（最大1時間）、`max_attempts`到達時の`failed`化を行う。`20260723000200_notification_claim.sql`は`FOR UPDATE SKIP LOCKED`で多重起動時の同一ジョブ取得を防ぐ。service role環境変数以外の秘密は参照しない。LINEのchannel secret設計は本番投入前に追加する。

LINE Push経路を追加し、channel access tokenは`LINE_CHANNEL_ACCESS_TOKEN`からのみ取得、宛先はintegrationの`external_space_id`を使用する。実トークンはコード・文書・Vite環境変数へ置かない。Discord 2,000文字／LINE 5,000文字の上限もテスト済み。

幹事設定へDiscord／LINE通知先の登録・変更・削除・テスト通知キューUIを追加した。Discord Webhook URLは`integration-settings` Edge FunctionでAES-256-GCM暗号化し、DBと監査ログへ平文を残さず、画面へも再表示しない。復号鍵はSupabase Function secretにのみ設定済み。LINE送信先は末尾6文字だけを表示する。`integration-settings`と`notification-dispatcher`は本番デプロイ済みで、未認証アクセスは401を確認。ユニットテスト77件、Playwright 16件が成功し、Netlify Deploy `6a61c1aa254402e0ea1eea83`へ反映。本番の設定チャンク配信と通知設定UI文字列、console error 0件を確認した。実外部送信は有効なDiscord Webhook／`LINE_CHANNEL_ACCESS_TOKEN`が用意できた時点で確認する。

フェーズ6のコード分割として、`EventSettingsView`を`React.lazy` + `Suspense`へ変更。ビルドで初回JS約495KB、設定チャンク約7.47KBを確認した。

さらに`AdvanceDashboardView`と`SettlementView`も遅延ロード化。最新ビルドでは初回JS約462.6KB、設定7.46KB、ダッシュボード8.24KB、精算25.06KBのチャンクを確認した。

本番URLのLighthouse初回計測（デスクトップ、Performanceのみ）はスコア0.93、FCP 0.83、LCP 0.96、TBT 1.00、Speed Index 0.54。計測はネットワーク条件で変動するため、コード分割後の比較基準として保存する。

LighthouseをCIの回帰ゲートへ追加した。`npm run audit:lighthouse`はローカルproduction previewをDesktop 1280px／Mobile 390pxで測り、`LIGHTHOUSE_BASELINES.json`比10%超を警告、20%超を失敗とする。初回基準はDesktop Performance 1.00（FCP 405ms/LCP 463ms）、Mobile 0.97（FCP 1,936ms/LCP 2,086ms）。初回JS/CSSと設定・ダッシュボード・精算チャンクは`dist`実サイズで別途追跡する。結果は`lighthouse-results.json`へ出力しCI artifactで7日保存。基準更新は`npm run audit:lighthouse:update`を使う。

Playwrightを導入し、`npm run test:e2e`でDesktop Chrome / Pixel 5相当の4スモークケースが成功。Vitestは`npm test`から`e2e`を除外し、単体テストとブラウザテストを分離した。CIではChromiumをインストールしてE2Eを実行する。

さらに4人デモからダッシュボード、精算状況、支払いタブへの画面遷移を追加し、Desktop／Pixel 5相当の6ケース全件成功を確認した。

支出追加フォームの表示とキャンセル後のデモ状態維持も追加し、Playwrightは8ケース全件成功（Desktop 4 / Pixel 5相当 4）。

さらにローカルデモで内容・金額を入力して支出を追加するシナリオを追加。Desktop／Pixel 5相当の10ケース全件成功で、9件目の支出表示まで確認した。

支出追加→金額編集→削除の完全フローも追加。Pixel 5相当で削除確認が固定フッターに遮られる問題を検出し、確認表示中は通常アクションバーを描画しないよう修正した。Playwrightは12ケース全件成功。`npm run test:e2e`は先にbuildして古いpreview資産を使わない。

Playwrightはlist＋HTML reporterを使い、CIで`playwright-report`を常にartifact保存（7日）する。失敗時も画面・traceを確認できる。

フェーズ7のエラー監視基盤として`@sentry/react`を追加。`VITE_SENTRY_DSN`未設定時は初期化せず、設定時も共有URL token・claim・device token・参加者名・認証情報をエラーとtransactionの送信前にマスクする。独自Error Boundaryはエラー発生時に遅延SDKを即時ロードする。実DSNはコードや文書へ保存しない。

オフライン新規支出は`warikan.web.pending-expenses.v1`へイベント別に保存し、device tokenはキューへ含めない。オンライン復帰時に登録順で送信し、成功した項目だけキューから除去してBroadcastと状態再取得を行う。既存支出の編集・削除は競合を避けるためオフラインでは実行しない。キュー永続化はユニットテスト済み、実機復帰E2Eは残件。

再送は即時・3秒後・9秒後の最大3回とし、失敗後は自動ループを止める。支出一覧には待機中・送信中・失敗を表示し、失敗項目の手動リトライと送信前削除ができる。旧キュー形式は`pending`・0回として安全に読み替える。実機復帰E2Eは引き続き残件。

債務マトリクスは一度関係マップとの切替表示として追加したが、2026-07-23のユーザー確認で分かりにくいと判断し、後続変更でUIから撤去した。現在の精算画面は関係マップ、ペアカード、内訳の構成。

共有URLは新規イベントから32ランダムbyte（base64url 43文字）を使用する。認証済み幹事は設定画面の二段階確認からURLを再発行でき、旧URLは即時無効、新URLだけが有効になる。操作は`activity_logs`へ記録する。最終検証はユニットテスト全70件、Playwright全16件、PGliteの7マイグレーションが成功。Supabase側WAF／Rate Limitingはダッシュボード運用残件で、送信元IPを信頼できないPostgres RPC内に擬似的なIP制限は置かない。

上記をNetlify Deploy `6a61be9b110f068539eaf479`へまとめて本番反映した。Supabaseへ`20260723000200`と`20260723000300`を適用済み（適用後のDocker catalog cache警告はローカルDocker未起動によるもので、リモート適用自体は完了）。本番のDesktop 1280px／Mobile 390pxで債務マトリクス6セル、14,400円、ページ横はみ出しなし、console error 0件を確認した。

PWAの自動回帰として、ビルド後previewの`manifest.webmanifest`（アプリ名、`display: standalone`、`start_url`）と`/sw.js`の配信をDesktop／Pixel 5相当で検証するPlaywrightケースを追加。合計14ケースが成功している。ホーム画面追加とオフライン復帰は下記の実機手順で別途確認する。

参加者名の予約語バリデーションを追加。共有URL参加と幹事代理登録の双方で、trim後の「あなた」「幹事」を拒否し、表示層ではなく入力境界で防止する。許可・拒否ケースはユニットテスト済み。

# Polaris セキュリティ監査

最終更新: 2026-07-24

## 結論

2回目の防御的監査で確認したHigh 1件を修正し、変更後に再現できる未修正Critical／Highは0件。

PayPay IDは認証情報ではないが、イベント内限定の個人識別情報として扱う。今回はアプリ層暗号化を増やさず、閲覧者の最小化、明示削除、精算完了後の非表示、30日保持、イベント完全削除、ログ秘匿を優先した。

## 監査方法

- `ROADMAP2.md`の役割・データ・保持期間を基準に、RPCからUIまでデータフローを追跡
- 未参加者、幹事、支払者、受取者、無関係参加者、別イベント参加者、service roleの負のテスト
- 実Supabase Postgresへマイグレーションを適用し、Management API経由でpgTAPを実行
- Vitest、Playwright、本番asset検査、Database Linter、`npm audit`を併用
- Claude CLIをファイル読み取り専用、Bash／外部アクセス／編集不可で実行

Claude Sonnetは時間切れ、指定されたFable5は現在のアカウントで利用不可だったため、Claude Haikuで監査を完了した。Claudeの指摘は確定扱いにせず、コードと実Postgresの負のテストで再検証した。

## Claude指摘の再検証

| ID | Claude指摘 | 再検証結果 |
|---|---|---|
| CA-01 | 幹事が全参加者のPayPay IDを取得できる | 誤検知。`get_payment_state`は本人、または本人が未精算の正額settlementで支払う相手だけを返す。幹事特例は削除済み。実Postgresで幹事が本人以外を取得しないことを確認。 |
| CA-02 | PayPay公式host上の任意pathがCritical | Criticalには該当しない。scheme、host、userinfo、port、長さをクライアントとDBで固定し、許可hostは`paypay.ne.jp`と`qr.paypay.ne.jp`だけ。PayPay公式ヘルプは受け取りリンクの固定path仕様を公開していないため、推測したpath allowlistは導入しない。外部遷移前には相手と金額の確認を表示する。 |
| CA-03 | device tokenが`Math.random`へfallbackする | 誤検知。クラウド認可に使う`generateDeviceToken`はWeb Cryptoの32 byteだけを使用する。`Math.random` fallbackはローカルデモ用IDであり、クラウドRPCの認証tokenには使わない。 |
| CA-04 | PayPay IDとクラウド支出がlocalStorageへ保存される | 一部誤検知。クラウドのPayPay stateはReactメモリだけで、イベント／参加者／認証主体の切替と削除時に消去する。device tokenはセッション復元のためlocalStorageへ保存するので、XSSや共有端末は残余リスクとして扱う。 |
| CA-05 | claim tokenに期限・1回利用がない | 誤検知。DBが7日期限、1回利用、再発行時の旧token無効化を強制する。発行UIも期限を表示し、claimed済みの再発行を拒否する。 |
| CA-06 | URL encodeされたPayPayキーがSentryへ残る可能性 | 低リスクの改善として採用。`%20`／`%5F`／`%3D`や全文字encode済みキーをdecode後に判定し、queryとJSON文字列を伏字化する回帰テストを追加した。 |
| CA-07 | 長い参加者名と双方向制御文字 | 改善として採用。50文字上限、予約語、C0／DEL、双方向制御文字の拒否をクライアントとDBの両方へ追加した。 |
| CA-08 | イベントをsoft deleteすべき | 不採用。利用者がPayPay IDを含むデータを消去できることが今回の要件であり、soft deleteは削除の期待と保持期限に反する。幹事認証、イベント名入力、削除範囲の明示、RPC成功後だけ画面をリセットする方式を維持する。 |

## 2回目の監査指摘と対応

| ID | 監査指摘 | 独立検証と対応 |
|---|---|---|
| F1 High | `authenticated`の直接table DMLがRPCの状態遷移を迂回する | 実Postgresで自イベント内の直接更新が成立することを確認。旧default ACLを含む全public table／sequence権限を`PUBLIC`／`anon`／`authenticated`から剥奪し、将来のtable／sequence／functionも明示grant方式へ変更。修正後は直接table grant 0件、`settlements`／`members`直接更新拒否をpgTAPで固定した。 |
| F2 Medium | notification dispatcherがservice roleをコード内で識別しない | gateway JWT検証に加え、`Authorization: Bearer <service role key>`の厳密照合を処理開始前へ追加。不正な有効JWTでも401とし、terminal／試行上限到達jobを再取得しないようclaim条件も修正した。 |
| F3 Medium | 旧`organizer_upsert_integration`が現在の検証・暗号化経路を迂回する | クライアントEXECUTEを剥奪し、`integration-settings` Edge Functionへ一本化。旧RPCだけではDiscordの暗号化secretを作れず任意Webhook配送には直結しない、という監査上の過大評価も補正した。 |
| F4 Medium | 複数タブのオフライン再送で同じ支出を二重登録できる | pending UUIDを`add_expense`へ渡し、`(event_id, idempotency_key)` unique制約と同一結果返却でDB冪等化。対象行とactivity logが1組だけになることを実Postgresで検証した。 |
| F5 Medium | 参加者名のサーバー側検証がクライアントより弱い | `next_member_name`で予約語、C0／DEL、双方向制御文字を拒否し、直接RPC呼び出しでも同じ規則を強制した。 |
| F6 Low | PayPay請求URLのpathへ制御文字を含められる | クライアント、RPC、table CHECKの3層で制御文字を拒否した。 |
| F7 Low | 外部連携コードの不一致試行がcode行のattemptsを増やさない | 署名済みWebhookだけが到達し、32-bit／5分に加えて外部ID単位10回／5分のrate limitがconsume前に適用されるため、現行仕様を残余リスクとして受容。実サービスE2Eでrate limit契約を再確認する。 |
| F8 Low | URL encodeされた機密キーのSentry伏字化に隙がある | query keyとJSON property keyをdecode後に判定し、`%5F`／`%3D`／全文字encodeの回帰テストを追加した。 |

## 確認済みの防御

- 全public table／sequenceの直接権限を`PUBLIC`／`anon`／`authenticated`から剥奪し、将来のオブジェクトも明示grant方式へ固定
- payment RPCは`SECURITY DEFINER`、空`search_path`、明示EXECUTE grant
- share tokenだけ、無効device token、別イベントtoken、無関係参加者、無関係幹事を拒否
- paid後は支払者へPayPay ID／リンクを返さず、リンク行を即時削除
- PayPayプロフィールは本人が即時削除でき、全正額settlement完了から30日後に日次purge
- purgeは`service_role`だけ実行可能。Supabaseの`03:17 UTC` cron jobが有効
- クラウドイベント削除は幹事だけが実行でき、支出・精算を依存順に消してからevent cascadeを実行
- Sentryでshare／claim／device／PayPay／Webhook情報をevent、breadcrumb、transaction、spanから再帰的に伏字化
- notification dispatcherはgateway JWTに加えてservice-role bearerをコード内で照合し、terminal jobを再取得しない
- オフライン支出再送はDBのイベント単位idempotency keyで二重登録を防止
- CSP、referrer制御、nosniff、frame拒否、Permissions PolicyをNetlifyへ設定
- production buildから視点切替とテスト用リセットのコード／CSS／文言を除外

## 検証結果

- Hosted pgTAP: 6ファイル、198 assertions成功
- PGlite: 15 migrationsと主要フロー成功
- Vitest: 23ファイル、137 tests成功
- Playwright: 3 viewport、37成功、対象外2
- Production asset scan: 11 assets、debug marker 0
- `npm audit --omit=dev`: 0 vulnerabilities
- Supabase Database Linter: errorなし。既存系統を含むwarning 4件は動作テスト済みで、別の保守改善として管理する。

## 残余リスク

1. PayPay IDはSupabase DBとバックアップでは平文である。service role／DB dump侵害は防げない。30日保持を延ばす場合や識別子の種類を増やす場合は、DBと鍵を分離したEdge Function AES-GCM方式を再評価する。
2. device tokenはアカウントレス参加者の復元用bearer tokenとしてlocalStorageに残る。CSPとサーバー側actor検証で軽減するが、同一origin XSS、悪意ある拡張機能、共有端末の利用者には読まれ得る。
3. PayPayリンクは公式2 hostを信頼境界とする。PayPay側が固定path仕様を公開していないため、pathを推測して固定しない。利用者は外部アプリで相手と金額を再確認する必要がある。
4. 外部連携コードは32-bit・5分・外部ID単位10回／5分制限を組み合わせる。現実的な推測成功率は低いが、実LINE／Discord環境でrate limitと期限切れを再確認する。
5. Android／iPad、Google OAuth復帰、実LINE／Discord配送、Sentry実envelope、運用WAF／Network Restrictionsは外部環境での受け入れが残る。

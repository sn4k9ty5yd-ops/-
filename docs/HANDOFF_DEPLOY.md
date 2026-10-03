# 公開作業の引き継ぎ（次のセッション用）

ユーザーは「オプションA: Claudeが公開まで進める」を選んだ。コードは完成・検証済み（`CLAUDE.md` と `docs/DEPLOY.md` を参照）。

## 前提（ユーザーが用意するもの）
- Neon と Render のアカウント
- 環境変数 `NEON_API_KEY` / `RENDER_API_KEY`（環境の設定に入れてある。**チャットに貼らせない・ログに出さない**）
- ネットワーク許可: `console.neon.tech`, `api.render.com`, `*.neon.tech`, `*.onrender.com`
- Render側で GitHub 連携（このリポジトリの読み取り）を、ユーザーが1回だけ許可する（Claudeにはできない）

最初に必ず確認する: `env | grep -E "NEON|RENDER" | sed 's/=.*/=set/'` と、各ホストへの接続（curl）。足りなければ、何が足りないかを**やさしい日本語で**伝えて止まる。

## 手順
1. **Neon**: `POST https://console.neon.tech/api/v2/projects` （`Authorization: Bearer $NEON_API_KEY`）
   `{"project":{"name":"album","region_id":"aws-ap-southeast-1","pg_version":16}}`
   → 返ってきた接続文字列（`connection_uris[0].connection_uri`）を `DATABASE_URL` として使う（画面・ログ・コミットに出さない）。
2. **手元で検証**: その `DATABASE_URL` で `npm run setup` は**まだ実行しない**（初期設定は公開後に `/setup` で行う）。マイグレーションは初回アクセス時に自動実行される。
   Neon の非スーパーユーザー権限で `db/migrations` が通ることを、一時的に確認してよい（確認後、データは消さずそのままでよい）。
3. **Render**: `GET /v1/owners` で ownerId を取得 → `POST /v1/services`
   - type: web_service, runtime: node, plan: free, region: singapore
   - repo: このリポジトリのURL、branch: `claude/wonderful-wozniak-ugiono`、autoDeploy: yes
   - buildCommand: `npm ci --include=dev && npm run build` / startCommand: `npm start` / healthCheckPath: `/api/health`
   - 環境変数: `NODE_VERSION=22`, `DATABASE_URL=<Neonの接続文字列>`, `SETUP_KEY=<ランダム32文字以上。Claudeが生成>`
   - リポジトリが読めずに失敗したら、「RenderでGitHub連携を許可してください」とユーザーに依頼する。
4. デプロイ完了を待つ（`GET /v1/services/{id}/deploys`）。失敗したらログを読んで直す。
5. `https://<サービス>.onrender.com/api/health` が `{"ok":true}` になるのを確認。
6. `POST /api/setup`（`SETUP_KEY` を使用）で、会社 `album`・5店舗・管理者(9000)を作る。**管理者のパスコードは、ユーザーに1度だけ伝える**（記録に残さない）。
7. 公開URLで、ログイン・店舗の編集・シフト期間の作成が動くことを、Playwright（`/opt/pw-browsers/chromium`）で確認する。
8. ユーザーに伝える: アドレス、管理者の社員番号とパスコード、iPhoneのホーム画面への追加手順、Renderが15分で寝る注意、バックアップの取り方。
9. `SETUP_KEY` はもう使わないので、ユーザーに「Renderの環境変数から削除してもよい」と伝える。

## 注意
- 追加の確認なしに、お金がかかる設定（有料プラン）にしない。無料プランのみ。
- 失敗しても、データベースの中身を勝手に消さない。やり直しが必要なら、ユーザーに確認する。
- 終わったら `CLAUDE.md` の「進み具合」に、公開したアドレス（パスコードは書かない）を追記して push。

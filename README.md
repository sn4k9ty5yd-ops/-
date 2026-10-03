# シフト管理アプリ

設計: `docs/DESIGN.md` / 画面イメージ: `docs/mockups/index.html`

## 開発コマンド
- `npm install`
- `npm test` — 会社ごとのデータ分離・操作レベルの安全テスト（Dockerなしで動作）
- `npm run dev` — 開発サーバー
- `npm run typecheck`

## 構成
- `db/migrations/` — DB定義とRow Level Security
- `lib/auth/` — 社員番号＋パスコードのログイン（ハッシュ化・ロック・セッション）
- `tests/rls.test.ts` — 「他社が見えない」「レベルごとの権限」のテスト
- `app/` — Next.js（スマホ優先、PWA）
- `app/admin/` — 管理画面（デモデータで動作。`/admin/staff` を開く）

## お試しで動かす（アカウント不要）
1. `npm install`
2. `npm run seed` — お試しデータ（会社ID `atena`、社員番号とパスコードが表示される）を作成
3. `npm run dev` → http://localhost:3000/login を開き、表示された社員番号・パスコードでログイン
   （データは `.data/` に保存される。消すと初期化）

## 最初の設定（本番・お試し共通）
- `npm run setup` — 会社・お店（ATENA／ATENA六本松／ATENA福津／Organ／ATENA AVEDA SAKURAMACHI）・管理者アカウントを作る。管理者のパスコードは、ここで1度だけ表示される。
- お店の追加・名前の変更・閉店は、ログイン後の「⚙ 店舗の編集」（管理者のみ）でいつでもできる。

## 本番（Neon など）
- 環境変数 `DATABASE_URL` に PostgreSQL の接続文字列を設定すると、起動時に自動でテーブルが作られる。
- `npm run backup` で全データを `backups/` にJSONで書き出し（個人情報を含むため Git には入らない）。

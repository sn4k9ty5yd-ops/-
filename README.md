# シフト管理アプリ

設計: `docs/DESIGN.md` / 画面イメージ: `docs/mockups/index.html`

## 開発コマンド
- `npm install`
- `npm test` — 会社ごとのデータ分離・操作レベルの安全テスト（Dockerなしで動作）
- `npm run dev` — 開発サーバー
- `npm run typecheck`

## 構成
- `supabase/migrations/` — DB定義とRow Level Security
- `lib/auth/` — 社員番号＋パスコードのログイン（ハッシュ化・ロック・セッション）
- `tests/rls.test.ts` — 「他社が見えない」「レベルごとの権限」のテスト
- `app/` — Next.js（スマホ優先、PWA）
- `app/admin/` — 管理画面（デモデータで動作。`/admin/staff` を開く）

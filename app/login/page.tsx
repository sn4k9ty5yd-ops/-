// ログイン画面（見た目のみ）。認証との接続は Supabase プロジェクト作成後に行う。
export default function LoginPage() {
  return (
    <main>
      <h1>ログイン</h1>
      <form>
        <label htmlFor="company">会社ID</label>
        <input id="company" name="company" autoCapitalize="none" autoComplete="organization" required />
        <label htmlFor="email">メールアドレス</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">パスワード</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button type="submit">ログイン</button>
      </form>
      <p className="hint">会社ID・メールアドレス・パスワードを入力してください。</p>
      <p className="hint"><a href="/admin/staff">デモ画面を見る（ログイン不要）</a></p>
    </main>
  );
}

import { redirect } from "next/navigation";

// ログイン状態の判定は認証の接続後に追加する。いまはログイン画面へ。
export default function Home() {
  redirect("/login");
}

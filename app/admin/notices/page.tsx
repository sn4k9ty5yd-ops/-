import { redirect } from "next/navigation";

// 「お知らせ文」は「アプリの説明書」の中に移しました。
export default function Page() { redirect("/admin/guide"); }

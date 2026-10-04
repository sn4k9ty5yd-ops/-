import { redirect } from "next/navigation";

// 「シフト管理」と「シフト期間」を1つにまとめました。古いリンクは、まとめた画面へ。
export default function Page() { redirect("/admin/periods"); }

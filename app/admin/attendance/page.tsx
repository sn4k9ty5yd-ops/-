import { redirect } from "next/navigation";

// 「勤務時間の提出」の画面はなくなりました（出勤簿にまとめました）。古いリンクは出勤簿へ。
export default function Page() { redirect("/admin/shifts"); }

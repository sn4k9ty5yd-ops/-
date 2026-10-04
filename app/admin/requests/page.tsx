import { redirect } from "next/navigation";

// 「みんなの休み」は「シフトを見る」と同じ内容だったので、まとめました。
export default function Page() { redirect("/shifts"); }

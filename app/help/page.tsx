import { redirect } from "next/navigation";

/** ヘルプのページは、右下の「？」ボタン（アシスタント）に置きかえた */
export default function HelpPage() { redirect("/home"); }

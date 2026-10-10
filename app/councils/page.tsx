import { redirect } from "next/navigation";

// ふつうのAI会議は、ミーティング(/meetings)にまとめた。「僕専用」(/councils/private)だけ残してある
export default function Page() { redirect("/meetings"); }

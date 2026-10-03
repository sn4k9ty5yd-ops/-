// 生存確認用（データベースには触れない）。Render の確認や、定期的なアクセスに使う
export const dynamic = "force-dynamic";
export function GET() { return Response.json({ ok: true }); }

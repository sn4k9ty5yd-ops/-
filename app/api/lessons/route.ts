import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import {
  addLesson, deleteLesson, lessonCounts, listLessonAssistants, listLessonCategories, listLessons, saveLessonCategory, updateLesson,
} from "@/lib/service";

// GET ?meta=1&storeId=… → { categories, assistants, counts } / ?from=…&to=…[&storeId=…][&assistantId=…] → 記録の一覧
export const GET = authed(async (userId, req) => {
  const u = new URL(req.url); const db = await getDb();
  const storeId = u.searchParams.get("storeId") ?? undefined;
  if (u.searchParams.get("meta")) {
    if (!storeId) throw new Error("お店を指定してください");
    const all = u.searchParams.get("all") === "1";
    const [categories, assistants, counts] = await Promise.all([listLessonCategories(db, userId, storeId, all), listLessonAssistants(db, userId, storeId), lessonCounts(db, userId, storeId).catch(() => ({}))]);
    return json({ categories, assistants, counts });
  }
  return json(await listLessons(db, userId, { storeId, from: u.searchParams.get("from") ?? "", to: u.searchParams.get("to") ?? "", assistantId: u.searchParams.get("assistantId") ?? undefined }));
});

// { action: "add"|"update"|"delete"|"category", ... }
export const POST = authed(async (userId, req) => {
  const b = (await req.json()) as {
    action?: string; storeId?: string; id?: string; assistantId?: string; categoryId?: string; day?: string; minutes?: number | null; note?: string;
    category?: { id?: string; name?: string; active?: boolean; move?: "up" | "down" };
  };
  const db = await getDb();
  switch (b.action) {
    case "add": if (!b.storeId || !b.assistantId || !b.categoryId || !b.day) throw new Error("入力が足りません");
      return json(await addLesson(db, userId, b.storeId, { assistantId: b.assistantId, categoryId: b.categoryId, day: b.day, minutes: b.minutes ?? null, note: b.note }));
    case "update": if (!b.id) throw new Error("指定がありません");
      await updateLesson(db, userId, b.id, { categoryId: b.categoryId, day: b.day, minutes: b.minutes, note: b.note }); return json({ ok: true });
    case "delete": if (!b.id) throw new Error("指定がありません"); await deleteLesson(db, userId, b.id); return json({ ok: true });
    case "category": if (!b.storeId || !b.category) throw new Error("指定がありません"); await saveLessonCategory(db, userId, b.storeId, b.category); return json({ ok: true });
    default: throw new Error("操作が正しくありません");
  }
}, { write: true });

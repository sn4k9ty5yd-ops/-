import { getDb } from "@/lib/db";
import { authed, json } from "@/lib/http";
import type { EditOp } from "@/lib/manual/edit";
import { deleteManualPage, editManualBlock, getManualPage, setManualLevelDeep, updateManualPage } from "@/lib/service";

export const GET = authed<{ id: string }>(async (userId, _req, { id }) => json(await getManualPage(await getDb(), userId, id)));
export const POST = authed<{ id: string }>(async (userId, req, { id }) => {
  const b = (await req.json()) as {
    action?: string; title?: string; icon?: string; minLevel?: number; editLevel?: number; sortOrder?: number;
    storeId?: string | null; ownerId?: string | null; evaluatorsEdit?: boolean; edit?: EditOp;
  };
  const db = await getDb();
  if (b.action === "delete") { await deleteManualPage(db, userId, id); return json({ ok: true }); }
  if (b.action === "edit" && b.edit) { await editManualBlock(db, userId, id, b.edit); return json({ ok: true }); }
  if (b.action === "settingsDeep") {
    return json({ count: await setManualLevelDeep(db, userId, id, { minLevel: Number(b.minLevel), editLevel: Number(b.editLevel), evaluatorsEdit: !!b.evaluatorsEdit, storeId: b.storeId ?? null }) });
  }
  await updateManualPage(db, userId, id, {
    title: b.title, icon: b.icon, minLevel: b.minLevel, editLevel: b.editLevel, sortOrder: b.sortOrder,
    storeId: b.storeId, ownerId: b.ownerId, evaluatorsEdit: b.evaluatorsEdit,
  });
  return json({ ok: true });
}, { write: true });

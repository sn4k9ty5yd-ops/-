// 操作レベルの権限表。db/migrations/0001_tenant_core.sql の level_permissions と同一内容
// （tests/permissions.test.ts で一致を検査している）。
export type Level = 1 | 2 | 3 | 4;
export type Scope = "own" | "all";

export const LEVEL_NAMES: Record<Level, string> = {
  1: "レベル1 スタッフ",
  2: "レベル2 シフト担当",
  3: "レベル3 店長",
  4: "レベル4 オフィス",
};

export const LEVEL_PERMISSIONS: ReadonlyArray<readonly [Level, string, Scope]> = [
  [1, "staff.view", "own"], [2, "staff.view", "own"], [3, "staff.view", "all"], [4, "staff.view", "all"],
  [1, "store.view", "own"], [2, "store.view", "own"], [3, "store.view", "all"], [4, "store.view", "all"],
  [3, "staff.manage", "own"], [4, "staff.manage", "all"],
  [4, "store.manage", "all"],
  [4, "level.assign", "all"],
  [4, "period.create", "all"],
  [2, "period.manage", "own"], [3, "period.manage", "own"], [4, "period.manage", "all"],
  [4, "shift.acknowledge", "all"],
  [3, "period.acknowledge", "own"], [4, "period.acknowledge", "all"],
  [2, "request.view", "own"], [3, "request.view", "own"], [4, "request.view", "all"],
  [3, "request.manage", "own"], [4, "request.manage", "all"],
  [2, "shift.view", "own"], [3, "shift.view", "own"], [4, "shift.view", "all"],
  [2, "shift.edit", "own"], [3, "shift.edit", "own"], [4, "shift.edit", "all"],
  [4, "company.settings", "all"],
  [2, "attendance.view", "own"], [3, "attendance.view", "own"], [4, "attendance.view", "all"],
  [2, "attendance.edit", "own"], [3, "attendance.edit", "own"], [4, "attendance.edit", "all"],
  [3, "leave.view", "own"], [4, "leave.view", "all"],
  [3, "leave.manage", "own"], [4, "leave.manage", "all"],
  [1, "product.view", "own"], [2, "product.view", "own"], [3, "product.view", "all"], [4, "product.view", "all"],
  [4, "product.manage", "all"],
  [1, "stocktake.view", "own"], [1, "stocktake.edit", "own"], [2, "stocktake.view", "own"], [3, "stocktake.view", "all"], [4, "stocktake.view", "all"],
  [2, "stocktake.edit", "own"], [3, "stocktake.edit", "own"], [4, "stocktake.edit", "all"],
  [1, "stocktake.manage", "own"], [2, "stocktake.manage", "own"], [3, "stocktake.manage", "own"], [4, "stocktake.manage", "all"],
  [2, "stock.view", "own"], [3, "stock.view", "all"], [4, "stock.view", "all"],
  [2, "stock.edit", "own"], [3, "stock.edit", "own"], [4, "stock.edit", "all"],
  [3, "stock.settings", "own"], [4, "stock.settings", "all"],
  [4, "manual.manage", "all"],
  [1, "material.view", "own"], [2, "material.view", "own"], [3, "material.view", "all"], [4, "material.view", "all"],
  [1, "material.edit", "own"], [2, "material.edit", "own"], [3, "material.edit", "own"], [4, "material.edit", "all"],
  [3, "material.budget", "own"], [4, "material.budget", "all"],
];

export interface Actor {
  level: Level;
  storeId: string;
}

export function can(actor: Actor, perm: string, targetStoreId: string): boolean {
  return LEVEL_PERMISSIONS.some(
    ([lv, p, scope]) => lv === actor.level && p === perm && (scope === "all" || actor.storeId === targetStoreId),
  );
}

/** スタッフ(target)を変更・無効化できるか: 権限があり、かつ自分より下のレベル（オフィスは全員可） */
export function canManageStaff(actor: Actor, target: { level: Level; storeId: string }): boolean {
  return can(actor, "staff.manage", target.storeId) && (actor.level === 4 || target.level < actor.level);
}

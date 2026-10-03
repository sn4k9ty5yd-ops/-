// 操作レベルの権限表。supabase/migrations/0001_tenant_core.sql の level_permissions と同一内容
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

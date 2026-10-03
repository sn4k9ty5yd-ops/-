"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DEMO_STAFF, DEMO_STORES, type Staff, type Store } from "./demo-data";
import { can, canManageStaff, type Level } from "./permissions";

// デモ用のデータ置き場（ブラウザ内に保存）。Supabase 接続後は、同じ操作をDBに置き換える。
// ルールはDB側(RLS)と同じ: 権限が無ければ操作は失敗する。
interface Ctx {
  stores: Store[]; staff: Staff[]; me: Staff;
  allUsers: Staff[]; switchUser(id: string): void;
  can(perm: string, storeId: string): boolean;
  canManage(target: Staff): boolean;
  addStore(name: string): void;
  addStaff(input: { name: string; email: string; storeId: string; level: Level }): void;
  disableStaff(id: string): void;
  setLevel(id: string, level: Level): void;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => {
  const v = useContext(C);
  if (!v) throw new Error("AppProvider missing");
  return v;
};

const KEY = "shift-demo-v1";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({ stores: DEMO_STORES, staff: DEMO_STAFF, meId: "u2" });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state, ready]);

  const me = state.staff.find((s) => s.id === state.meId && s.status === "active") ?? state.staff[0];

  const api = useMemo<Ctx>(() => {
    const allow = (perm: string, storeId: string) => can({ level: me.level, storeId: me.storeId }, perm, storeId);
    const need = (perm: string, storeId: string) => {
      if (!allow(perm, storeId)) throw new Error("この操作をする権限がありません");
    };
    return {
      stores: state.stores.filter((s) => allow("store.view", s.id)),
      staff: state.staff.filter((s) => allow("staff.view", s.storeId)),
      me, allUsers: state.staff.filter((s) => s.status === "active"),
      switchUser: (id) => setState((p) => ({ ...p, meId: id })),
      can: allow,
      canManage: (t) => canManageStaff({ level: me.level, storeId: me.storeId }, t),
      addStore(name) {
        need("store.manage", "");
        setState((p) => ({ ...p, stores: [...p.stores, { id: crypto.randomUUID(), name }] }));
      },
      addStaff({ name, email, storeId, level }) {
        need("staff.manage", storeId);
        if (level !== 1) need("level.assign", storeId); // レベル1以外の登録はオフィスのみ
        if (state.staff.some((s) => s.email === email)) throw new Error("そのメールアドレスはすでに登録されています");
        setState((p) => ({
          ...p,
          staff: [...p.staff, { id: crypto.randomUUID(), name, email, storeId, level, status: "active", paidLeaveLeft: 0 }],
        }));
      },
      disableStaff(id) {
        const t = state.staff.find((s) => s.id === id)!;
        if (!canManageStaff({ level: me.level, storeId: me.storeId }, t)) throw new Error("この操作をする権限がありません");
        setState((p) => ({ ...p, staff: p.staff.map((s) => (s.id === id ? { ...s, status: "disabled" } : s)) }));
      },
      setLevel(id, level) {
        const t = state.staff.find((s) => s.id === id)!;
        need("level.assign", t.storeId);
        setState((p) => ({ ...p, staff: p.staff.map((s) => (s.id === id ? { ...s, level } : s)) }));
      },
    };
  }, [state, me]);

  if (!ready) return null;
  return <C.Provider value={api}>{children}</C.Provider>;
}

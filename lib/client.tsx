"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Me } from "./service";

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? "エラーが発生しました"), { status: res.status });
  return data as T;
}

const MeCtx = createContext<{ me: Me; logout(): Promise<void> } | null>(null);
export const useMe = () => {
  const v = useContext(MeCtx);
  if (!v) throw new Error("MeProvider missing");
  return v;
};

/** ログイン必須の領域。未ログインならログイン画面へ */
export function MeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch(() => router.replace("/login"));
  }, [router]);
  const logout = useCallback(async () => {
    await api("/api/logout", {}).catch(() => {});
    router.replace("/login");
  }, [router]);
  if (!me) return null;
  return <MeCtx.Provider value={{ me, logout }}>{children}</MeCtx.Provider>;
}

/** 開いている間、30秒ごと・画面に戻ったときに最新のデータを読み込み直す（他の人の変更が自動で反映される） */
export function useAutoRefresh(load: () => void, seconds = 30) {
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const t = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
  }, [load, seconds]);
}

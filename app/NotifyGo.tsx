"use client";
import { useEffect } from "react";

/** 通知を押したとき、すでに開いている画面を、通知の先の画面へ移す（iPhoneで「今日の画面のまま」になるのを防ぐ） */
export function NotifyGo() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== "go" || !d.url) return;
      try { const u = new URL(d.url); if (u.origin === location.origin && u.pathname + u.search !== location.pathname + location.search) location.href = u.pathname + u.search; } catch { /* 無視 */ }
    };
    navigator.serviceWorker.addEventListener("message", on);
    return () => navigator.serviceWorker.removeEventListener("message", on);
  }, []);
  return null;
}

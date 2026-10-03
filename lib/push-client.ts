/** 通知（スマホ・パソコン）をオンにするための、画面側の処理 */
import { api } from "@/lib/client";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "needs-install";          // iPhoneは、ホーム画面に追加したアプリからでないと通知できない
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch { return "off"; }
}

const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };

export async function enablePush(): Promise<PushState> {
  const st = await pushState();
  if (st === "unsupported" || st === "needs-install" || st === "denied") return st;
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();       // 押した直後に聞く（iPhoneはこれが必要）
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const { key } = await api<{ key: string }>("/api/push/key");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
  await api("/api/push/subscribe", JSON.parse(JSON.stringify(sub)));
  return "on";
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await api("/api/push/subscribe", { endpoint: sub.endpoint, off: true }).catch(() => {}); await sub.unsubscribe(); }
}

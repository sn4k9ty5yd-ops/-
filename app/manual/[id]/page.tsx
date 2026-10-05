"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, MeProvider, useAutoRefresh, useMe } from "@/lib/client";
import { hasEditable } from "@/lib/manual/blocks";
import { BlockView } from "@/lib/manual/BlockView";
import type { ManualPage, StaffRow } from "@/lib/service";

type Store = { id: string; name: string; status: string };
const RANKS = [["assistant", "アシスタント"], ["stylist", "スタイリスト"]] as const;
const LV = [[1, "レベル1 スタッフ以上"], [2, "レベル2 シフト担当以上"], [3, "レベル3 店長以上"], [4, "レベル4 管理者だけ"]] as const;

function Settings({ p, reload }: { p: ManualPage; reload: () => Promise<void> }) {
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => { api<Store[]>("/api/stores").then(setStores).catch(() => {}); api<StaffRow[]>("/api/staff").then(setStaff).catch(() => {}); }, []);
  const run = async (fn: () => Promise<unknown>, ok = "") => { try { await fn(); setMsg(ok); await reload(); } catch (e) { setMsg((e as Error).message); } };
  const save = (patch: object) => run(() => api(`/api/manual/${p.id}`, patch));
  return (
    <details className="card" style={{ marginTop: 24 }}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>⚙ このページの設定（管理者だけ）</summary>
      <label>題名<input defaultValue={p.title} onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && save({ title: e.target.value })} /></label>
      <label>アイコン（絵文字）<input defaultValue={p.icon} maxLength={4} onBlur={(e) => e.target.value !== p.icon && save({ icon: e.target.value })} /></label>
      <label>見られる人
        <select value={p.minLevel} onChange={(e) => save({ minLevel: Number(e.target.value) })}>{LV.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      </label>
      <label>書き込める人
        <select value={p.editLevel} onChange={(e) => save({ editLevel: Number(e.target.value) })}>{LV.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      </label>
      <label>お店で分ける（入れると、そのお店の人と店長以上だけ）
        <select value={p.storeId ?? ""} onChange={(e) => save({ storeId: e.target.value || null })}>
          <option value="">全店</option>{stores.filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label>このページの本人（本人は、レベルに関係なく見られます）
        <select value={p.ownerId ?? ""} onChange={(e) => save({ ownerId: e.target.value || null })}>
          <option value="">なし</option>{staff.filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.name}（{s.employeeCode}）</option>)}
        </select>
      </label>
      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, margin: "10px 0", padding: "8px 12px" }}>
        <legend>ランクで決める（スタッフ画面で、ランクを決めます）</legend>
        <div className="sub">レベルに関係なく、このランクの人も…</div>
        {(["viewRanks", "editRanks"] as const).map((k) => (
          <div key={k} style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", margin: "4px 0" }}>
            <b style={{ minWidth: 72 }}>{k === "viewRanks" ? "見られる" : "書き込める"}</b>
            {RANKS.map(([v, t]) => (
              <label key={v} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                <input type="checkbox" style={{ width: 20, height: 20 }} checked={p[k].includes(v)} onChange={(e) => save({ [k]: e.target.checked ? [...p[k], v] : p[k].filter((x) => x !== v) })} />{t}
              </label>
            ))}
          </div>
        ))}
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: 20, height: 20 }} checked={p.evaluatorsEdit} onChange={(e) => save({ evaluatorsEdit: e.target.checked })} />
          「評価をつけられる人」（スタイリスト、または管理者が名前で指定した人）も書き込める
        </label>
      </fieldset>
      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, margin: "10px 0", padding: "8px 12px" }}>
        <legend>名前で決める（個別に追加）</legend>
        <ul className="list">
          {(p.grants ?? []).map((g) => (
            <li key={g.membershipId}><span>{g.name}　<span className="chip">{g.canEdit ? "見られる＋書き込める" : "見られる"}</span></span>
              <span className="actions">
                <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => run(() => api(`/api/manual/${p.id}`, { action: "grant", membershipId: g.membershipId, mode: g.canEdit ? "view" : "edit" }))}>{g.canEdit ? "書き込みを外す" : "書き込みも許す"}</button>
                <button className="ghost" onClick={() => run(() => api(`/api/manual/${p.id}`, { action: "grant", membershipId: g.membershipId, mode: "remove" }))}>外す</button>
              </span></li>
          ))}
        </ul>
        <select value="" onChange={(e) => e.target.value && run(() => api(`/api/manual/${p.id}`, { action: "grant", membershipId: e.target.value, mode: "view" }))}>
          <option value="">＋ 名前を選んで追加（見られる）</option>
          {staff.filter((s) => s.status === "active" && !(p.grants ?? []).some((g) => g.membershipId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}（{s.employeeCode}）</option>)}
        </select>
      </fieldset>
      <div className="actions">
        <button className="ghost" style={{ color: "var(--blue)" }} onClick={() => confirm(`このページと、その下のページ全部に、同じ「見られる人・書き込める人・お店・評価者」の設定をします。よろしいですか？`) &&
          run(async () => { const r = await api<{ count: number }>(`/api/manual/${p.id}`, { action: "settingsDeep", minLevel: p.minLevel, editLevel: p.editLevel, evaluatorsEdit: p.evaluatorsEdit, storeId: p.storeId, viewRanks: p.viewRanks, editRanks: p.editRanks }); setMsg(`${r.count}ページに設定しました`); })}>
          下のページ全部にも、同じ設定をする
        </button>
        <button className="ghost" onClick={() => confirm(`「${p.title}」と、その下のページを削除しますか？（元に戻せません）`) && run(async () => { await api(`/api/manual/${p.id}`, { action: "delete" }); router.push("/manual"); })}>このページを削除</button>
      </div>
      {msg && <p className="sub">{msg}</p>}
    </details>
  );
}

function Page() {
  const { me } = useMe();
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<ManualPage | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { try { setP(await api<ManualPage>(`/api/manual/${id}`)); setErr(""); } catch (e) { setErr((e as Error).message); } }, [id]);
  useEffect(() => { load(); }, [load]);
  // 書き込み中に画面が入れ替わらないよう、自動の更新は、書き込める人には行わない
  useAutoRefresh(() => { if (p && !p.canEdit) load(); }, 60);
  if (err) return <main><Link href="/manual" className="back">← マニュアル</Link><p className="err">{err}</p></main>;
  if (!p) return null;
  return (
    <main style={{ maxWidth: 900 }}>
      <Link href="/manual" className="back">← マニュアル</Link>
      <p className="mn-crumbs">{p.trail.map((t) => <span key={t.id}><Link href={`/manual/${t.id}`}>{t.title}</Link> ／ </span>)}</p>
      <h1>{p.icon} {p.title}</h1>
      {/ATENA/.test(p.title) && <Link href="/meetings" className="card" style={{ display: "block", textDecoration: "none", color: "var(--ink)", margin: "8px 0 12px" }}><b>🎙 ミーティング（議事録）</b><br /><span className="sub">会議のボイスメモ → 文字起こし・議事録・要約・マインドマップ・AI会議</span></Link>}
      {p.canEdit && !me.displayOnly && hasEditable(p.body) && <p className="hint" style={{ marginTop: -12 }}>このページには書き込めます（チェックや表のマスは、そのまま入力できます。自動で保存されます）。</p>}
      <BlockView blocks={p.body} ctx={{ refs: p.refs, canEdit: p.canEdit, onEdit: async (edit) => { await api(`/api/manual/${p.id}`, { action: "edit", edit }); } }} />
      {p.children.length > 0 && (
        <>
          <h2>このページの中</h2>
          <ul className="list">{p.children.map((c) => <li key={c.id}><Link href={`/manual/${c.id}`}><b>{c.icon || "📄"} {c.title}</b></Link></li>)}</ul>
        </>
      )}
      {p.log.length > 0 && (
        <details style={{ marginTop: 24 }}><summary className="sub" style={{ cursor: "pointer" }}>書き込みの記録（新しい順）</summary>
          <ul className="list">{p.log.map((l, i) => <li key={i}><span className="sub">{l.at}　{l.by ?? ""}</span><span>{l.summary}</span></li>)}</ul>
        </details>
      )}
      {me.level >= 4 && <Settings p={p} reload={load} />}
    </main>
  );
}
export default function ManualPageView() { return <MeProvider><Page /></MeProvider>; }

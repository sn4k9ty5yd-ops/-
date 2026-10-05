/** マインドマップの並べ方（左から右へ広がる木）。画面に描くための位置を計算する */
import type { MindNode } from "./meeting-prompts";

export interface LaidNode { x: number; y: number; w: number; h: number; title: string; depth: number; branch: number }
export interface LaidEdge { from: LaidNode; to: LaidNode }

const charW = (s: string) => [...s].reduce((t, c) => t + (/[　-鿿＀-￯]/.test(c) ? 15 : 8.5), 0);
const H = 34, ROW = 46, GAP = 56;

export function layoutMindmap(root: MindNode): { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number } {
  const nodes: LaidNode[] = []; const edges: LaidEdge[] = [];
  // 深さごとの列の幅（その列でいちばん長い題名にあわせる）
  const colW: number[] = [];
  const measure = (n: MindNode, d: number) => { colW[d] = Math.max(colW[d] ?? 0, Math.min(240, charW(n.title) + 28)); n.children.forEach((c) => measure(c, d + 1)); };
  measure(root, 0);
  const colX: number[] = []; let x = 12;
  colW.forEach((w, d) => { colX[d] = x; x += w + GAP; });
  let leaf = 0;
  const place = (n: MindNode, d: number, branch: number): LaidNode => {
    const kids = n.children.map((c, i) => place(c, d + 1, d === 0 ? i : branch));
    const y = kids.length ? (kids[0].y + kids[kids.length - 1].y) / 2 : 12 + H / 2 + leaf++ * ROW;
    const node: LaidNode = { x: colX[d], y, w: colW[d], h: H, title: n.title, depth: d, branch };
    nodes.push(node); kids.forEach((k) => edges.push({ from: node, to: k }));
    return node;
  };
  place(root, 0, 0);
  return { nodes, edges, width: x - GAP + 12, height: 24 + Math.max(1, leaf) * ROW };
}

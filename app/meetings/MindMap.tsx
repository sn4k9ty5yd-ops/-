"use client";
import { useRef } from "react";
import { layoutMindmap } from "@/lib/mindmap-layout";
import type { MindNode } from "@/lib/meeting-prompts";

const hue = (b: number) => (b * 53 + 210) % 360;
/** 長い題名は、2行にわける */
const split = (s: string, w: number): string[] => { const per = Math.max(6, Math.floor((w - 20) / 15)); return s.length <= per ? [s] : [s.slice(0, per), s.slice(per, per * 2)]; };

export function MindMap({ tree, name = "マインドマップ" }: { tree: MindNode; name?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const { nodes, edges, width, height } = layoutMindmap(tree);
  const savePng = () => {
    const svg = ref.current; if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const k = 2; const c = document.createElement("canvas"); c.width = width * k; c.height = height * k;
      const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${name}.png`; a.click(); URL.revokeObjectURL(a.href); });
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  };
  return (
    <div>
      <div className="noprint toolbar"><button className="ghost" onClick={savePng}>画像（PNG）で保存</button><button className="ghost" onClick={() => window.print()}>印刷</button></div>
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 14, border: "1px solid var(--line, #e5e5e5)" }}>
        <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", minWidth: Math.min(width, 900) }} fontFamily="sans-serif">
          {edges.map((e, i) => {
            const x1 = e.from.x + e.from.w, y1 = e.from.y, x2 = e.to.x, y2 = e.to.y, mx = (x1 + x2) / 2;
            return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={`hsl(${hue(e.to.branch)} 55% 60%)`} strokeWidth={e.to.depth === 1 ? 3 : 2} />;
          })}
          {nodes.map((n, i) => {
            const lines = split(n.title, n.w);
            const fill = n.depth === 0 ? "#3b3b98" : `hsl(${hue(n.branch)} ${n.depth === 1 ? 70 : 80}% ${n.depth === 1 ? 52 : 92}%)`;
            const color = n.depth <= 1 ? "#fff" : "#222";
            return (
              <g key={i}>
                <rect x={n.x} y={n.y - n.h / 2} width={n.w} height={n.h} rx={n.h / 2} fill={fill} stroke={n.depth === 2 ? `hsl(${hue(n.branch)} 55% 60%)` : "none"} />
                {lines.map((t, j) => <text key={j} x={n.x + n.w / 2} y={n.y + (lines.length === 1 ? 5 : j === 0 ? -2 : 12)} textAnchor="middle" fontSize={lines.length === 1 ? 14 : 12} fill={color} fontWeight={n.depth === 0 ? 700 : 500}>{t}</text>)}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

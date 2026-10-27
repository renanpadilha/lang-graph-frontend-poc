import { useMemo, useState } from "react";
import { Background, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { useTrace, type Call, type LogTag, type RunStatus, type Step, type Topology } from "./store";

type NodeStatus = "pending" | "running" | "done" | "paused" | "failed";
type GData = { id: string; kind?: string; status: NodeStatus; ms?: number; retries?: string; selected: boolean };

// Paleta do depurador: fundo neutro escuro, cor só onde há significado.
const C = {
  green: "#7FD1A6", greenBg: "#1F3328", greenLine: "#3F6B54",
  amber: "#FFB300", amberSoft: "#FFD27A", amberBg: "#4A3410",
  red: "#FF8A80", redBg: "#4A1F1F",
  blue: "#8CC8FF", violet: "#C4B5FD",
  mute: "#A1A1AA", line: "#2E2E35", dim: "#4A4A52",
};
const TAG: Record<LogTag, string> = {
  NODE: C.blue, LLM: C.violet, UCP: C.amberSoft, EDGE: C.green, PAUSA: C.amber, ERRO: C.red,
};
const BADGE: Record<RunStatus, { label: string; fg: string; bg: string }> = {
  idle: { label: "OCIOSO", fg: C.mute, bg: "#2A2A30" },
  running: { label: "RODANDO", fg: C.blue, bg: "#1B2A3A" },
  paused: { label: "PAUSADO", fg: C.amberSoft, bg: C.amberBg },
  finished: { label: "FINALIZADO", fg: C.green, bg: C.greenBg },
  failed: { label: "FALHOU", fg: C.red, bg: C.redBg },
};
const NODE_STYLE: Record<NodeStatus, { bg: string; border: string; icon: string; color: string }> = {
  pending: { bg: "transparent", border: `1px solid ${C.dim}`, icon: "○", color: C.mute },
  running: { bg: "#1B2A3A", border: `1px solid ${C.blue}`, icon: "▶", color: C.blue },
  done: { bg: C.greenBg, border: `1px solid ${C.greenLine}`, icon: "✓", color: C.green },
  paused: { bg: C.amberBg, border: `2px solid ${C.amber}`, icon: "❚❚", color: C.amberSoft },
  failed: { bg: C.redBg, border: `1px solid ${C.red}`, icon: "✕", color: C.red },
};

const fmtMs = (ms?: number) => (ms === undefined ? "" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtTime = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour12: false }) + "." + String(t % 1000).padStart(3, "0").slice(0, 1);

function GraphNode({ data }: NodeProps<Node<GData>>) {
  const st = NODE_STYLE[data.status];
  return (
    <div
      className={`font-mono text-[13px] rounded-[10px] px-3 py-2 flex items-center gap-2 ${data.status === "running" ? "animate-pulse" : ""}`}
      style={{
        width: 168, background: st.bg, border: st.border, color: data.status === "pending" ? C.mute : "#fff",
        borderStyle: data.id === "errorHandler" && data.status === "pending" ? "dashed" : undefined,
        outline: data.selected ? "2px solid #fff" : undefined, outlineOffset: 2,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: st.color }} />
      <span style={{ color: st.color }}>{st.icon}</span>
      <span className="flex-1 font-bold truncate">{data.id}</span>
      <span className="text-[11px]" style={{ color: data.status === "paused" ? C.amberSoft : C.mute }}>
        {data.status === "paused" ? "PAUSADO" : data.retries ? `retries ${data.retries}` : fmtMs(data.ms) || (data.kind === "llm" ? "LLM" : "")}
      </span>
      <Handle type="source" position={Position.Bottom} style={{ background: st.color }} />
    </div>
  );
}
const nodeTypes = { g: GraphNode };

function layout(t: Topology) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 46 });
  const ids = new Set(["START", "END", ...t.nodes.map((n) => n.id)]);
  ids.forEach((id) => g.setNode(id, { width: 168, height: 40 }));
  t.edges.forEach((e) => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  ids.forEach((id) => { const n = g.node(id); pos[id] = { x: n.x - 84, y: n.y - 20 }; });
  return pos;
}

function nodeStatus(id: string, steps: Step[], paused?: string): NodeStatus {
  if (paused === id) return "paused";
  const s = steps.findLast((x) => x.node === id);
  return s ? (s.status === "running" ? "running" : s.status === "failed" ? "failed" : "done") : "pending";
}

function GraphView() {
  const { topology, steps, edgeLabels, status, paused, selected, state, select } = useTrace();
  const pos = useMemo(() => layout(topology), [topology]);

  const seq = ["START", ...steps.map((s) => s.node), ...(status === "finished" ? ["END"] : [])];
  const walked = new Set(seq.slice(1).map((n, i) => `${seq[i]}>${n}`));
  const retries = (state as any)?.retries;

  const nodes: Node<GData>[] = [
    ...(["START", "END"] as const).map((id) => ({
      id, type: "g", position: pos[id], draggable: false,
      data: { id, status: (id === "START" || status === "finished" ? "done" : "pending") as NodeStatus, selected: false },
    })),
    ...topology.nodes.map((n) => {
      const last = steps.findLast((s) => s.node === n.id);
      return {
        id: n.id, type: "g", position: pos[n.id], draggable: false,
        data: {
          id: n.id, kind: n.kind, status: nodeStatus(n.id, steps, paused), ms: last?.durationMs,
          retries: n.id === "errorHandler" && last && retries !== undefined ? `${retries}/2` : undefined,
          selected: selected === n.id,
        },
      };
    }),
  ];
  const edges: Edge[] = topology.edges.map((e) => {
    const on = walked.has(`${e.from}>${e.to}`);
    const color = on ? C.green : C.dim;
    return {
      id: `${e.from}>${e.to}`, source: e.from, target: e.to, label: edgeLabels[`${e.from}>${e.to}`] ?? e.label,
      animated: on,
      style: { stroke: paused === e.to && !on ? C.amber : color, strokeWidth: on ? 2.5 : 1.2, strokeDasharray: e.conditional ? "5 4" : undefined },
      labelStyle: { fill: on ? C.green : C.mute, fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
      labelBgStyle: { fill: "#17171A" },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });

  return (
    <div className="h-[340px] rounded-xl overflow-hidden" style={{ background: "#101013", border: `1px solid ${C.line}` }}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView nodesConnectable={false}
        onNodeClick={(_, n) => select(n.id)} onPaneClick={() => select(undefined)}
      >
        <Background color="#26262C" />
      </ReactFlow>
    </div>
  );
}

const short = (v: unknown) => {
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? "—";
  return s.length > 38 ? s.slice(0, 18) + "…" + s.slice(-14) : s;
};

// Estado do nó escolhido; se nada escolhido e a execução pausou, o estado ao pausar.
function StateCard() {
  const { steps, selected, paused, state } = useTrace();
  const node = selected ?? paused;
  const step = node ? steps.findLast((s) => s.node === node) : undefined;
  const shown = (step?.after ?? state) as Record<string, unknown> | undefined;
  if (!shown || typeof shown !== "object") return null;
  const isPause = !selected && paused;
  const accent = isPause ? C.amber : C.line;
  return (
    <div className="rounded-xl px-3 py-2.5 font-mono" style={{ background: "#1F1F24", border: `1px solid ${accent}` }}>
      <div className="text-xs font-bold mb-1.5" style={{ color: isPause ? C.amberSoft : "#fff" }}>
        {node ? `${node} · ${isPause ? "estado ao pausar" : "estado ao fim do nó"}` : "estado atual"}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {Object.entries(shown).map(([k, v]) => (
          <div key={k} className="contents"><span style={{ color: C.mute }}>{k}</span><span className="break-all">{short(v)}</span></div>
        ))}
      </div>
    </div>
  );
}

function Json({ v }: { v: unknown }) {
  return <pre className="text-xs font-mono whitespace-pre-wrap break-all">{v === undefined ? "—" : JSON.stringify(v, null, 2)}</pre>;
}

function diff(a: any, b: any) {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out[k] = b?.[k];
  }
  return out;
}

function Timeline() {
  const log = useTrace((s) => s.log);
  if (!log.length) return <Empty />;
  return (
    <div className="flex flex-col gap-3 font-mono text-xs leading-relaxed">
      {log.map((l, i) => (
        <div key={i} className="flex gap-2.5">
          <span className="shrink-0 w-[68px]" style={{ color: C.mute }}>{fmtTime(l.t)}</span>
          <div className="min-w-0">
            <span className="font-bold" style={{ color: TAG[l.tag] }}>{l.tag}</span> {l.title}
            {l.sub && <div style={{ color: C.mute }}>{l.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return <p className="text-xs" style={{ color: C.mute }}>Nada ainda. Envie uma mensagem no chat para ver a execução aqui.</p>;
}

function StateTab() {
  const { steps, selected, state } = useTrace();
  const step = steps.findLast((s) => s.node === selected);
  if (!selected) return <Json v={state} />;
  if (!step) return <p className="text-xs" style={{ color: C.mute }}>{selected} ainda não executou.</p>;
  const after = step.after ?? state;
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold" style={{ color: C.blue }}>{selected}: o que mudou</div>
      <Json v={diff(step.before, after)} />
      <div className="text-xs font-bold" style={{ color: C.blue }}>estado completo</div>
      <Json v={after} />
    </div>
  );
}

function CallRow({ c }: { c: Call }) {
  const color = c.kind === "ucp" ? C.amberSoft : C.violet;
  return (
    <div className="font-mono text-xs py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
      <span className="font-bold" style={{ color }}>{c.kind.toUpperCase()}</span> {c.name}
      {c.node && <span style={{ color: C.mute }}> · {c.node}</span>}
      {c.durationMs !== undefined && <span style={{ color: C.mute }}> · {fmtMs(c.durationMs)}</span>}
      {c.kind === "llm" && c.fallback && <span style={{ color: C.amber }}> · fallback</span>}
      {c.fake && <span className="ml-2 rounded px-1.5 py-0.5 text-[10px]" style={{ background: C.amberBg, color: C.amberSoft }}>dados fictícios</span>}
      {c.payload !== undefined && <div className="mt-1"><Json v={c.payload} /></div>}
    </div>
  );
}

function Calls({ kind }: { kind: "ucp" | "llm" }) {
  const calls = useTrace((s) => s.calls).filter((c) => c.kind === kind);
  return calls.length ? <div>{calls.map((c, i) => <CallRow key={i} c={c} />)}</div> : <Empty />;
}

const TABS = {
  "Linha do tempo": Timeline,
  Estado: StateTab,
  UCP: () => <Calls kind="ucp" />,
  LLM: () => <Calls kind="llm" />,
} as const;

export function DebugPanel() {
  const { status, collapsed, toggle, state, steps, calls, log, threadId, paused, topology } = useTrace();
  const [tab, setTab] = useState<keyof typeof TABS>("Linha do tempo");
  const Body = TABS[tab];
  const badge = BADGE[status];

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ threadId, steps, calls, log, state }, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "trace.json" }).click();
    URL.revokeObjectURL(url);
  };
  const action = "min-h-11 px-3.5 rounded-[10px] text-[13px] cursor-pointer";

  const railNodes = topology.nodes.filter((n) => n.id !== "errorHandler");
  const dot: Record<NodeStatus, string> = { pending: "transparent", running: C.blue, done: "#5f7a68", paused: "#a07a2c", failed: "#9a4a43" };

  return (
    <aside
      aria-label="Depuração do LangGraph"
      className={`flex flex-col overflow-hidden md:w-[460px] ${collapsed ? "h-14 md:h-auto md:w-14 bg-[#17171A] text-[#F2F2F4] md:bg-transparent md:text-ink md:border-l md:border-line" : "h-[70vh] md:h-auto bg-[#17171A] text-[#F2F2F4]"}
        max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:rounded-t-2xl max-md:z-10`}
    >
      {collapsed && (
        <button
          onClick={toggle} aria-label="Expandir depuração"
          className="hidden md:flex flex-1 flex-col items-center gap-3.5 py-[22px] text-[10px] text-mute cursor-pointer"
        >
          <span className="[writing-mode:vertical-rl] rotate-180 tracking-[.14em] uppercase">Depurador</span>
          {railNodes.map((n) => {
            const st = nodeStatus(n.id, steps, paused);
            return (
              <i key={n.id} title={n.id} className={`size-[7px] rounded-full border ${st === "paused" || st === "running" ? "pulse-dot" : ""}`}
                style={{ background: dot[st], borderColor: st === "pending" ? "#8a867e" : dot[st] }} />
            );
          })}
        </button>
      )}
      <div className={`px-5 py-3.5 flex flex-col gap-2 ${collapsed ? "md:hidden" : ""}`} style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-2">
          <span className="font-medium">Depuração · LangGraph</span>
          <span className="flex items-center gap-1.5 rounded-xl px-2.5 py-0.5 text-xs font-medium" style={{ background: badge.bg, color: badge.fg }}>
            <span className="size-2 rounded-full" style={{ background: badge.fg }} />{badge.label}
          </span>
          <span className="flex-1" />
          <button className="text-xs underline min-h-11 px-1 cursor-pointer" onClick={toggle}>{collapsed ? "expandir" : "recolher"}</button>
        </div>
        {!collapsed && (
          <div className="font-mono text-xs flex flex-col gap-0.5" style={{ color: C.mute }}>
            <span>thread  {threadId ?? "—"}</span>
            <span>{paused ? `próximo nó: ${paused}` : "sem execução pausada"}</span>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-5 py-4 flex flex-col gap-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.mute }}>Grafo · você está aqui</span>
              <span className="font-mono text-[11px]" style={{ color: C.mute }}>clique num nó para ver o estado</span>
            </div>
            <GraphView />
            <StateCard />
          </div>

          <div role="tablist" className="flex px-3 sticky top-0 z-[1]" style={{ borderBottom: `1px solid ${C.line}`, background: "#17171A" }}>
            {(Object.keys(TABS) as (keyof typeof TABS)[]).map((t) => (
              <button
                key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className="min-h-11 px-3 text-sm cursor-pointer"
                style={{ borderBottom: `2px solid ${tab === t ? C.blue : "transparent"}`, color: tab === t ? "#fff" : C.mute, fontWeight: tab === t ? 700 : 400 }}
              >{t}</button>
            ))}
          </div>
          <div className="px-5 py-4"><Body /></div>
        </div>
      )}

      {!collapsed && (
        <div className="px-5 py-3 flex flex-wrap gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
          <button className={action} style={{ border: `1px solid ${C.dim}` }} onClick={() => navigator.clipboard.writeText(JSON.stringify(state, null, 2)).catch(() => {})}>Copiar estado (JSON)</button>
          <button className={action} style={{ border: `1px solid ${C.dim}` }} onClick={download}>Baixar trace</button>
        </div>
      )}
    </aside>
  );
}

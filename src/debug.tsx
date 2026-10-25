import { useMemo, useState } from "react";
import { Background, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { useTrace, type Call, type RunStatus, type Step, type Topology } from "./store";

type NodeStatus = "pending" | "running" | "done" | "paused" | "failed";
type GData = { id: string; kind?: string; status: NodeStatus; ms?: number; retries?: string; selected: boolean };

const COLORS: Record<NodeStatus, string> = {
  pending: "#71717a", running: "#ffffff", done: "#16a34a", paused: "#d97706", failed: "#dc2626",
};
const LABEL: Record<RunStatus, string> = {
  idle: "OCIOSO", running: "RODANDO", paused: "PAUSADO", finished: "FINALIZADO", failed: "FALHOU",
};

function GraphNode({ data }: NodeProps<Node<GData>>) {
  const edge = { background: COLORS[data.status] };
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs font-mono bg-zinc-900 text-white ${data.status === "running" ? "animate-pulse" : ""} ${data.selected ? "ring-2 ring-white" : ""}`}
      style={{ borderColor: COLORS[data.status], opacity: data.status === "pending" ? 0.6 : 1 }}
    >
      <Handle type="target" position={Position.Top} style={edge} />
      <div className="font-bold">{data.id}</div>
      {data.kind && <div className="opacity-70">{data.kind === "llm" ? "LLM" : "puro"}{data.ms !== undefined && ` · ${data.ms}ms`}</div>}
      {data.status === "paused" && <div style={{ color: COLORS.paused }}>pausado</div>}
      {data.retries && <div>retries {data.retries}</div>}
      <Handle type="source" position={Position.Bottom} style={edge} />
    </div>
  );
}
const nodeTypes = { g: GraphNode };

function layout(t: Topology) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 50 });
  const ids = new Set(["START", "END", ...t.nodes.map((n) => n.id)]);
  ids.forEach((id) => g.setNode(id, { width: 130, height: 54 }));
  t.edges.forEach((e) => g.setEdge(e.from, e.to));
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  ids.forEach((id) => { const n = g.node(id); pos[id] = { x: n.x - 65, y: n.y - 27 }; });
  return pos;
}

function nodeStatus(id: string, steps: Step[], paused?: string): NodeStatus {
  if (paused === id) return "paused";
  const s = steps.findLast((x) => x.node === id);
  return s ? s.status === "running" ? "running" : s.status === "failed" ? "failed" : "done" : "pending";
}

function GraphView() {
  const { topology, steps, edgeLabels, status, paused, selected, state, select } = useTrace();
  const pos = useMemo(() => layout(topology), [topology]);

  const seq = ["START", ...steps.map((s) => s.node), ...(status === "finished" ? ["END"] : [])];
  const walked = new Set(seq.slice(1).map((n, i) => `${seq[i]}>${n}`));
  const retries = (state as any)?.retries;

  const nodes: Node<GData>[] = [
    ...["START", "END"].map((id) => ({
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
    const label = edgeLabels[`${e.from}>${e.to}`] ?? e.label;
    return {
      id: `${e.from}>${e.to}`, source: e.from, target: e.to, label,
      animated: on, style: { stroke: on ? "#fff" : "#52525b", strokeWidth: on ? 2.5 : 1, strokeDasharray: e.conditional ? "5 4" : undefined },
      labelStyle: { fill: on ? "#fff" : "#71717a", fontSize: 10 },
      labelBgStyle: { fill: "#18181b" },
      markerEnd: { type: MarkerType.ArrowClosed, color: on ? "#fff" : "#52525b" },
    };
  });

  return (
    <div className="h-72 md:h-1/2 shrink-0 rounded-lg overflow-hidden bg-zinc-950">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView nodesConnectable={false}
        onNodeClick={(_, n) => select(n.id)} onPaneClick={() => select(undefined)}
      >
        <Background color="#27272a" />
      </ReactFlow>
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
  const { steps, select } = useTrace();
  return (
    <ol className="text-xs font-mono space-y-1">
      {steps.map((s, i) => (
        <li key={i} className="cursor-pointer hover:underline" onClick={() => select(s.node)}>
          {i + 1}. {s.node} — {s.status}{s.durationMs !== undefined && ` · ${s.durationMs}ms`}
        </li>
      ))}
    </ol>
  );
}

function StateInspector() {
  const { steps, selected, state } = useTrace();
  const step = steps.findLast((s) => s.node === selected);
  const calls = useTrace((s) => s.calls).filter((c) => c.node === selected);
  if (!selected) return <Json v={state} />;
  if (!step) return <p className="text-xs">{selected}: ainda não executou.</p>;
  const after = step.after ?? state;
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold">{selected}</div>
      <div className="text-xs opacity-70">Mudou neste nó</div>
      <Json v={diff(step.before, after)} />
      <div className="text-xs opacity-70">Estado completo</div>
      <Json v={after} />
      {calls.length > 0 && <div className="text-xs opacity-70">Chamadas</div>}
      {calls.map((c, i) => <CallRow key={i} c={c} />)}
    </div>
  );
}

function CallRow({ c }: { c: Call }) {
  return (
    <div className="text-xs font-mono border-b border-zinc-700 py-1">
      <span className="font-bold">{c.kind.toUpperCase()}</span> {c.name}
      {c.durationMs !== undefined && ` · ${c.durationMs}ms`}
      {c.kind === "llm" && c.fallback && " · fallback"}
      {c.fake && <span className="ml-1 text-amber-500">dados fictícios</span>}
      {c.payload !== undefined && <Json v={c.payload} />}
    </div>
  );
}

function Raw() {
  const calls = useTrace((s) => s.calls);
  return <div>{calls.map((c, i) => <CallRow key={i} c={c} />)}</div>;
}

const TABS = { Timeline, Estado: StateInspector, Raw } as const;

export function DebugPanel() {
  const { status, collapsed, toggle, state, steps, calls } = useTrace();
  const [tab, setTab] = useState<keyof typeof TABS>("Timeline");
  const Body = TABS[tab];

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ steps, calls, state }, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "trace.json" }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className={`text-white bg-zinc-900 rounded-2xl shadow-lg flex flex-col min-h-0 p-3 gap-2
      md:w-[440px] md:h-auto ${collapsed ? "h-12 overflow-hidden" : "h-[55vh]"} max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:rounded-b-none max-md:z-10`}>
      <div className="flex items-center gap-2">
        <span className="font-bold">Depuração</span>
        <span className="text-[10px] font-mono rounded bg-zinc-700 px-2 py-0.5">{LABEL[status]}</span>
        <span className="flex-1" />
        <button className="btn-ghost text-xs" onClick={() => navigator.clipboard.writeText(JSON.stringify(state, null, 2))}>copiar estado</button>
        <button className="btn-ghost text-xs" onClick={download}>baixar trace</button>
        <button className="btn-ghost text-xs" onClick={toggle}>{collapsed ? "expandir" : "recolher"}</button>
      </div>
      {!collapsed && (
        <>
          <GraphView />
          <div className="flex gap-3 text-sm">
            {(Object.keys(TABS) as (keyof typeof TABS)[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={tab === t ? "font-bold underline" : "opacity-60"}>{t}</button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto"><Body /></div>
        </>
      )}
    </aside>
  );
}

import { create } from "zustand";
import { applyPatch } from "fast-json-patch";

// Primeira loja; outras entram no futuro.
export const STORE_NAME = "renanpadilha";

export const API = import.meta.env.VITE_API_URL ?? "";

export type Topology = {
  nodes: { id: string; kind: "llm" | "deterministic" }[];
  edges: { from: string; to: string; label?: string; conditional?: boolean }[];
  interruptBefore: string[];
};
export type Step = {
  node: string;
  startedAt: number;
  durationMs?: number;
  status: "running" | "done" | "failed";
  before: unknown;
  after?: unknown;
};
export type Call = {
  kind: "ucp" | "llm";
  node?: string;
  name: string;
  durationMs?: number;
  fallback?: boolean;
  fake?: boolean;
  payload?: unknown;
};
export type RunStatus = "idle" | "running" | "paused" | "finished" | "failed";

// Usada se GET /api/graph ainda nao responder.
const FALLBACK: Topology = {
  nodes: [
    { id: "discovery", kind: "llm" },
    { id: "select", kind: "llm" },
    { id: "order", kind: "deterministic" },
    { id: "checkout", kind: "deterministic" },
    { id: "payment", kind: "deterministic" },
    { id: "fulfillment", kind: "deterministic" },
    { id: "errorHandler", kind: "deterministic" },
  ],
  edges: [
    { from: "START", to: "discovery" },
    { from: "discovery", to: "select", label: "ok", conditional: true },
    { from: "discovery", to: "errorHandler", label: "fail", conditional: true },
    { from: "select", to: "order" },
    { from: "order", to: "checkout" },
    { from: "checkout", to: "payment" },
    { from: "payment", to: "fulfillment" },
    { from: "fulfillment", to: "END" },
    { from: "errorHandler", to: "discovery", label: "retry", conditional: true },
    { from: "errorHandler", to: "END", label: "giveUp", conditional: true },
  ],
  interruptBefore: ["payment"],
};

type Trace = {
  topology: Topology;
  steps: Step[];
  calls: Call[];
  edgeLabels: Record<string, string>;
  state: unknown;
  status: RunStatus;
  paused?: string;
  selected?: string;
  collapsed: boolean;
  loadGraph: () => Promise<void>;
  select: (node?: string) => void;
  toggle: () => void;
  event: (e: any) => void;
};

const COLLAPSE_KEY = "debug-collapsed";
const initialCollapsed = (() => {
  try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
})();

const clean = {
  steps: [] as Step[], calls: [] as Call[], edgeLabels: {} as Record<string, string>,
  state: undefined as unknown, paused: undefined as string | undefined,
};

export const useTrace = create<Trace>((set, get) => ({
  topology: FALLBACK,
  ...clean,
  status: "idle",
  collapsed: initialCollapsed,

  loadGraph: async () => {
    try {
      const r = await fetch(`${API}/api/graph`);
      if (r.ok) set({ topology: await r.json() });
    } catch { /* mantem topologia de reserva */ }
  },
  select: (selected) => set({ selected }),
  toggle: () => {
    const collapsed = !get().collapsed;
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch {}
    set({ collapsed });
  },

  event: (e) => {
    const s = get();
    switch (e.type) {
      case "RUN_STARTED":
        // Retomada apos aprovacao continua a mesma trilha; nova mensagem comeca limpa.
        set(s.paused ? { status: "running", paused: undefined } : { ...clean, status: "running" });
        break;
      case "RUN_ERROR":
        set({ status: "failed" });
        break;
      case "RUN_FINISHED": {
        const last = [...s.steps].reverse().find((x) => x.status === "done");
        const paused = s.topology.interruptBefore.find(
          (id) => !s.steps.some((x) => x.node === id) && s.topology.edges.some((ed) => ed.from === last?.node && ed.to === id),
        );
        set({ status: paused ? "paused" : "finished", paused });
        break;
      }
      case "STEP_STARTED":
        set({ steps: [...s.steps, { node: e.stepName, startedAt: Date.now(), status: "running", before: s.state }] });
        break;
      case "STEP_FINISHED": {
        const steps = [...s.steps];
        const i = steps.findLastIndex((x) => x.node === e.stepName && x.status === "running");
        if (i >= 0) {
          const st = steps[i];
          steps[i] = { ...st, status: "done", durationMs: Date.now() - st.startedAt, after: s.state };
        }
        set({ steps });
        break;
      }
      case "STATE_SNAPSHOT":
        set({ state: e.snapshot });
        break;
      case "STATE_DELTA":
        try { set({ state: applyPatch(structuredClone(s.state ?? {}), e.delta).newDocument }); } catch {}
        break;
      case "CUSTOM": {
        const v = e.value ?? {};
        if (e.name === "edge") set({ edgeLabels: { ...s.edgeLabels, [`${v.from}>${v.to}`]: v.label } });
        else if (e.name === "ucp_call" || e.name === "llm_call") {
          set({ calls: [...s.calls, { kind: e.name === "ucp_call" ? "ucp" : "llm", name: v.tool ?? v.model ?? e.name, ...v }] });
        }
        break;
      }
    }
  },
}));

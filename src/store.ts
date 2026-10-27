import { create } from "zustand";
import { applyPatch } from "fast-json-patch";

// Marca do app. O front não conhece catálogo nem regras de nenhuma loja:
// só envia o id da loja ao backend, que resolve o servidor UCP dela.
export const BRAND = "renanpadilha";
export const STORES: Record<string, { label: string }> = {
  "boca-rosa": { label: "Boca Rosa" },
  // nova loja = nova linha aqui + cadastro no backend
};
export const STORE_ID = (() => {
  const wanted = new URLSearchParams(location.search).get("store") ?? import.meta.env.VITE_STORE;
  return wanted && wanted in STORES ? wanted : Object.keys(STORES)[0];
})();
export const storeQuery = `store=${encodeURIComponent(STORE_ID)}`;

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
export type LogTag = "NODE" | "LLM" | "UCP" | "EDGE" | "PAUSA" | "ERRO";
export type LogEntry = { t: number; tag: LogTag; title: string; sub?: string };
export type RunStatus = "idle" | "running" | "paused" | "finished" | "failed";

// Usada se GET /api/graph ainda nao responder.
const FALLBACK: Topology = {
  nodes: [
    { id: "discovery", kind: "llm" },
    { id: "select", kind: "deterministic" },
    { id: "checkout", kind: "deterministic" },
    { id: "payment", kind: "deterministic" },
    { id: "order", kind: "deterministic" },
    { id: "fulfillment", kind: "llm" },
    { id: "errorHandler", kind: "llm" },
  ],
  edges: [
    { from: "START", to: "discovery" },
    { from: "discovery", to: "select", label: "ok", conditional: true },
    { from: "discovery", to: "errorHandler", label: "fail", conditional: true },
    { from: "select", to: "checkout" },
    { from: "checkout", to: "payment", label: "ok", conditional: true },
    { from: "checkout", to: "errorHandler", label: "fail", conditional: true },
    { from: "payment", to: "order" },
    { from: "order", to: "fulfillment" },
    { from: "fulfillment", to: "END" },
    { from: "errorHandler", to: "discovery", label: "retry", conditional: true },
    { from: "errorHandler", to: "END", label: "giveUp", conditional: true },
  ],
  interruptBefore: ["select", "payment"],
};

type Trace = {
  topology: Topology;
  steps: Step[];
  calls: Call[];
  edgeLabels: Record<string, string>;
  state: unknown;
  log: LogEntry[];
  threadId?: string;
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
  log: [] as LogEntry[],
};

export const useTrace = create<Trace>((set, get) => ({
  topology: FALLBACK,
  ...clean,
  status: "idle",
  collapsed: initialCollapsed,

  loadGraph: async () => {
    try {
      const r = await fetch(`${API}/api/graph?${storeQuery}`);
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
    const log = (tag: LogTag, title: string, sub?: string) => [...get().log, { t: Date.now(), tag, title, sub }];
    switch (e.type) {
      case "RUN_STARTED":
        // Retomada apos aprovacao continua a mesma trilha; nova mensagem comeca limpa.
        set(s.paused ? { status: "running", paused: undefined, threadId: e.threadId } : { ...clean, status: "running", threadId: e.threadId });
        break;
      case "RUN_ERROR":
        set({ status: "failed", log: log("ERRO", e.message ?? "falha na execução") });
        break;
      case "RUN_FINISHED": {
        // O backend sinaliza a pausa como outcome=interrupt (reason: interrupt_before:<nó>).
        const it = e.outcome?.type === "interrupt" ? e.outcome.interrupts?.[0] : undefined;
        const paused = it ? String(it.reason ?? "").replace("interrupt_before:", "") : undefined;
        set({
          status: paused ? "paused" : "finished", paused,
          log: paused ? log("PAUSA", `interrupt_before ${paused}`, "aguardando aprovação") : s.log,
        });
        break;
      }
      case "STEP_STARTED":
        set({
          steps: [...s.steps, { node: e.stepName, startedAt: Date.now(), status: "running", before: s.state }],
          log: log("NODE", e.stepName, "iniciou"),
        });
        break;
      case "STEP_FINISHED": {
        const steps = [...s.steps];
        const i = steps.findLastIndex((x) => x.node === e.stepName && x.status === "running");
        if (i >= 0) {
          const st = steps[i];
          steps[i] = { ...st, status: "done", durationMs: Date.now() - st.startedAt };
        }
        set({ steps, log: log("NODE", e.stepName, `finalizou · ${steps[i]?.durationMs ?? "?"} ms`) });
        break;
      }
      case "STATE_SNAPSHOT": {
        // O snapshot do nó chega logo depois do STEP_FINISHED dele: vira o "after" desse passo.
        const steps = [...s.steps];
        const i = steps.findLastIndex((x) => x.status === "done" && x.after === undefined);
        if (i >= 0) steps[i] = { ...steps[i], after: e.snapshot };
        set({ state: e.snapshot, steps });
        break;
      }
      case "STATE_DELTA":
        try { set({ state: applyPatch(structuredClone(s.state ?? {}), e.delta).newDocument }); } catch {}
        break;
      case "CUSTOM": {
        const v = e.value ?? {};
        const ms = v.durationMs !== undefined ? `${v.durationMs} ms` : undefined;
        if (e.name === "edge") {
          set({ edgeLabels: { ...s.edgeLabels, [`${v.from}>${v.to}`]: v.label }, log: log("EDGE", `${v.from} → ${v.to}`, v.label) });
        } else if (e.name === "ucp_call" || e.name === "llm_call") {
          const kind = e.name === "ucp_call" ? "ucp" : "llm";
          const name = v.tool ?? v.model ?? e.name;
          set({
            calls: [...s.calls, { kind, name, ...v }],
            log: log(kind === "ucp" ? "UCP" : "LLM", name, [v.summary, v.fallback && "fallback", ms].filter(Boolean).join(" · ")),
          });
        }
        break;
      }
    }
  },
}));

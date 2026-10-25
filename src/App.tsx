import { useEffect, useMemo } from "react";
import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive,
  makeAssistantToolUI, useAui,
} from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { HttpAgent } from "@ag-ui/client";
import { API, STORE_NAME, useTrace } from "./store";
import { DebugPanel } from "./debug";

type Product = { name: string; price: number | string; image?: string; url?: string };

const ShowProducts = makeAssistantToolUI<{ products?: Product[] }, unknown>({
  toolName: "show_products",
  render: ({ args }) => (
    <div className="grid grid-cols-2 gap-3 my-2">
      {(args.products ?? []).map((p, i) => (
        <div key={i} className="rounded-xl bg-white border border-line overflow-hidden">
          {p.image && <img src={p.image} alt={p.name} className="w-full h-32 object-cover" />}
          <div className="p-2 text-sm">
            <div className="font-medium">{p.name}</div>
            <div className="font-mono">{typeof p.price === "number" ? p.price.toFixed(2) : p.price}</div>
          </div>
        </div>
      ))}
    </div>
  ),
});

const RequestApproval = makeAssistantToolUI<{ summary?: string; total?: number | string }, { approved: boolean }>({
  toolName: "request_approval",
  render: ({ args, result, addResult }) => (
    <div className="rounded-xl bg-white border border-line p-4 my-2">
      <div className="font-serif text-lg">Aprovar pedido</div>
      <p className="text-sm my-1">{args.summary}</p>
      {args.total !== undefined && <p className="font-mono">Total: {args.total}</p>}
      {result ? (
        <p className="text-sm mt-2">{result.approved ? "Aprovado" : "Recusado"}</p>
      ) : (
        <div className="flex gap-2 mt-3">
          <button className="btn" onClick={() => addResult({ approved: true })}>Aprovar</button>
          <button className="btn-ghost" onClick={() => addResult({ approved: false })}>Recusar</button>
        </div>
      )}
    </div>
  ),
});

const SUGGESTIONS = ["quero uma base para pele oleosa", "mostre batons nude", "xyzxyz"];

function Suggestions() {
  const aui = useAui();
  return (
    <div className="flex flex-wrap gap-2 p-3">
      {SUGGESTIONS.map((s) => (
        <button key={s} className="btn-ghost bg-white text-sm" onClick={() => aui.thread().append(s)}>{s}</button>
      ))}
    </div>
  );
}

const STAGES = [["discovery", "Descoberta"], ["select", "Seleção"], ["checkout", "Checkout"], ["payment", "Pagamento"], ["fulfillment", "Entrega"]];

function Stepper() {
  const steps = useTrace((s) => s.steps);
  return (
    <div className="flex gap-1 px-3 py-2 text-xs">
      {STAGES.map(([id, label]) => {
        const done = steps.some((s) => s.node === id && s.status === "done");
        return <span key={id} className={`rounded-full px-2 py-0.5 ${done ? "bg-ink text-white" : "bg-white border border-line"}`}>{label}</span>;
      })}
    </div>
  );
}

function Chat() {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full bg-paper rounded-2xl overflow-hidden shadow-lg">
      <header className="px-4 py-3 text-white bg-gradient-to-r from-zinc-500 to-black font-serif text-xl">{STORE_NAME}</header>
      <Stepper />
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-3">
        <ThreadPrimitive.Empty><Suggestions /></ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages>
          {({ message }) => (
            <MessagePrimitive.Root className={`my-2 flex ${message.role === "user" ? "justify-end" : ""}`}>
              <div className={`max-w-[90%] rounded-2xl px-3 py-2 ${message.role === "user" ? "bg-ink text-white" : "bg-white border border-line"}`}>
                <MessagePrimitive.Parts />
              </div>
            </MessagePrimitive.Root>
          )}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="flex gap-2 p-3 border-t border-line bg-white">
        <ComposerPrimitive.Input placeholder="Pergunte sobre produtos…" className="flex-1 outline-none" />
        <ComposerPrimitive.Send className="btn">Enviar</ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}

export function App() {
  const agent = useMemo(() => new HttpAgent({ url: `${API}/api/agui` }), []);
  const runtime = useAgUiRuntime({ agent });
  const { event, loadGraph } = useTrace.getState();

  useEffect(() => {
    loadGraph();
    const sub = agent.subscribe({ onEvent: ({ event: e }) => { event(e); } });
    return () => sub.unsubscribe();
  }, [agent]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ShowProducts />
      <RequestApproval />
      <div className="h-full flex flex-col md:flex-row gap-4 p-4">
        <main className="flex-1 min-h-0 min-w-0"><Chat /></main>
        <DebugPanel />
      </div>
    </AssistantRuntimeProvider>
  );
}

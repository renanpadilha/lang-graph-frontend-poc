import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive,
  useAui,
} from "@assistant-ui/react";
import { useAgUiInterrupts, useAgUiRuntime, useAgUiSubmitInterruptResponses } from "@assistant-ui/react-ag-ui";
import { HttpAgent } from "@ag-ui/client";
import { API, BRAND, STORES, STORE_ID, storeQuery, useTrace } from "./store";
import { DebugPanel } from "./debug";

type Product = { variantId: string; name: string; price: number | string; image?: string; url?: string; store?: string; quantity?: number };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const priceLabel = (p: Product["price"]) => (typeof p === "number" ? brl.format(p) : p);
const priceValue = (p: Product["price"]) => {
  if (typeof p === "number") return p;
  const n = parseFloat(String(p).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// Vitrine dentro da conversa: marca vários produtos, ajusta quantidades e responde à pausa do grafo
// (interrupt antes de "select") com resume[{interruptId, status, payload:{items}}] na mesma thread.
function ProductPicker({ interruptId, products }: { interruptId: string; products: Product[] }) {
  const submit = useAgUiSubmitInterruptResponses();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [sent, setSent] = useState(false);

  const picked = products.map((p, i) => ({ p, q: qty[i] ?? 0 })).filter((x) => x.q > 0);
  const count = picked.reduce((s, x) => s + x.q, 0);
  const subtotal = picked.reduce((s, x) => s + priceValue(x.p.price) * x.q, 0);

  const change = (i: number, d: number) =>
    setQty((s) => {
      const q = Math.max(0, Math.min(9, (s[i] ?? 0) + d));
      const next = { ...s };
      if (q) next[i] = q; else delete next[i];
      return next;
    });
  const confirm = () => {
    setSent(true);
    void submit([{
      interruptId, status: "resolved",
      payload: { items: picked.map(({ p, q }) => ({ variantId: p.variantId, quantity: q })) },
    }]);
  };
  const cancel = () => {
    setSent(true);
    void submit([{ interruptId, status: "cancelled" }]);
  };

  return (
    <div className="mt-3.5">
      <div className={`grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 ${sent ? "opacity-60 pointer-events-none" : ""}`}>
        {products.map((p, i) => {
          const q = qty[i] ?? 0;
          return (
            <article key={i} className={`rounded-xl bg-white border overflow-hidden flex flex-col transition-colors ${q ? "border-ink" : "border-line"}`}>
              <div className="aspect-[5/4] bg-tint grid place-items-center overflow-hidden">
                {p.image
                  ? <img src={p.image} alt={p.name} className="size-full object-cover" />
                  : <span className="text-3xl font-light text-mute">{p.name?.[0]}</span>}
              </div>
              <div className="px-3.5 pt-3 pb-3.5 flex flex-col gap-0.5 flex-1">
                <h4 className="text-sm font-medium leading-snug">{p.name}</h4>
                {p.store && <p className="text-[12.5px] text-mute">{p.store}</p>}
                <div className="mt-auto pt-3 flex items-center justify-between gap-2 min-h-[40px]">
                  <span className="text-[13.5px] tabular-nums">{priceLabel(p.price)}</span>
                  {q === 0 ? (
                    <button className="chip text-ink" onClick={() => change(i, 1)}>Adicionar</button>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-line">
                      <button className="size-7 text-mute hover:text-ink cursor-pointer" aria-label={`Diminuir ${p.name}`} onClick={() => change(i, -1)}>−</button>
                      <span className="min-w-4 text-center text-[12.5px] tabular-nums">{q}</span>
                      <button className="size-7 text-mute hover:text-ink cursor-pointer" aria-label={`Aumentar ${p.name}`} onClick={() => change(i, 1)}>+</button>
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {sent ? (
        <p className="mt-3 text-[13px] text-mute">Seleção enviada: {count} {count === 1 ? "item" : "itens"}.</p>
      ) : (
        count > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-2.5">
            <span className="text-[13px]">
              {count} {count === 1 ? "item" : "itens"}
              {subtotal > 0 && <span className="text-mute"> · subtotal <span className="tabular-nums text-ink">{brl.format(subtotal)}</span></span>}
            </span>
            <span className="flex gap-2">
              <button className="btn-ghost" onClick={cancel}>Cancelar</button>
              <button className="btn" onClick={confirm}>Continuar com a seleção</button>
            </span>
          </div>
        )
      )}
    </div>
  );
}

// Pausas do grafo (interruptBefore) chegam como RUN_FINISHED(interrupt) com metadata.kind:
// "select" = escolher produtos, "approve" = aprovar o pedido. A resposta volta como
// resume[{interruptId, status, payload}] na mesma thread.
type Meta = { kind?: "select" | "approve"; summary?: string; total?: string; products?: Product[]; items?: Product[] };

function InterruptCards() {
  const interrupts = useAgUiInterrupts();
  const submit = useAgUiSubmitInterruptResponses();
  if (interrupts.length === 0) return null;
  return (
    <>
      {interrupts.map((it) => {
        const meta = (it.metadata ?? {}) as Meta;
        if (meta.kind === "select") {
          return (
            <div key={it.id} className="grid grid-cols-[22px_1fr] gap-3.5">
              <Mark />
              <div className="min-w-0">
                <p className="m-0 text-[13.5px] text-mute">{it.message ?? "Escolha os produtos"}</p>
                <ProductPicker interruptId={it.id} products={meta.products ?? []} />
              </div>
            </div>
          );
        }
        return (
          <div key={it.id} className="grid grid-cols-[22px_1fr] gap-3.5">
            <Mark />
            <div className="rounded-xl bg-white border border-line px-5 py-[18px] grid gap-3 max-w-[460px]">
              <h4 className="m-0 text-[15px] font-medium">Aprovar pedido</h4>
              <p className="m-0 py-3 border-y border-line text-[13.5px] text-mute">{meta.summary ?? it.message}</p>
              {meta.items && (
                <ul className="m-0 p-0 list-none grid gap-1.5 text-[13.5px]">
                  {meta.items.map((p) => (
                    <li key={p.variantId} className="flex justify-between gap-3">
                      <span className="min-w-0">{p.quantity ?? 1}× {p.name}{p.store && <span className="text-mute"> · {p.store}</span>}</span>
                      <span className="tabular-nums shrink-0">{priceLabel(p.price)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {meta.total && (
                <p className="m-0 flex justify-between text-[13.5px] font-medium">
                  <span>Total</span><span className="tabular-nums">{meta.total}</span>
                </p>
              )}
              <div className="flex gap-2">
                <button className="btn" onClick={() => submit([{ interruptId: it.id, status: "resolved" }])}>Aprovar</button>
                <button className="btn-ghost" onClick={() => submit([{ interruptId: it.id, status: "cancelled" }])}>Recusar</button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

const SUGGESTIONS = ["quero uma base para pele oleosa", "mostre batons nude", "xyzxyz"];

function Suggestions() {
  const aui = useAui();
  return (
    <div className="grid gap-4 pt-6">
      <p className="m-0 text-xl font-light tracking-tight">Como posso ajudar?</p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => aui.thread().append(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

const STAGES = [["discovery", "Descoberta"], ["select", "Seleção"], ["checkout", "Checkout"], ["payment", "Pagamento"], ["fulfillment", "Entrega"]];

function Stepper() {
  const steps = useTrace((s) => s.steps);
  const paused = useTrace((s) => s.paused);
  return (
    <ol className="m-0 p-0 list-none grid grid-cols-5 gap-2.5">
      {STAGES.map(([id, label]) => {
        const hold = paused === id;
        const done = !hold && steps.some((s) => s.node === id && s.status === "done");
        return (
          <li key={id} className={`grid gap-[7px] min-w-0 text-[11.5px] max-sm:text-[0] max-sm:gap-0 ${hold ? "text-warn" : done ? "text-ink" : "text-mute"}`}>
            <span className={`h-px ${hold ? "bg-warn" : done ? "bg-ink" : "bg-line"}`} />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function Mark() {
  return <span aria-hidden className="mt-[3px] size-[22px] rounded-full border border-ink grid place-items-center"><span className="size-2 rounded-full bg-ink" /></span>;
}

const column = "w-full max-w-[860px] mx-auto px-10 max-sm:px-4";

function Chat() {
  const paused = useAgUiInterrupts().length > 0;
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full min-w-0 flex-1">
      <header className={`${column} pt-[22px] grid gap-[22px]`}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-medium tracking-[.02em]">{BRAND}</span>
          <small className="text-xs text-mute">{STORES[STORE_ID].label}</small>
        </div>
        <Stepper />
      </header>
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
        <div className={`${column} py-9 grid gap-7 content-start`}>
          <ThreadPrimitive.Empty><Suggestions /></ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === "user" ? (
                <MessagePrimitive.Root className="flex justify-end">
                  <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-tint px-4 py-2.5">
                    <MessagePrimitive.Parts />
                  </div>
                </MessagePrimitive.Root>
              ) : (
                <MessagePrimitive.Root className="grid grid-cols-[22px_minmax(0,1fr)] gap-3.5">
                  <Mark />
                  <div className="min-w-0 max-w-[64ch] [&_p]:my-0"><MessagePrimitive.Parts /></div>
                </MessagePrimitive.Root>
              )
            }
          </ThreadPrimitive.Messages>
          <InterruptCards />
        </div>
      </ThreadPrimitive.Viewport>
      <div className={`${column} pb-7`}>
        <ComposerPrimitive.Root className="flex items-center gap-2 rounded-full border border-line bg-white py-1.5 pl-5 pr-1.5 transition-colors focus-within:border-ink">
          <ComposerPrimitive.Input
            disabled={paused}
            placeholder={paused ? "Responda ao cartão acima para continuar…" : "Pergunte sobre produtos…"}
            className="flex-1 min-w-0 resize-none bg-transparent outline-none py-2 placeholder:text-mute"
          />
          <ComposerPrimitive.Send className="btn">Enviar</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}

export function App() {
  const agent = useMemo(() => new HttpAgent({ url: `${API}/api/agui?${storeQuery}` }), []);
  const runtime = useAgUiRuntime({ agent });
  const { event, loadGraph } = useTrace.getState();

  useEffect(() => {
    loadGraph();
    const sub = agent.subscribe({ onEvent: ({ event: e }) => { event(e); } });
    return () => sub.unsubscribe();
  }, [agent]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-full p-4 max-md:p-0">
        <div className="h-full flex flex-col md:flex-row rounded-2xl max-md:rounded-none overflow-hidden border border-line max-md:border-0 bg-paper">
          <main className="flex-1 min-h-0 min-w-0 flex"><Chat /></main>
          <DebugPanel />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}

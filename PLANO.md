# Plano — Frontend: chat assistant-ui + depuração visual do LangGraph

> Projeto: `~/projects/ucp-agent-web` (aplicação **separada** do backend).
> Backend: `~/projects/langgraph` (ver `PLANO.md` e `PLANO-INFRA.md` de lá).
> Status: **decisões fechadas, nada codificado.** POC: sem testes unitários ou de integração.
> Design aprovado: https://claude.ai/artifact/XPoqZkCBgAKMGh4nBzxt5h
> (5 telas: descoberta, aprovação, mobile, depuração em lista, **depuração com grafo visual**).

## 1. Objetivo

Um chat de e-commerce (assistant-ui) com uma coluna **sempre visível** de depuração que mostra,
**em forma de grafo**, todos os nós do LangGraph, onde a execução está, o que cada nó fez e o
estado em cada ponto. O painel é a parte mais importante do estudo.

## 2. Stack (versões do npm em 2026-10-24)

| Peça | Versão | Para quê |
|---|---|---|
| Node | 22.14 | já instalado |
| Vite + React + TypeScript | 8.3.5 / 19.3.1 | app |
| @assistant-ui/react | 0.15.31 | chat, thread, composer, tool UIs |
| @assistant-ui/react-ag-ui | 0.1.0 | liga o assistant-ui a um backend AG-UI |
| @ag-ui/client | 1.0.3 | `HttpAgent` (lê o stream de eventos) |
| @xyflow/react (React Flow) | 12.12.0 | **grafo visual** |
| @dagrejs/dagre | 3.1.3 | posição automática dos nós |
| zustand | — | store do painel |
| Tailwind | — | tokens do design (rosa `#C2185B`, DM Sans/Serif, JetBrains Mono) |

## 3. Protocolo com o backend: AG-UI (mudou em relação ao plano anterior)

### 3.1 Por que eu tinha proposto um adapter escrito à mão

O assistant-ui não fala com o seu backend sozinho: ele precisa de um **runtime**, a peça que
traduz "o que o servidor mandou" em mensagens da thread. Os runtimes prontos esperam
protocolos específicos (AI SDK, LangGraph Platform em Python, AG-UI…). Um backend Spring
próprio não fala nenhum deles, então eu assumi que precisaria inventar um SSE e traduzir na mão
(~100 linhas, mais manutenção).

### 3.2 O que descobri depois

Existem as duas pontas prontas:

- **Backend:** `langgraph4j-ag-ui-springboot` 1.9.7 (`AGUISSEController`) expõe um grafo
  langgraph4j como endpoint AG-UI.
- **Front:** `@assistant-ui/react-ag-ui` (`useAgUiRuntime`) consome esse endpoint.

AG-UI é um protocolo aberto de eventos de agente. Os eventos que importam para nós já existem:

| Evento AG-UI | Usamos para |
|---|---|
| `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` | selo RODANDO / FINALIZADO / FALHOU |
| `STEP_STARTED` / `STEP_FINISHED` (`stepName` = nó) | **qual nó está ativo**, duração por nó |
| `STATE_SNAPSHOT` / `STATE_DELTA` | **estado** do `OrderState` e o que mudou |
| `TEXT_MESSAGE_*` | texto do assistente |
| `TOOL_CALL_*` | cartões de produto e de aprovação |
| `CUSTOM` | chamadas UCP, chamadas LLM, decisão de edge |

Resultado: sem protocolo inventado e sem adapter manual de SSE; o painel e o chat usam o mesmo stream.

### 3.3 Riscos e plano B

- `@assistant-ui/react-ag-ui` está na versão **0.1.0** e o módulo AG-UI do langgraph4j é
  pouco documentado. Por isso o passo 1 é um **spike de 1 dia**: um grafo mínimo no backend,
  confirmar que `STEP_*` e `STATE_*` chegam e que a pausa do `interruptBefore` aparece.
- **Plano B** (se o spike falhar): `useLocalRuntime` com um `ChatModelAdapter` próprio lendo um
  SSE simples do Spring, usando os mesmos nomes de evento. O resto do app (store, grafo,
  painel) não muda, porque tudo lê do mesmo `traceStore`.

## 4. Grafo visual (React Flow)

### 4.1 Fonte da topologia

Endpoint `GET /api/graph` no backend devolve nós e arestas (com rótulo e se é condicional), a
partir da própria definição do `StateGraph`. Assim o desenho nunca diverge do código.

```json
{ "nodes": [{"id":"discovery","kind":"llm"}, {"id":"checkout","kind":"deterministic"}, ...],
  "edges": [{"from":"discovery","to":"select","label":"ok","conditional":true}, ...],
  "interruptBefore": ["payment"] }
```

### 4.2 O que o programador vê

- **Todos os 7 nós + START/END**, mesmo os que ainda não rodaram. O `errorHandler` aparece com a
  aresta de volta para `discovery`.
- Cor/ícone por estado: pendente, rodando, concluído, **pausado** (âmbar, `interrupt_before`),
  falhou.
- Selo no nó: tempo gasto, e `LLM` ou `puro` (node com modelo vs determinístico).
- **Arestas percorridas** em destaque, com o rótulo da condição que foi avaliada (`ok`, `fail`,
  `retry`, `giveUp`). As não percorridas ficam apagadas.
- **Clicar num nó** mostra o estado naquele ponto (snapshot guardado a cada `STEP_FINISHED`), o
  que mudou em relação ao nó anterior, e as chamadas LLM/UCP feitas dentro dele.
- Contador `retries n/2` no `errorHandler` quando acionado.
- Layout automático (dagre, top-bottom); posições recalculadas só quando a topologia muda.

### 4.3 Mapa tela → componente

| Tela do design | Componente |
|---|---|
| Cards de produto | `ProductCards` (tool UI `show_products`) |
| Chips de resposta rápida | `Suggestions` |
| Cartão de aprovação | `ApprovalCard` (tool UI `request_approval`; botão retoma a thread) |
| Painel "Seu pedido" (5 etapas) | derivado do `traceStore` |
| Depuração: grafo | `GraphView` (React Flow) + `GraphNode` custom |
| Depuração: abas | `Timeline`, `StateInspector`, `Raw` (UCP / LLM) |
| Mobile | mesmo código; o painel vira gaveta fixa no rodapé |

## 5. Estrutura de arquivos

```
ucp-agent-web/
├── PLANO.md
├── package.json, vite.config.ts, index.html, tsconfig*.json
├── .env.example                # VITE_API_URL (opcional; padrão = mesmo domínio /api)
└── src/
    ├── main.tsx
    ├── App.tsx                 # layout: conversas | thread | depuração
    ├── runtime/
    │   ├── AgentProvider.tsx   # HttpAgent + useAgUiRuntime
    │   └── traceStore.ts       # zustand: nó atual, histórico, estados por passo
    ├── chat/                   # ProductCards, ApprovalCard, Suggestions
    ├── debug/
    │   ├── DebugPanel.tsx      # cabeçalho + grafo + abas
    │   ├── GraphView.tsx       # React Flow + dagre
    │   ├── GraphNode.tsx       # nó customizado
    │   ├── Timeline.tsx
    │   ├── StateInspector.tsx
    │   └── Raw.tsx
    └── styles.css              # tokens do design
```

## 6. Painel de depuração: regras

1. **Sempre visível** (decisão fechada). Desktop: coluna à direita. Mobile: gaveta fixa.
   "Depuração" no cabeçalho só recolhe/expande; escolha em `localStorage`.
2. Evento `llm` mostra `fallback` quando não houve chamada real ao DeepSeek.
3. Payload do `update_checkout` aparece com o rótulo `dados fictícios`.
4. Ações: copiar estado em JSON; baixar trace da thread.

## 7. Ordem de execução

1. **Spike AG-UI** no backend (grafo mínimo + `AGUISSEController`) e leitura crua dos eventos no front. Decide AG-UI vs plano B.
2. Scaffold: Vite + React + TS + Tailwind + proxy `/api` → `localhost:8080`.
3. `AgentProvider` + `traceStore`; ver os eventos no console antes de qualquer UI.
4. Chat: thread/composer do assistant-ui, `ProductCards`, `Suggestions`.
5. `ApprovalCard`: aprovar retoma a **mesma thread**.
6. `GraphView` com topologia fixa (mock) → ligar ao `GET /api/graph` e aos eventos reais.
7. Clique no nó → estado do passo; `StateInspector`; `Timeline`; `Raw`.
8. Mobile (gaveta).
9. Rodada real contra a Boca Rosa, depois com DeepSeek.

## 8. Critérios de pronto

- "quero uma base para pele oleosa" mostra cards com foto e preço reais.
- O grafo mostra `discovery → select → checkout` concluídos e `payment` **pausado**.
- Aprovar retoma a mesma thread; o grafo chega em `END` com `fulfillment` concluído.
- Busca vazia ("xyzxyz") faz o grafo mostrar `discovery → errorHandler → discovery` e `retries 1/2`.
- Clicar em qualquer nó concluído mostra o estado daquele passo.
- Cada chamada UCP e LLM aparece com duração.

## 9. Deploy do front

Build estático (`npm run build` → `dist/`) copiado para o servidor e servido pelo Caddy, que
também faz proxy de `/api` para o backend (mesma origem, sem CORS). Passo a passo e HTTPS em
`~/projects/langgraph/PLANO-INFRA.md`. Nenhum segredo no front: variáveis `VITE_*` vão para o
bundle.

## 10. Decisões fechadas

1. Painel sempre visível.
2. Protocolo **AG-UI** (com plano B de adapter próprio se o spike falhar).
3. Grafo visual com React Flow, topologia vinda do backend.
4. Aprovação no mobile: sem tela nova, mesmo cartão em coluna única.
5. Aplicação separada, repositório próprio.

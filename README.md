# lang-graph-frontend-poc

Chat de e-commerce (assistant-ui) com painel de depuração em grafo do LangGraph.
Backend: repositório `lang-graph-ucp-poc`. Plano: [PLANO.md](PLANO.md). POC sem testes automatizados.

Status: front implementado (`npm install && npm run dev`); espera `/api/agui` e `/api/graph` do backend em `localhost:8080`.

## CI/CD

- **CI**: a cada push na `main` e PR roda `npm ci && npm run build`.
- **CD**: a cada push na `main` (ou manual) builda a imagem arm64, publica em
  `ghcr.io/renanpadilha/lang-graph-frontend-poc` e aplica `k8s/` no cluster da VM da OCI
  (`kubectl apply -k` + `set image` com o SHA + `rollout status`).

### Pré-requisitos

- Secrets em *Settings > Secrets and variables > Actions*: `OCI_HOST`, `OCI_USER`,
  `OCI_SSH_KEY` (chave **de deploy**, só para esta VM).
- Pacote do ghcr público (ou `imagePullSecret` no Deployment), senão o cluster não puxa a imagem.
- Secret `basic-auth-users` criado no namespace `apps` (veja `k8s/auth.yaml`).

Nenhum segredo vai para o front: variáveis `VITE_*` entram no bundle.

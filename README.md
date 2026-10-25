# lang-graph-frontend-poc

Chat de e-commerce (assistant-ui) com painel de depuração em grafo do LangGraph.
Backend: repositório `lang-graph-ucp-poc`. Plano: [PLANO.md](PLANO.md). POC sem testes automatizados.

Status: front implementado (`npm install && npm run dev`); espera `/api/agui` e `/api/graph` do backend em `localhost:8080`.

## CI/CD

- **CI**: a cada push na `main` e PR roda `npm ci && npm run build` (pula enquanto não houver `package.json`).
- **CD**: manual ou tag `v*`; gera `dist/` e envia por rsync/SSH para `/opt/app/web` na VM da OCI.
  Fica **desligado** até `DEPLOY_ENABLED=true`.

### Ligar o CD

Mesmos secrets do backend, em *Settings > Secrets and variables > Actions*:
`OCI_HOST`, `OCI_USER`, `OCI_SSH_KEY` (chave **de deploy**, só para esta VM) e a variable
`DEPLOY_ENABLED=true`. Passo a passo da VM e do HTTPS: `PLANO-INFRA.md` no repositório do backend.

Nenhum segredo vai para o front: variáveis `VITE_*` entram no bundle.

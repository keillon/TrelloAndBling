# Bling -> Trello Sync (com Supabase)

Integracao unidirecional:

- Le pedidos de venda novos no Bling
- Cria cards no Trello
- Salva no Supabase para evitar duplicidade
- Nao envia nenhuma atualizacao de volta ao Bling

## 1) Configurar variaveis

Copie `.env.example` para `.env` e preencha:

- `BLING_ACCESS_TOKEN`
- `BLING_CLIENT_ID` (opcional, recomendado para auto-refresh)
- `BLING_CLIENT_SECRET` (opcional, recomendado para auto-refresh)
- `BLING_REFRESH_TOKEN` (opcional, recomendado para auto-refresh)
- `BLING_ALLOWED_STATUS` (opcional, ex: `Em aberto,Aprovado`)
- `BLING_MIN_ORDER_DATE` (opcional, ex: `2026-04-01`)
- `BLING_SYNC_LOOKBACK_DAYS` (padrao `7`)
- `BLING_MIN_INTERVAL_MS` (padrao `350`, pacing para proteger limite da API)
- `TRELLO_KEY`
- `TRELLO_TOKEN`
- `TRELLO_LIST_ID`
- `TRELLO_MIN_INTERVAL_MS` (padrao `120`, pacing para proteger limite da API)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## 2) Criar tabela no Supabase

Execute o SQL em `db/migrations/202604081200__create_order_syncs.sql`.
Esse script cria:

- `order_syncs` (deduplicacao por pedido do Bling)
- `sync_settings` (cursor de ultima sync)
- `sync_runs` (historico de execucoes e erros)

## 3) Rodar projeto

```bash
npm install
npm run dev
```

## 4) Teste manual

- Health check: `GET http://localhost:3333/health`
- Sync manual: `POST http://localhost:3333/sync-orders`
- Webhook Bling: `POST http://localhost:3333/webhooks/bling/orders`

## 5) Sync automatico

O cron e definido por `SYNC_CRON` (padrao: a cada 5 segundos com `*/5 * * * * *`).
Se uma sync ainda estiver rodando, a proxima execucao e pulada para evitar sobreposicao.

## 5.1) Atualizacao em tempo real (sem reload)

O backend publica eventos via Socket.IO.

- Endpoint Socket.IO: mesmo host/porta da API
- Evento ao conectar: `orders:connected`
- Evento de novo card: `orders:card-created`
- Evento de fim de sync: `orders:sync-completed`
- CORS configuravel por `SOCKET_CORS_ORIGIN` (separado por virgula para mais dominios)

Exemplo no frontend:

```ts
import { io } from "socket.io-client";

const socket = io("http://localhost:3333");
socket.on("orders:card-created", () => {
  // recarregue somente os cards/lista via API local
  // sem recarregar a pagina inteira
});
```

## 6) Filtro de novos pedidos

- `BLING_ALLOWED_STATUS`: processa apenas os status informados (case-insensitive)
- `BLING_MIN_ORDER_DATE`: define data minima fixa para processar pedidos
- Sem `BLING_MIN_ORDER_DATE`, o sistema usa automaticamente o primeiro dia do mes atual
- A coleta de pedidos no Bling e paginada (100 por pagina) para trazer todos os pedidos disponiveis no periodo

## 7) Renovacao automatica do token Bling

Se `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET` e `BLING_REFRESH_TOKEN` estiverem preenchidos, o backend tenta renovar o token automaticamente quando a API do Bling responder 401.

## 8) Atualizar cards antigos para novo padrao

Para atualizar os cards antigos (titulo e descricao), execute:

- `POST http://localhost:3333/backfill-cards`

## 9) Deploy (Railway/Render/Fly via Docker)

Este projeto esta pronto para deploy com o `Dockerfile` da raiz.

- Healthcheck: `GET /health`
- Porta interna: `3333`

### Variaveis obrigatorias no provedor

- `PORT` (use `3333`)
- `BLING_API_BASE_URL`
- `BLING_ACCESS_TOKEN`
- `BLING_CLIENT_ID`
- `BLING_CLIENT_SECRET`
- `BLING_REFRESH_TOKEN`
- `BLING_SYNC_LOOKBACK_DAYS`
- `BLING_MIN_INTERVAL_MS`
- `TRELLO_API_BASE_URL`
- `TRELLO_KEY`
- `TRELLO_TOKEN`
- `TRELLO_LIST_ID`
- `TRELLO_MIN_INTERVAL_MS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SOCKET_CORS_ORIGIN` (ex.: `https://seu-frontend.com`)
- `SYNC_CRON` (ex.: `*/5 * * * * *`)

### Passo a passo rapido (Railway/Render)

1. Crie um novo service apontando para este repositorio.
2. Selecione deploy por Docker (auto-detecta o `Dockerfile`).
3. Configure as variaveis de ambiente acima.
4. Deploy.
5. Teste:
   - `GET https://SEU_DOMINIO/health`
   - `POST https://SEU_DOMINIO/sync-orders` (manual opcional)

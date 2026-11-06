# 4. Task Graph
Each task is TDD: failing test → implementation → `npm run typecheck && npm run lint && npm test` → commit.

## Foundation
- [ ] T01 Monorepo tooling: npm workspaces, strict tsconfig, eslint, vitest; env config loader with zod validation (test: invalid env rejected)
- [ ] T02 DB layer: pg pool, `withTx`, SQL migrator + `001_init.sql` (test: migrations apply idempotently)
- [ ] T03 HTTP skeleton: app factory, helmet/cors/rate limit, error middleware, `/healthz` (test: health + 404 + error mapping)

## Core domain
- [ ] T04 Auth: users repo, bcrypt, JWT login, `/auth/me`, RBAC middleware, admin bootstrap, `/users` admin CRUD
- [ ] T05 Categories + Products CRUD with custom attributes, search, duplicate-SKU 409
- [ ] T06 Warehouses CRUD
- [ ] T07 Stock service: receive/issue/adjust/transfer, atomic, ledger, never negative (incl. concurrency test)
- [ ] T08 Suppliers + Customers CRUD
- [ ] T09 Settings service (dynamic, defaults merged) + `/settings`
- [ ] T10 Realtime event bus + SSE `/events`; stock events emitted
- [ ] T11 Orders: create / confirm (atomic stock deduction) / fulfill / cancel (restock)
- [ ] T12 Dashboard stats + low-stock alert service (event + channel notify)

## Integrations
- [ ] T13 Channel adapters (WhatsApp, Messenger, Instagram, Telegram) + ChannelHub + message log
- [ ] T14 Bot command engine (help/catalog/stock/price/order/status)
- [ ] T15 Webhooks: Meta verify + HMAC signature + parsing; Telegram secret header; idempotent by message id
- [ ] T16 Order status notifications to the customer's channel; `/messages`, `/messages/send`, `/channels`
- [ ] T17 Azure Blob SAS upload endpoint; public catalog + public order endpoints
- [ ] T18 Composition root `index.ts`, static SPA serving, App Insights hook, graceful shutdown

## Web
- [ ] T19 Web scaffold: Vite + React + router, API client, auth context, layout, login (test: login form)
- [ ] T20 Dashboard (KPIs + live SSE feed), Products (dynamic custom fields, image upload), Categories
- [ ] T21 Inventory (levels, receive/issue/adjust/transfer), Movements, Warehouses
- [ ] T22 Orders, Customers, Suppliers, Inbox (send reply), Settings, Users
- [ ] T23 Public Shop (cart, checkout, WhatsApp deep link) + PWA manifest/service worker

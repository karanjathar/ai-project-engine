# 1. Product Requirements Document — StockSync Inventory Platform

## 1.1 Goal
A fully dynamic inventory management platform for small and mid-sized businesses. It ships as a
**web dashboard** (also installable as a mobile **PWA app**) plus a **public storefront website**, and
is integrated with **WhatsApp, Facebook Messenger, Instagram and Telegram** so that customers can
check stock, check prices and place orders from chat, and staff receive low-stock alerts on chat.
Runs on **Microsoft Azure**.

## 1.2 Users & Roles
| Role | Can do |
|---|---|
| `admin` | Everything, plus manage users and settings |
| `staff` | Manage products, stock, warehouses, suppliers, customers, orders |
| `viewer` | Read-only dashboard access |
| Customer (anonymous) | Browse the public catalog, order through the website or a chat channel |

## 1.3 Functional Objectives
1. **Auth**: email/password login with JWT. Bootstrap admin from env. Admin creates other users.
2. **Catalog**: categories; products with SKU, name, description, unit, price, reorder level, image,
   active flag and **dynamic custom attributes** (key/value pairs defined in Settings).
3. **Warehouses**: multiple locations; stock is tracked per product per warehouse.
4. **Stock movements**: receive (IN), issue (OUT), adjust (set absolute count), and transfer between
   warehouses. Every change is written to an immutable movement ledger with user and reason.
   Stock can never go negative.
5. **Suppliers & Customers**: CRUD. Customers are auto-created from chat channels.
6. **Orders**: created by staff, the website, or chat. Lifecycle `PENDING → CONFIRMED → FULFILLED`,
   or `CANCELLED`. Confirming deducts stock atomically. Cancelling a confirmed order restocks it.
   The customer is notified on their channel when the status changes.
7. **Low-stock alerts**: when total stock for a product falls to or below its reorder level, push a
   live dashboard event and send a chat message to the alert recipients configured in Settings.
8. **Real-time dashboard**: KPIs (products, total units, stock value, low-stock count, pending
   orders) and a live event feed over Server-Sent Events.
9. **Chat bot** (all channels) commands: `help`, `catalog`, `stock <SKU>`, `price <SKU>`,
   `order <SKU> <qty>`, `status <order#>`. All inbound and outbound messages appear in an Inbox.
10. **Public website**: `/shop` shows active products, price and availability, a cart, and checkout
    with name and phone, plus an "Order on WhatsApp" deep link.
11. **Dynamic settings** (no redeploy needed): business name, currency, public WhatsApp number,
    default warehouse, alert recipients, custom attribute definitions.
12. **Images**: uploaded straight from the browser to Azure Blob Storage with a short-lived SAS URL.

## 1.4 User Flows
- *Receive goods*: Staff → Inventory → Receive → pick product, warehouse, qty → ledger + live update.
- *Chat order*: Customer sends `order TSHIRT-RED 2` on WhatsApp → a PENDING order is created and the
  customer gets the order number → staff confirm in the dashboard → stock is deducted and the
  customer gets a "confirmed" message → stock falls below the reorder level → staff get an alert.
- *Web order*: Customer → /shop → add to cart → checkout → PENDING order (channel `web`).

## 1.5 Acceptance Criteria
- All API inputs are validated (zod). Invalid input gets 400 with field errors.
- Stock is never negative, even under concurrent requests (row-level atomic SQL).
- Webhooks reject requests without a valid signature or secret (401/403).
- RBAC is enforced on every mutating route. Viewers get 403.
- `npm run typecheck`, `npm run lint` and `npm test` pass.

## 1.6 Edge Cases
Unknown SKU in chat; order quantity above available stock; duplicate SKU (409); transfer to the
same warehouse (400); cancelling a fulfilled order (409); a channel not configured (message logged,
send skipped); Meta webhook retries (handled idempotently by message id).

## 1.7 Non-Goals (v1)
Payments, multi-tenant SaaS, barcode hardware integration, accounting/invoicing, native
iOS/Android binaries (the PWA covers mobile), multi-currency per order.

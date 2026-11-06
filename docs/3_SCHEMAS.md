# 3. Schemas & Contracts

## 3.1 Database (PostgreSQL) — `src/api/migrations/001_init.sql`
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, name text NOT NULL, role text NOT NULL CHECK (role IN ('admin','staff','viewer')),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text NOT NULL UNIQUE,
  name text NOT NULL, description text NOT NULL DEFAULT '', category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  unit text NOT NULL DEFAULT 'pcs', price_cents integer NOT NULL CHECK (price_cents >= 0),
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0), image_url text,
  attributes jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE warehouses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
  name text NOT NULL, address text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stock_levels (product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0), PRIMARY KEY (product_id, warehouse_id));
CREATE TABLE stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('IN','OUT','ADJUST','TRANSFER_IN','TRANSFER_OUT')),
  quantity_delta integer NOT NULL, balance_after integer NOT NULL, reason text NOT NULL DEFAULT '',
  reference text, user_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  email text, phone text, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  phone text, email text, channel text NOT NULL DEFAULT 'manual', channel_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (channel, channel_user_id));
CREATE TABLE orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number serial UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id), channel text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','FULFILLED','CANCELLED')),
  warehouse_id uuid REFERENCES warehouses(id), total_cents integer NOT NULL, notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0), unit_price_cents integer NOT NULL);
CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE channel_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')), external_user text NOT NULL,
  external_id text UNIQUE, text text NOT NULL, status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now());
```

## 3.2 Core TypeScript Types — `src/api/src/domain/types.ts`
```ts
export type Role = 'admin' | 'staff' | 'viewer';
export type ChannelName = 'whatsapp' | 'messenger' | 'instagram' | 'telegram';
export type OrderChannel = ChannelName | 'web' | 'manual';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED';
export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER_IN' | 'TRANSFER_OUT';
export interface User { id: string; email: string; name: string; role: Role; createdAt: string }
export interface AuthUser { id: string; email: string; role: Role }
export interface Category { id: string; name: string }
export interface Product { id: string; sku: string; name: string; description: string; categoryId: string | null;
  unit: string; priceCents: number; reorderLevel: number; imageUrl: string | null;
  attributes: Record<string, string>; isActive: boolean; totalQuantity: number; createdAt: string; updatedAt: string }
export interface Warehouse { id: string; code: string; name: string; address: string }
export interface StockLevel { productId: string; sku: string; productName: string; warehouseId: string; warehouseCode: string; quantity: number }
export interface StockMovement { id: string; productId: string; sku: string; warehouseId: string; warehouseCode: string;
  type: MovementType; quantityDelta: number; balanceAfter: number; reason: string; reference: string | null;
  userId: string | null; createdAt: string }
export interface Supplier { id: string; name: string; email: string | null; phone: string | null; notes: string }
export interface Customer { id: string; name: string; phone: string | null; email: string | null; channel: OrderChannel | string; channelUserId: string | null }
export interface OrderItem { productId: string; sku: string; name: string; quantity: number; unitPriceCents: number }
export interface Order { id: string; number: number; customerId: string; customerName: string; channel: OrderChannel;
  status: OrderStatus; warehouseId: string | null; totalCents: number; notes: string; items: OrderItem[]; createdAt: string; updatedAt: string }
export interface AlertRecipient { channel: ChannelName; to: string }
export interface CustomFieldDef { key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[] }
export interface Settings { businessName: string; currency: string; whatsappNumber: string; defaultWarehouseId: string | null;
  alertRecipients: AlertRecipient[]; customFields: CustomFieldDef[] }
export interface ChannelMessage { id: string; channel: ChannelName; direction: 'in' | 'out'; externalUser: string; text: string; status: string; createdAt: string }
export interface InboundMessage { channel: ChannelName; from: string; text: string; externalId?: string; senderName?: string }
export type RealtimeEvent =
  | { type: 'stock.changed'; productId: string; sku: string; warehouseId: string; quantity: number; totalQuantity: number }
  | { type: 'stock.low'; productId: string; sku: string; name: string; totalQuantity: number; reorderLevel: number }
  | { type: 'order.created' | 'order.updated'; orderId: string; number: number; status: OrderStatus }
  | { type: 'message.received'; channel: ChannelName; from: string; text: string };
export interface DashboardStats { productCount: number; totalUnits: number; stockValueCents: number;
  lowStockCount: number; pendingOrders: number; ordersToday: number }
```

## 3.3 Channel Adapter Contract — `src/api/src/channels/types.ts`
```ts
export interface ChannelAdapter { readonly name: ChannelName; isConfigured(): boolean; send(to: string, text: string): Promise<void> }
```
Wire formats (outbound):
- WhatsApp: `POST https://graph.facebook.com/{ver}/{WHATSAPP_PHONE_NUMBER_ID}/messages`, Bearer `WHATSAPP_TOKEN`,
  body `{messaging_product:'whatsapp', to, type:'text', text:{body}}`
- Messenger / Instagram: `POST https://graph.facebook.com/{ver}/me/messages`, Bearer page token,
  body `{recipient:{id:to}, messaging_type:'RESPONSE', message:{text}}`
- Telegram: `POST https://api.telegram.org/bot{TOKEN}/sendMessage`, body `{chat_id:to, text}`

Inbound:
- `GET /webhooks/meta?hub.mode=subscribe&hub.verify_token=..&hub.challenge=..` → echoes the challenge
- `POST /webhooks/meta`, header `X-Hub-Signature-256: sha256=<HMAC(META_APP_SECRET, rawBody)>`
  - `object:'whatsapp_business_account'` → `entry[].changes[].value.messages[]{id, from, type:'text', text.body}`, `value.contacts[].profile.name`
  - `object:'page'` (messenger) / `'instagram'` → `entry[].messaging[]{sender.id, message{mid,text}}` (skip `message.is_echo`)
- `POST /webhooks/telegram`, header `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET` → `message{message_id, chat.id, text, from.first_name}`

## 3.4 REST API (JSON; prefix `/api`; errors `{error:{code,message,details?}}`)
| Method & Path | Role | Body / Query | Response |
|---|---|---|---|
| POST /auth/login | public | `{email,password}` | `{token,user}` |
| GET /auth/me | any | – | `User` |
| GET/POST /users | admin | `{email,password(min 8),name,role}` | `User[]` / `User` 201 |
| DELETE /users/:id | admin | – | 204 |
| GET/POST /categories | read / staff | `{name}` | `Category[]` / `Category` |
| DELETE /categories/:id | staff | – | 204 |
| GET /products | any | `?search&categoryId&lowStock=true` | `Product[]` |
| GET /products/:id | any | – | `Product` |
| POST /products | staff | `{sku,name,description?,categoryId?,unit?,priceCents,reorderLevel?,imageUrl?,attributes?,isActive?}` | `Product` 201 |
| PATCH /products/:id | staff | partial of the above | `Product` |
| DELETE /products/:id | staff | – | 204 |
| GET/POST /warehouses | any / staff | `{code,name,address?}` | `Warehouse[]` / `Warehouse` |
| PATCH/DELETE /warehouses/:id | staff | partial | `Warehouse` / 204 |
| GET /stock | any | `?productId&warehouseId` | `StockLevel[]` |
| POST /stock/receive | staff | `{productId,warehouseId,quantity>0,reason?,reference?}` | `StockLevel` |
| POST /stock/issue | staff | same | `StockLevel` (409 insufficient) |
| POST /stock/adjust | staff | `{productId,warehouseId,newQuantity>=0,reason}` | `StockLevel` |
| POST /stock/transfer | staff | `{productId,fromWarehouseId,toWarehouseId,quantity>0,reason?}` | `{from:StockLevel,to:StockLevel}` |
| GET /stock/movements | any | `?productId&warehouseId&limit` | `StockMovement[]` |
| CRUD /suppliers, /customers | any read / staff write | entity fields | entity |
| GET /orders | any | `?status` | `Order[]` |
| GET /orders/:id | any | – | `Order` |
| POST /orders | staff | `{customerId,items:[{productId,quantity}],notes?,warehouseId?}` | `Order` 201 |
| POST /orders/:id/confirm | staff | `{warehouseId?}` | `Order` (409 insufficient stock) |
| POST /orders/:id/fulfill, /cancel | staff | – | `Order` |
| GET /dashboard | any | – | `DashboardStats` |
| GET /events | any | – | `text/event-stream` of `RealtimeEvent` |
| GET /settings | any | – | `Settings` |
| PUT /settings | admin | partial `Settings` | `Settings` |
| GET /channels | any | – | `{name,configured}[]` |
| GET /messages | any | `?channel&limit` | `ChannelMessage[]` |
| POST /messages/send | staff | `{channel,to,text}` | 202 |
| POST /uploads/image-sas | staff | `{filename,contentType}` | `{uploadUrl,blobUrl}` (501 if not configured) |
| GET /public/catalog | public | – | `{settings:{businessName,currency,whatsappNumber},products:[{id,sku,name,description,priceCents,unit,imageUrl,inStock,available}]}` |
| POST /public/orders | public (rate-limited) | `{name,phone,items:[{productId,quantity}]}` | `{number,status,totalCents}` 201 |
| GET /healthz | public | – | `{status:'ok',db:'ok'}` |

## 3.5 Bot Command Grammar (case-insensitive)
`help` · `catalog` (top 10 active in stock) · `stock <SKU>` · `price <SKU>` · `order <SKU> <qty>` · `status <number>`.
Anything else → help text.

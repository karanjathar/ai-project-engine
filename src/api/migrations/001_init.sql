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
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_movements_product_created ON stock_movements(product_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_messages_created ON channel_messages(created_at DESC);

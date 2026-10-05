/** Minimal subset of the Cloudflare D1 API used here (keeps us off @cloudflare/workers-types). */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<{ meta?: { changes?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatementLike;
}

/** One captured payment. No name, email or phone: only an HMAC of the email. */
export interface Order {
  paymentId: string;
  /** null when the payment could not be matched to a product (support handles it). */
  productId: string | null;
  amountPaise: number;
  emailHash: string | null;
  eventId: string | null;
  createdAt: string;
}

export interface OrdersStore {
  /** Inserts the order; returns false if this payment ID was already recorded. */
  recordPayment(order: Order): Promise<boolean>;
  findOrder(paymentId: string): Promise<Order | null>;
  /** Increments the counter for `key` in `windowStart` and returns the new count. */
  hitRateLimit(key: string, windowStart: number): Promise<number>;
  /** Deletes rate-limit rows older than `before` (epoch seconds). */
  purgeRateLimits(before: number): Promise<void>;
}

interface OrderRow {
  payment_id: string;
  product_id: string | null;
  amount_paise: number;
  email_hash: string | null;
  event_id: string | null;
  created_at: string;
}

export function d1Store(db: D1Like): OrdersStore {
  return {
    async recordPayment(o) {
      const res = await db
        .prepare(
          `INSERT INTO orders (payment_id, product_id, amount_paise, email_hash, event_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (payment_id) DO NOTHING`,
        )
        .bind(o.paymentId, o.productId, o.amountPaise, o.emailHash, o.eventId, o.createdAt)
        .run();
      return (res.meta?.changes ?? 0) > 0;
    },
    async findOrder(paymentId) {
      const row = await db
        .prepare(
          `SELECT payment_id, product_id, amount_paise, email_hash, event_id, created_at
           FROM orders WHERE payment_id = ?`,
        )
        .bind(paymentId)
        .first<OrderRow>();
      if (!row) return null;
      return {
        paymentId: row.payment_id,
        productId: row.product_id,
        amountPaise: row.amount_paise,
        emailHash: row.email_hash,
        eventId: row.event_id,
        createdAt: row.created_at,
      };
    },
    async hitRateLimit(key, windowStart) {
      const row = await db
        .prepare(
          `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
           ON CONFLICT (key) DO UPDATE SET count = count + 1
           RETURNING count`,
        )
        .bind(key, windowStart)
        .first<{ count: number }>();
      return row?.count ?? 1;
    },
    async purgeRateLimits(before) {
      await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(before).run();
    },
  };
}

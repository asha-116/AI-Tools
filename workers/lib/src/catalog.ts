/** The paid product catalog (products/catalog.json), validated at load time. */

export type ProductStatus = 'draft' | 'live' | 'retired';

export interface ProductFile {
  key: string;
  name: string;
  content_type: string;
}

export interface Product {
  id: string;
  name_en: string;
  name_hi: string;
  price_inr: number;
  status: ProductStatus;
  files: ProductFile[];
}

export interface Catalog {
  products: Product[];
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_RE = /^[a-z0-9][a-z0-9/._-]*$/;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const STATUSES: ReadonlySet<string> = new Set(['draft', 'live', 'retired']);

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

function parseFile(x: unknown, where: string): ProductFile {
  if (!isObj(x)) throw new Error(`${where}: file must be an object`);
  const { key, name, content_type } = x;
  if (!isStr(key) || !KEY_RE.test(key)) throw new Error(`${where}: bad file key`);
  if (!isStr(name) || !NAME_RE.test(name)) throw new Error(`${where}: bad file name`);
  if (!isStr(content_type)) throw new Error(`${where}: missing content_type`);
  return { key, name, content_type };
}

function parseProduct(x: unknown, i: number): Product {
  const where = `products[${String(i)}]`;
  if (!isObj(x)) throw new Error(`${where}: must be an object`);
  const { id, name_en, name_hi, price_inr, status, files } = x;
  if (!isStr(id) || !ID_RE.test(id)) throw new Error(`${where}: bad id`);
  if (!isStr(name_en) || !isStr(name_hi)) throw new Error(`${where}: names required in EN + HI`);
  if (typeof price_inr !== 'number' || !Number.isInteger(price_inr) || price_inr < 1) {
    throw new Error(`${where}: price_inr must be a whole number of rupees`);
  }
  if (typeof status !== 'string' || !STATUSES.has(status)) throw new Error(`${where}: bad status`);
  if (!Array.isArray(files) || files.length === 0) throw new Error(`${where}: no files`);
  return {
    id,
    name_en,
    name_hi,
    price_inr,
    status: status as ProductStatus,
    files: files.map((f) => parseFile(f, where)),
  };
}

export function parseCatalog(raw: unknown): Catalog {
  if (!isObj(raw) || !Array.isArray(raw['products']) || raw['products'].length === 0) {
    throw new Error('catalog: "products" must be a non-empty array');
  }
  const products = raw['products'].map(parseProduct);
  const ids = new Set<string>();
  const prices = new Map<number, string>();
  for (const p of products) {
    if (ids.has(p.id)) throw new Error(`catalog: duplicate id ${p.id}`);
    ids.add(p.id);
    if (p.status === 'retired') continue;
    const other = prices.get(p.price_inr);
    // Payments without a product field are matched by amount, so it must be unambiguous.
    if (other) throw new Error(`catalog: ${other} and ${p.id} have the same price`);
    prices.set(p.price_inr, p.id);
  }
  return { products };
}

export interface PaymentFacts {
  amountPaise: number;
  /** Razorpay `notes`: an object of strings, or an empty array when there are none. */
  notes: unknown;
}

/**
 * Which product a captured payment bought, or null if it cannot be matched safely.
 * The amount must equal the product's full price either way.
 */
export function resolveProduct(
  catalog: Catalog,
  payment: PaymentFacts,
  allowDrafts: boolean,
): Product | null {
  const sellable = catalog.products.filter(
    (p) => p.status === 'live' || (allowDrafts && p.status === 'draft'),
  );
  const named = isObj(payment.notes) ? payment.notes['product'] : undefined;
  const byAmount = sellable.filter((p) => p.price_inr * 100 === payment.amountPaise);
  if (typeof named === 'string' && named.length > 0) {
    return byAmount.find((p) => p.id === named) ?? null;
  }
  return byAmount.length === 1 ? (byAmount[0] ?? null) : null;
}

export function findFile(catalog: Catalog, productId: string, key: string): ProductFile | null {
  const product = catalog.products.find((p) => p.id === productId);
  return product?.files.find((f) => f.key === key) ?? null;
}

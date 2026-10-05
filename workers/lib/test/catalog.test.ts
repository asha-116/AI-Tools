import { describe, expect, it } from 'vitest';
import catalogFile from '../../../products/catalog.json' with { type: 'json' };
import { findFile, parseCatalog, resolveProduct, type Catalog } from '../src/catalog.js';

const catalog: Catalog = parseCatalog({
  products: [
    { id: 'a', name_en: 'A', name_hi: 'ए', price_inr: 199, status: 'live', files: [f('a.xlsx')] },
    { id: 'b', name_en: 'B', name_hi: 'बी', price_inr: 299, status: 'draft', files: [f('b.xlsx')] },
    {
      id: 'c',
      name_en: 'C',
      name_hi: 'सी',
      price_inr: 99,
      status: 'retired',
      files: [f('c.xlsx')],
    },
  ],
});

function f(key: string) {
  return { key, name: key, content_type: 'application/octet-stream' };
}

describe('resolveProduct', () => {
  it('matches a live product by amount when no product field is sent', () => {
    expect(resolveProduct(catalog, { amountPaise: 19900, notes: {} }, false)?.id).toBe('a');
    expect(resolveProduct(catalog, { amountPaise: 19900, notes: [] }, false)?.id).toBe('a');
    expect(resolveProduct(catalog, { amountPaise: 19900, notes: null }, false)?.id).toBe('a');
  });

  it('only sells drafts when drafts are allowed (test mode), and never retired products', () => {
    expect(resolveProduct(catalog, { amountPaise: 29900, notes: {} }, false)).toBeNull();
    expect(resolveProduct(catalog, { amountPaise: 29900, notes: {} }, true)?.id).toBe('b');
    expect(resolveProduct(catalog, { amountPaise: 9900, notes: {} }, true)).toBeNull();
  });

  it('uses the product field when present and still requires the full price', () => {
    expect(
      resolveProduct(catalog, { amountPaise: 19900, notes: { product: 'a' } }, false)?.id,
    ).toBe('a');
    // Right product, wrong amount (e.g. a tampered or partial payment): no delivery.
    expect(
      resolveProduct(catalog, { amountPaise: 100, notes: { product: 'a' } }, false),
    ).toBeNull();
    // Product field names something else than the amount would suggest: trust neither.
    expect(
      resolveProduct(catalog, { amountPaise: 19900, notes: { product: 'b' } }, true),
    ).toBeNull();
    expect(
      resolveProduct(catalog, { amountPaise: 19900, notes: { product: 'zzz' } }, true),
    ).toBeNull();
  });

  it('returns null for an amount that matches nothing', () => {
    expect(resolveProduct(catalog, { amountPaise: 12345, notes: {} }, true)).toBeNull();
  });
});

describe('findFile', () => {
  it('finds a file only within its own product, including retired ones', () => {
    expect(findFile(catalog, 'a', 'a.xlsx')?.name).toBe('a.xlsx');
    expect(findFile(catalog, 'c', 'c.xlsx')?.name).toBe('c.xlsx');
    expect(findFile(catalog, 'a', 'b.xlsx')).toBeNull();
    expect(findFile(catalog, 'nope', 'a.xlsx')).toBeNull();
  });
});

describe('parseCatalog', () => {
  it('accepts the real catalog', () => {
    const c = parseCatalog(catalogFile);
    expect(c.products.map((p) => p.id)).toEqual(['lead-tracker', 'commission-ledger', 'bundle']);
    // Nothing is buyable on the live site until the owner approves prices.
    expect(c.products.every((p) => p.status === 'draft')).toBe(true);
  });

  it('rejects duplicate ids, duplicate prices among sellable products, and bad shapes', () => {
    const p = (id: string, price: number, status = 'live') => ({
      id,
      name_en: id,
      name_hi: id,
      price_inr: price,
      status,
      files: [f(`${id}.x`)],
    });
    expect(() => parseCatalog({ products: [p('a', 1), p('a', 2)] })).toThrow(/duplicate id/);
    expect(() => parseCatalog({ products: [p('a', 1), p('b', 1, 'draft')] })).toThrow(/same price/);
    expect(() => parseCatalog({ products: [p('a', 1), p('b', 1, 'retired')] })).not.toThrow();
    expect(() => parseCatalog({ products: [] })).toThrow();
    expect(() => parseCatalog(null)).toThrow();
    expect(() => parseCatalog({ products: [{ ...p('a', 1), price_inr: 1.5 }] })).toThrow();
    expect(() => parseCatalog({ products: [{ ...p('a', 1), status: 'sale' }] })).toThrow();
    expect(() => parseCatalog({ products: [{ ...p('a', 1), files: [] }] })).toThrow();
    expect(() => parseCatalog({ products: [{ ...p('a', 1), files: [{ key: 'k' }] }] })).toThrow();
    expect(() => parseCatalog({ products: [{ ...p('A b', 1) }] })).toThrow();
    expect(() => parseCatalog({ products: ['x'] })).toThrow(/object/);
    expect(() => parseCatalog({ products: [{ ...p('a', 1), name_hi: '' }] })).toThrow(/EN \+ HI/);
    expect(() => parseCatalog({ products: [{ ...p('a', 1), price_inr: 0 }] })).toThrow(/price/);
    expect(() => parseCatalog({ products: [{ ...p('a', 1), price_inr: '199' }] })).toThrow(/price/);
    const file = f('k');
    for (const bad of [
      'k',
      { ...file, key: '../etc' },
      { ...file, name: 'a b.xlsx' },
      { ...file, name: 'x"y' },
      { ...file, content_type: '' },
    ]) {
      expect(() => parseCatalog({ products: [{ ...p('a', 1), files: [bad] }] })).toThrow();
    }
  });
});

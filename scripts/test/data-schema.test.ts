import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkFreeTierLimits, checkLandUnits } from '../lib/data-schema.mjs';

const root = new URL('../../', import.meta.url);
const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

const unitFile = {
  dataset: 'land-units',
  status: 'verified',
  verified_by: 'owner',
  last_verified: '2026-10-10',
  sources: [{ url: 'https://example.gov.in/units', title: 'Units' }],
  units: [{ id: 'guntha', label_en: 'Guntha', label_hi: 'गुंठा', sq_ft: 1089, sq_m: 101.17141056 }],
};

describe('checkLandUnits', () => {
  it('passes every land-units file in the repo, with unique ids across files', () => {
    const seen = new Set<string>();
    const files = readdirSync(new URL('data/land-units/', root)).filter(
      (f) => f.endsWith('.json') && f !== 'schema.json',
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(checkLandUnits(read(`data/land-units/${f}`), f, seen)).toEqual([]);
    }
  });

  it('passes a well-formed file', () => {
    expect(checkLandUnits(unitFile, 'x.json')).toEqual([]);
  });

  it('catches sq_ft and sq_m that describe different areas', () => {
    const bad = { ...unitFile, units: [{ ...unitFile.units[0], sq_m: 101.2 }] };
    expect(checkLandUnits(bad, 'x.json')).toEqual([
      expect.stringContaining('"guntha": sq_ft × 0.09290304'),
    ]);
  });

  it('catches a unit id defined in two files', () => {
    const seen = new Set<string>();
    expect(checkLandUnits(unitFile, 'a.json', seen)).toEqual([]);
    expect(checkLandUnits(unitFile, 'b.json', seen)).toEqual([
      'b.json: unit id "guntha" is defined twice',
    ]);
  });

  it('reports missing fields, bad status, http sources and a verified file nobody verified', () => {
    const errs = checkLandUnits(
      {
        dataset: 'area',
        status: 'verified',
        verified_by: 'not verified',
        states: ['Maharashtra'],
        sources: [{ url: 'http://x.in', title: 'x' }],
        units: [{ id: 'Bad Id', label_en: 'x', sq_m: 0 }],
      },
      'x.json',
    );
    expect(errs).toEqual([
      'x.json: "dataset" must be "land-units"',
      'x.json: "verified_by" must name who verified it',
      'x.json: "last_verified" is required',
      'x.json: "states" must be two-letter state codes, e.g. ["MH"]',
      'x.json: every source needs an https "url" and a "title"',
      'x.json: unit id "Bad Id" must be snake_case',
      'x.json: unit "Bad Id" needs "label_en" and "label_hi"',
      'x.json: unit "Bad Id" needs a positive "sq_m"',
    ]);
    expect(checkLandUnits({ ...unitFile, status: 'done', units: [] }, 'y.json')).toEqual([
      'y.json: "status" must be "draft" or "verified"',
      'y.json: "units" must be a non-empty array',
    ]);
    expect(checkLandUnits([], 'z.json')).toEqual(['z.json: must be a JSON object']);
    expect(checkLandUnits({ ...unitFile, verified_by: '', sources: [] }, 'w.json')).toEqual([
      'w.json: "verified_by" is required',
      'w.json: "sources" must be a non-empty array',
    ]);
  });
});

describe('checkFreeTierLimits', () => {
  const limit = {
    id: 'a',
    service: 'S',
    metric: 'M',
    unit: 'min',
    window: 'month',
    limit: 10,
    source: 'https://example.com',
    last_verified: '2026-10-10',
    verified_by: 'owner',
  };

  it('passes the repo file', () => {
    expect(checkFreeTierLimits(read('data/free-tier-limits.json'), 'f.json')).toEqual([]);
  });

  it('reports bad limits', () => {
    const errs = checkFreeTierLimits(
      {
        alert_threshold_percent: 120,
        limits: [limit, { ...limit, window: 'week', limit: 0, source: 'x', service: '' }],
      },
      'f.json',
    );
    expect(errs).toEqual([
      'f.json: "alert_threshold_percent" must be a number from 1 to 100',
      'f.json: limit ids must be unique ("a")',
      'f.json: limit "a" needs "service"',
      'f.json: limit "a": "window" must be "day" or "month"',
      'f.json: limit "a" needs a positive "limit"',
      'f.json: limit "a" needs an https "source"',
    ]);
    expect(checkFreeTierLimits({ alert_threshold_percent: 70, limits: [] }, 'g.json')).toEqual([
      'g.json: "limits" must be a non-empty array',
    ]);
    expect(checkFreeTierLimits(null, 'h.json')).toEqual(['h.json: must be a JSON object']);
  });
});

import { assertFiniteNumber } from './numbers.js';

/**
 * Land-area unit conversion.
 *
 *   value in target unit = value × (source unit in m²) ÷ (target unit in m²)
 *
 * Unit sizes are data (data/land-units/*.json), never hard-coded here.
 * Known answers: tools-core/test/fixtures/area-known-answers.json.
 */
export interface AreaUnit {
  id: string;
  /** Size of one unit in square metres. */
  sq_m: number;
}

export const AREA_LIMITS = {
  /** Generous upper bound on input in any unit (≈ the area of India in sq ft is 3.5e13). */
  maxValue: 1e15,
} as const;

function assertUnit(u: AreaUnit): void {
  assertFiniteNumber(u.sq_m, `unit ${u.id}`);
  if (!(u.sq_m > 0)) throw new RangeError(`unit ${u.id} must have a positive size`);
}

export function convertArea(value: number, from: AreaUnit, to: AreaUnit): number {
  assertFiniteNumber(value, 'area');
  if (value < 0 || value > AREA_LIMITS.maxValue) {
    throw new RangeError(`area must be between 0 and ${String(AREA_LIMITS.maxValue)}`);
  }
  assertUnit(from);
  assertUnit(to);
  if (from.id === to.id) return value;
  return (value * from.sq_m) / to.sq_m;
}

/** The value expressed in each of `units`, in the order given. */
export function convertToAll(
  value: number,
  from: AreaUnit,
  units: readonly AreaUnit[],
): Array<{ id: string; value: number }> {
  return units.map((u) => ({ id: u.id, value: convertArea(value, from, u) }));
}

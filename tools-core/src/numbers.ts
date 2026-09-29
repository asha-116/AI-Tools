/**
 * Shared numeric helpers for calculator formulas.
 *
 * Rules for everything in tools-core:
 * - Pure functions only: no DOM, no network, no Date.now(), no randomness.
 * - Validate inputs and throw RangeError with a clear message on bad input.
 * - Round only at the edges (display/output), never in intermediate steps.
 */

/** Throws if `value` is NaN or ±Infinity. */
export function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${String(value)}`);
  }
}

/** Throws if `value` is not a finite number ≥ 0. */
export function assertNonNegative(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be ≥ 0, got ${String(value)}`);
  }
}

/**
 * Rounds half away from zero to `decimals` places (default 2, i.e. paise).
 * Uses exponent notation to avoid binary floating-point artefacts such as
 * Math.round(1.005 * 100) === 100.
 */
export function roundTo(value: number, decimals = 2): number {
  assertFiniteNumber(value, 'value');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    throw new RangeError(`decimals must be an integer between 0 and 10, got ${String(decimals)}`);
  }
  const sign = value < 0 ? -1 : 1;
  const shifted = Number(`${String(Math.abs(value))}e${String(decimals)}`);
  const rounded = Number(`${String(Math.round(shifted))}e-${String(decimals)}`);
  return sign * rounded;
}

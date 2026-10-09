import { assertFiniteNumber } from './numbers.js';

/**
 * Carpet area vs super built-up area ("loading") and the real price per sq ft of carpet.
 *
 *   commonArea             = superBuiltUp − carpet
 *   loadingOnCarpetPercent = commonArea ÷ carpet × 100        (how most builders quote it)
 *   commonSharePercent     = commonArea ÷ superBuiltUp × 100  (the other way it is quoted)
 *   ratePerSuperBuiltUp    = totalPrice ÷ superBuiltUp
 *   ratePerCarpet          = totalPrice ÷ carpet
 *
 * Areas are in any one unit (the site uses sq ft). No rate or loading is held as data: the user
 * enters the builder's numbers.
 * Known answers: tools-core/test/fixtures/loading-known-answers.json.
 * All outputs are unrounded; round only for display.
 */
export interface LoadingInput {
  /** Usable (RERA) carpet area. */
  carpet: number;
  /** Area the price is quoted on (super built-up / saleable). */
  superBuiltUp: number;
  /** Optional total price, ₹. */
  totalPrice?: number;
}

export interface LoadingResult {
  commonArea: number;
  loadingOnCarpetPercent: number;
  commonSharePercent: number;
  ratePerSuperBuiltUp?: number;
  ratePerCarpet?: number;
}

/** How a loading % is quoted: on carpet area, or as a share of super built-up area. */
export type LoadingBase = 'carpet' | 'superBuiltUp';

export const LOADING_LIMITS = {
  maxArea: 10_000_000, // sq ft
  maxPrice: 100_000_000_000, // ₹10,000 crore
  maxLoadingPercent: 500,
} as const;

function checkArea(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value <= 0 || value > LOADING_LIMITS.maxArea) {
    throw new RangeError(`${name} must be > 0 and ≤ ${String(LOADING_LIMITS.maxArea)}`);
  }
}

export function computeLoading({ carpet, superBuiltUp, totalPrice }: LoadingInput): LoadingResult {
  checkArea(carpet, 'carpet');
  checkArea(superBuiltUp, 'superBuiltUp');
  if (carpet > superBuiltUp) {
    throw new RangeError('carpet must not be larger than superBuiltUp');
  }
  const commonArea = superBuiltUp - carpet;
  const result: LoadingResult = {
    commonArea,
    loadingOnCarpetPercent: (commonArea / carpet) * 100,
    commonSharePercent: (commonArea / superBuiltUp) * 100,
  };
  if (totalPrice !== undefined) {
    assertFiniteNumber(totalPrice, 'totalPrice');
    if (totalPrice <= 0 || totalPrice > LOADING_LIMITS.maxPrice) {
      throw new RangeError(`totalPrice must be > 0 and ≤ ${String(LOADING_LIMITS.maxPrice)}`);
    }
    result.ratePerSuperBuiltUp = totalPrice / superBuiltUp;
    result.ratePerCarpet = totalPrice / carpet;
  }
  return result;
}

/** Carpet area from super built-up area and a loading % quoted on `base`. */
export function carpetFromLoading(
  superBuiltUp: number,
  loadingPercent: number,
  base: LoadingBase,
): number {
  checkArea(superBuiltUp, 'superBuiltUp');
  assertFiniteNumber(loadingPercent, 'loadingPercent');
  const max = base === 'carpet' ? LOADING_LIMITS.maxLoadingPercent : 100;
  if (loadingPercent < 0 || (base === 'carpet' ? loadingPercent > max : loadingPercent >= max)) {
    throw new RangeError(`loadingPercent must be from 0 to below ${String(max)} for base ${base}`);
  }
  return base === 'carpet'
    ? superBuiltUp / (1 + loadingPercent / 100)
    : superBuiltUp * (1 - loadingPercent / 100);
}

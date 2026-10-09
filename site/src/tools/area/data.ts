import type { AreaUnit } from '@toolshop/tools-core';
import regional from '../../../../data/land-units/regional.json' with { type: 'json' };
import standard from '../../../../data/land-units/standard.json' with { type: 'json' };

/** One unit as the page shows it. Sizes are data (data/land-units/*.json). */
export interface PageUnit extends AreaUnit {
  label_en: string;
  label_hi: string;
  /** False until a person has checked the unit against a state source. */
  verified: boolean;
}

const withStatus = (file: { status: string; units: Omit<PageUnit, 'verified'>[] }) =>
  file.units.map((u) => ({
    id: u.id,
    sq_m: u.sq_m,
    label_en: u.label_en,
    label_hi: u.label_hi,
    verified: file.status === 'verified',
  }));

export const ALL_UNITS: PageUnit[] = [...withStatus(standard), ...withStatus(regional)];

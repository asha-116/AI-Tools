/// <reference types="vite/client" />
import type { StateRates } from '@toolshop/tools-core';

/** All state rate files, bundled at build time. Rates are data (data/stamp-duty/*.json). */
const modules = import.meta.glob<{ default: StateRates }>(
  '../../../../data/stamp-duty/[A-Z][A-Z].json',
  {
    eager: true,
  },
);

export const ALL_STATES: StateRates[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.state.localeCompare(b.state));

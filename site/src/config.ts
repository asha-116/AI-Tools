/** Build-time configuration. All values are public (they end up in the HTML). */
export const BRAND = 'ChangeLens'; // Owner decision 2026-09-29 (ADR-019).

export const config = {
  waitlistUrl: import.meta.env.PUBLIC_WAITLIST_URL ?? '',
  supportEmail: import.meta.env.PUBLIC_SUPPORT_EMAIL ?? '',
  beaconToken: import.meta.env.PUBLIC_CF_BEACON_TOKEN ?? '',
};

/** Build-time configuration. All values are public (they end up in the HTML). */
export const BRAND = 'ChangeLens'; // Owner decision 2026-09-29 (ADR-019).

export const config = {
  waitlistUrl: import.meta.env.PUBLIC_WAITLIST_URL ?? '',
  supportEmail: import.meta.env.PUBLIC_SUPPORT_EMAIL ?? '',
  /** Full URL of the payments Worker's claim endpoint (…/api/claim). Empty = page shows "not open yet". */
  claimUrl: import.meta.env.PUBLIC_CLAIM_URL ?? '',
  /** Origin of the download Worker; the page only shows links that point there. */
  downloadBaseUrl: import.meta.env.PUBLIC_DOWNLOAD_BASE_URL ?? '',
  beaconToken: import.meta.env.PUBLIC_CF_BEACON_TOKEN ?? '',
};

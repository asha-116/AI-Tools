/** Build-time configuration. All values are public (they end up in the HTML). */
export const BRAND = 'ToolShop'; // Placeholder until the owner approves a name (PROGRESS Q3).

export const config = {
  waitlistUrl: import.meta.env.PUBLIC_WAITLIST_URL ?? '',
  supportEmail: import.meta.env.PUBLIC_SUPPORT_EMAIL ?? '',
  beaconToken: import.meta.env.PUBLIC_CF_BEACON_TOKEN ?? '',
};

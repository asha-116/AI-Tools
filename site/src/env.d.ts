interface ImportMetaEnv {
  /** Full URL of the waitlist endpoint, e.g. https://toolshop-waitlist.<acct>.workers.dev/api/waitlist */
  readonly PUBLIC_WAITLIST_URL?: string;
  /** Support address shown in the privacy note. */
  readonly PUBLIC_SUPPORT_EMAIL?: string;
  /** Payments Worker claim endpoint, e.g. https://toolshop-payments.<acct>.workers.dev/api/claim */
  readonly PUBLIC_CLAIM_URL?: string;
  /** Download Worker address, e.g. https://toolshop-download.<acct>.workers.dev */
  readonly PUBLIC_DOWNLOAD_BASE_URL?: string;
  /** Cloudflare Web Analytics token (cookieless). Omit to disable analytics. */
  readonly PUBLIC_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

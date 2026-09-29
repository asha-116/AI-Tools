interface ImportMetaEnv {
  /** Full URL of the waitlist endpoint, e.g. https://toolshop-waitlist.<acct>.workers.dev/api/waitlist */
  readonly PUBLIC_WAITLIST_URL?: string;
  /** Support address shown in the privacy note. */
  readonly PUBLIC_SUPPORT_EMAIL?: string;
  /** Cloudflare Web Analytics token (cookieless). Omit to disable analytics. */
  readonly PUBLIC_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

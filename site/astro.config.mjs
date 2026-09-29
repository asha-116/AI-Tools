// @ts-check
import { defineConfig } from 'astro/config';

// SITE_URL is set by deploy.yml from the repo variable of the same name.
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  // Never inline scripts: the CSP in public/_headers only allows script files from 'self'.
  vite: {
    build: { assetsInlineLimit: 0 },
  },
  i18n: {
    locales: ['en', 'hi'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
});

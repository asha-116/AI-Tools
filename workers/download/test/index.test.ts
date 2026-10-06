import { describe, expect, it, vi } from 'vitest';
import { signDownloadToken } from '../../lib/src/token.js';
import worker from '../src/index.js';

const t = () =>
  signDownloadToken(
    {
      paymentId: 'pay_IDX',
      productId: 'lead-tracker',
      fileKey: 'lead-tracker/v1/en/lead-tracker.xlsx',
    },
    Math.floor(Date.now() / 1000) + 600,
    'secret',
  );

describe('download worker entry', () => {
  it('serves a file from the real catalog via the bound bucket', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await worker.fetch(new Request(`https://dl.example/d/${await t()}`), {
      FILES: {
        get: () => Promise.resolve({ body: new Blob(['x']).stream(), size: 1 }),
      },
      DOWNLOAD_TOKEN_SECRET: 'secret',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('changelens-lead-tracker.xlsx');
    log.mockRestore();
  });

  it('returns 500 without logging the token when storage fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const token = await t();
    for (const failure of [new Error(`boom ${token}`), 'boom']) {
      const res = await worker.fetch(new Request(`https://dl.example/d/${token}`), {
        FILES: { get: () => Promise.reject(failure) },
        DOWNLOAD_TOKEN_SECRET: 'secret',
      });
      expect(res.status).toBe(500);
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
    expect(spy).toHaveBeenCalledWith('download_error', 'unknown');
    spy.mockRestore();
  });
});

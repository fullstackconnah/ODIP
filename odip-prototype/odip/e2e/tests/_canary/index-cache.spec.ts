import { test, expect } from '@playwright/test';

// nginx caching tier: index.html must revalidate on every load (a new deploy shows on the next page load), while hashed assets stay cached
// for a year. Every response keeps the production security headers.
test.describe('nginx cache headers', () => {
  for (const path of ['/', '/index.html', '/participants', '/participants/123']) {
    test(`${path} revalidates and keeps the CSP @smoke`, async ({ request }) => {
      const res = await request.get(path);
      const h = res.headers();
      console.log(`HEADERS ${path} ${res.status()} cache-control=${h['cache-control']} csp=${h['content-security-policy'] ? 'yes' : 'NO'}`);
      expect(res.status()).toBe(200);
      expect(h['cache-control']).toContain('no-cache');
      expect(h['content-security-policy']).toContain("default-src 'self'");
    });
  }

  test('theme.js revalidates and a hashed asset is cached for a year', async ({ request }) => {
    const theme = await request.get('/theme.js');
    console.log(`HEADERS /theme.js ${theme.status()} cache-control=${theme.headers()['cache-control']}`);
    expect(theme.headers()['cache-control']).toContain('no-cache');

    const html = await (await request.get('/')).text();
    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
    expect(asset, 'index.html references a hashed /assets/*.js').toBeTruthy();
    const res = await request.get(asset!);
    console.log(`HEADERS ${asset} ${res.status()} cache-control=${res.headers()['cache-control']}`);
    expect(res.headers()['cache-control']).toContain('max-age=31536000');
  });
});

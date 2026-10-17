import { networkInterfaces } from 'node:os';
import { test, expect } from '@playwright/test';
import { BASE_URL } from '../../support/env';

// Each visitor gets their own sign-in budgets (#288): nginx trusts CF-Connecting-IP only from a hop inside 172.16.0.0/12 and sends the API
// X-Forwarded-For $remote_addr, so the API partitions by the visitor, not by the proxy or a client-supplied header.
//
// Budgets (code values): the failed-sign-in tracker locks a client after 10 failures in 15 minutes (LoginAttemptTracker.MaxFailures /
// FailureWindow), so the 11th exchange answers 429 with code LockedOut. The flood limiter ("login" policy, Program.cs) allows 60 per 5 minutes
// per client and answers 429 with an empty body. Both sit on POST /auth/exchange, the only "login" endpoint dev auth does not exempt. The token
// is not shaped like a Firebase ID token, so each call is refused (and counted) at once, with no Firebase lookup and no real account.
//
// Every source below is a fake address of its own and the tests run serially, so nothing here can throttle another spec: only this spec calls
// /auth/exchange, and each test uses its own fake CF-Connecting-IP.
//
// What this stack cannot show: every request here arrives from a Docker address (or 127.0.0.1), so "a forged CF-Connecting-IP from a non-Docker
// LAN source is ignored" is not covered here. That is the conf test (nginxHeaders.test.ts) plus the lead's live measurement (a LAN PC arrives as
// 192.168.4.119, outside the trusted range).

// No retries: a failed attempt leaves its fake source locked out, so a retry would fail for that reason rather than the real one.
test.describe.configure({ mode: 'serial', retries: 0 });

// The runner puts Playwright in the nginx container's network namespace. 127.0.0.1 is not a trusted hop, but this container's own Docker address is
// (a connection to it arrives from that same address), standing in for cloudflared's hop. Without one (a stack laid out differently), skip.
const trustedHost = Object.values(networkInterfaces()).flat()
  .find(i => i?.family === 'IPv4' && /^172\.(1[6-9]|2\d|3[01])\./.test(i.address))?.address;
const trustedUrl = trustedHost ? `http://${trustedHost}${new URL(BASE_URL).port ? ':' + new URL(BASE_URL).port : ''}` : undefined;

const MAX_FAILURES = 10;
const FLOOD_PERMITS = 60;

async function exchange(base: string, headers: Record<string, string>) {
  const res = await fetch(`${base}/api/v1/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ idToken: 'not-a-token' }),
  });
  const text = await res.text();
  return { status: res.status, text, lockedOut: text.includes('LockedOut') };
}

/** Fails sign-in from one source until the tracker locks it (429 LockedOut); returns the attempt number that was refused, or 0 after `cap`. */
async function failUntilLocked(base: string, headers: Record<string, string>, cap: number) {
  for (let n = 1; n <= cap; n++) {
    const r = await exchange(base, headers);
    if (r.status === 429) return r.lockedOut ? n : -n;
    expect(r.status, `attempt ${n}`).toBe(401);
  }
  return 0;
}

test.describe('per-visitor sign-in budgets', () => {
  test.skip(!trustedUrl, 'no trusted (172.16.0.0/12) address in this container');

  test('one visitor locking out does not lock out another', async () => {
    const a = { 'cf-connecting-ip': '203.0.113.10' };
    expect(await failUntilLocked(trustedUrl!, a, MAX_FAILURES + 5)).toBe(MAX_FAILURES + 1);

    const b = await exchange(trustedUrl!, { 'cf-connecting-ip': '203.0.113.11' });
    expect(b.status).toBe(401);
  });

  test('one visitor flooding is limited, another on the same endpoint is not', async () => {
    const c = { 'cf-connecting-ip': '203.0.113.12' };
    let floodedAt = 0;
    let flood: Awaited<ReturnType<typeof exchange>> | undefined;
    for (let n = 1; n <= FLOOD_PERMITS + 5 && !floodedAt; n++) {
      const r = await exchange(trustedUrl!, c);
      // The tracker answers 429 LockedOut from the 11th attempt; the flood limiter's refusal is the 429 with no body.
      if (r.status === 429 && !r.lockedOut) { floodedAt = n; flood = r; }
    }
    expect(floodedAt).toBe(FLOOD_PERMITS + 1);
    expect(flood?.text).toBe('');

    const d = await exchange(trustedUrl!, { 'cf-connecting-ip': '203.0.113.13' });
    expect(d.status).toBe(401);
  });

  test('a client-supplied X-Forwarded-For does not choose the budget', async () => {
    // One CF-Connecting-IP, alternating X-Forwarded-For values: nginx drops the header, so all of it is one budget and the 11th attempt is locked out.
    // Driven through the trusted hop like the tests above: the same request from BASE_URL arrives from the Docker gateway in CI (docker-proxy), which the API
    // deliberately does not count, so it could not show a budget there.
    const cf = '203.0.113.14';
    for (let n = 1; n <= MAX_FAILURES; n++) {
      const r = await exchange(trustedUrl!, { 'cf-connecting-ip': cf, 'x-forwarded-for': n % 2 ? '198.51.100.7' : '198.51.100.8' });
      expect(r.status, `attempt ${n}`).toBe(401);
    }
    const r = await exchange(trustedUrl!, { 'cf-connecting-ip': cf, 'x-forwarded-for': '198.51.100.9' });
    expect(r.status).toBe(429);
    expect(r.lockedOut).toBe(true);
  });
});

import type { Captured } from './fakeFetch.js';

/** Fake Razorpay: answers Payment Links calls with incrementing ids; records requests. */
export function fakeRazorpay() {
  const calls: Captured[] = [];
  let n = 0;
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/v1/payment_links')) {
      n += 1;
      return Response.json({ id: `plink_${n}`, short_url: `https://rzp.io/i/link${n}`, status: 'created' });
    }
    if (url.includes('/cancel')) return Response.json({ status: 'cancelled' });
    return Response.json({ ok: true });
  }) as typeof fetch;
  return { fn, calls, links: () => calls.filter((c) => c.url.endsWith('/v1/payment_links')) };
}

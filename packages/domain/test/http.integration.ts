import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.APP_TEST_URL;
if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('APP_TEST_URL deve apontar ao servidor local de teste.');
const request = (path: string, body?: unknown, cookie?: string, origin = base) => fetch(`${base}/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('fluxo HTTP: cadastro, isolamento, catálogo, origem e logout', async () => {
  for (let i = 0; i < 50; i++) {
    try { await fetch(base!); break; }
    catch { if (i === 49) throw new Error('Servidor local indisponível.'); await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.equal((await request('workspace')).status, 401);
  const signup = await request('auth/register', { email: `http-${randomUUID()}@example.test`, password: 'senha-http-com-12-caracteres', name: 'Açougue HTTP A' });
  assert.equal(signup.status, 200, await signup.text());
  const header = signup.headers.get('set-cookie')!;
  assert.match(header, /HttpOnly/i); assert.match(header, /SameSite=lax/i);
  const cookie = header.split(';')[0]!;
  const product = { name: 'Patinho de teste', sku: `TEST-${randomUUID()}`, stockUnit: 'G', amountMinor: '9007199254740993' };
  assert.equal((await request('products', product, cookie, 'https://evil.example.test')).status, 403);
  assert.equal((await request('products', { ...product, organizationId: randomUUID() }, cookie)).status, 400);
  assert.equal((await request('products', product, cookie)).status, 201);
  assert.equal((await request('products', product, cookie)).status, 409);
  const workspace = await (await request('workspace', undefined, cookie)).json();
  assert.equal(workspace.products.length, 1);
  assert.equal(workspace.products[0].amountMinor, product.amountMinor);
  const second = await request('auth/register', { email: `http-${randomUUID()}@example.test`, password: 'senha-http-com-12-caracteres', name: 'Açougue HTTP B' });
  const secondCookie = second.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await (await request('workspace', undefined, secondCookie)).json()).products.length, 0);
  assert.equal((await request('auth/logout', {}, cookie)).status, 200);
  assert.equal((await request('workspace', undefined, cookie)).status, 401);
  await request('auth/logout', {}, secondCookie);
});

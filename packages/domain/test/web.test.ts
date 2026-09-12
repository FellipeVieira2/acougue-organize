import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, normalizeEmail } from '../../../lib/auth.ts';
import { readBody, requireOrigin, strictBody } from '../../../lib/web.ts';

test('senha usa sal aleatório e validação em tempo constante', async () => {
  const first = await hashPassword('uma-senha-segura-123');
  const second = await hashPassword('uma-senha-segura-123');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('uma-senha-segura-123', first), true);
  assert.equal(await verifyPassword('senha-incorreta', first), false);
  await assert.rejects(hashPassword('curta'));
  assert.equal(await verifyPassword('qualquer', 'corrompido'), false);
});
test('e-mail normalizado e requisições rejeitam identidade arbitrária', () => {
  assert.equal(normalizeEmail(' Pessoa@Example.com '), 'pessoa@example.com');
  assert.throws(() => normalizeEmail('inválido'));
  assert.throws(() => strictBody({ name: 'Produto', actorId: 'forjado' }, ['name']));
});
test('origem e tamanho de JSON são verificados antes das operações', async () => {
  const previous = process.env.APP_URL; process.env.APP_URL = 'https://app.example.test';
  try {
    assert.throws(() => requireOrigin(new Request('https://app.example.test/api/products', { headers: { origin: 'https://evil.example.test' } })));
    requireOrigin(new Request('https://app.example.test/api/products', { headers: { origin: 'https://app.example.test' } }));
  } finally { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; }
  const request = (body: string) => new Request('https://app.example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.deepEqual(await readBody(request('{"name":"Produto"}')), { name: 'Produto' });
  await assert.rejects(readBody(request('[]')));
  await assert.rejects(readBody(request('x'.repeat(20000))));
});

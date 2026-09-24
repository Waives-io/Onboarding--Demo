import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/portal.mjs';

const dbReturning = value => ({
  prepare() {
    return {
      bind() { return this; },
      async first() { return value; },
      async all() { return { results: [] }; },
      async run() { return { success: true }; },
    };
  },
  async batch() { return []; },
});

test('health reports bridge readiness without exposing configuration', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/health'), {
    DB: dbReturning(null), PORTAL_BRIDGE_ENABLED: 'true', MAKE_WEBHOOK_URL: 'https://hook.make.com/secret',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, version: 2, storage_ready: true });
});

test('cross-origin requests are rejected before database access', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/health', {
    headers: { Origin: 'https://attacker.example' },
  }), {});
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'origin_denied' });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('preflight allows only the published site and required headers', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/portal', {
    method: 'OPTIONS', headers: { Origin: 'https://waives-io.github.io' },
  }), { DB: dbReturning(null) });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://waives-io.github.io');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, Authorization, X-Case-Token');
});

test('portal requires a valid case capability', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/portal', {
    headers: { Origin: 'https://waives-io.github.io', 'X-Case-Token': 'a'.repeat(64) },
  }), { DB: dbReturning(null) });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

test('missing database binding fails closed', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/health'), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'not_configured' });
});

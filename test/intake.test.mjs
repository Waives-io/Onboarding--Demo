import test from 'node:test';
import assert from 'node:assert/strict';
import intake from '../worker/intake.mjs';

const origin = 'https://waives-io.github.io';
const code = 'demo-code-with-at-least-32-characters';
const fields = {
  schema_version: '1', submission_id: 'aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  submitted_at: '2026-09-19T13:00:00.000Z', full_name: 'Demo Person',
  email: 'demo@example.invalid', client_reference: 'DEMO-001', period: '2026-08',
  document_type: 'bank_statement', note: 'Synthetic test', requirement_complete: 'false',
  test_mode: 'true', file_count: '1',
};

function request(changes = {}, file = new File(['%PDF-1.4\nsynthetic'], 'test.pdf', { type: 'application/pdf' }), source = origin, inviteCode = code) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...changes })) form.set(key, value);
  form.set('file_1', file);
  return new Request('https://waives-onboarding-intake.example.workers.dev/api/intake', {
    method: 'POST', headers: { Origin: source, 'X-Invite-Code': inviteCode }, body: form,
  });
}

function setup(response = new Response('Accepted')) {
  const env = {
    MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/synthetic-test',
    INTAKE_DEMO_CODE: code,
  };
  let forwarded;
  globalThis.fetch = async (_url, options) => { forwarded = options.body; return response; };
  return { env, forwarded: () => forwarded };
}

test('valid demo upload forwards one file without the access code', async () => {
  const { env, forwarded } = setup();
  const response = await intake.fetch(request(), env);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'accepted', submission_id: fields.submission_id });
  assert.equal(forwarded().get('invite_code'), null);
  assert.equal(forwarded().get('file_count'), '1');
  assert.equal(forwarded().get('file_1').name, 'test.pdf');
});

test('rejects wrong code before contacting Make', async () => {
  const { env, forwarded } = setup();
  const response = await intake.fetch(request({}, undefined, origin, 'wrong-code'), env);
  assert.equal(response.status, 403);
  assert.equal(forwarded(), undefined);
});

test('rejects a different website origin', async () => {
  const { env, forwarded } = setup();
  const response = await intake.fetch(request({}, undefined, 'https://other.example'), env);
  assert.equal(response.status, 403);
  assert.equal(forwarded(), undefined);
});

test('rejects invalid file bytes', async () => {
  const { env, forwarded } = setup();
  const response = await intake.fetch(request({}, new File(['not a PDF'], 'test.pdf', { type: 'application/pdf' })), env);
  assert.equal(response.status, 400);
  assert.equal(forwarded(), undefined);
});

test('returns stored only for a matching Make receipt', async () => {
  const { env } = setup(new Response(JSON.stringify({ status: 'stored', submission_id: fields.submission_id }), {
    headers: { 'Content-Type': 'application/json' },
  }));
  const response = await intake.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'stored');
});

test('allows the upload page preflight without disclosing the webhook', async () => {
  const { env, forwarded } = setup();
  const response = await intake.fetch(new Request('https://demo.workers.dev/api/intake', {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  }), env);
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-Invite-Code/);
  assert.equal(forwarded(), undefined);
});

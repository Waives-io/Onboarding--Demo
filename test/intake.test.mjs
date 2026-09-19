import test from 'node:test';
import assert from 'node:assert/strict';
import intake from '../netlify/functions/intake.mts';

const origin = 'https://waives-io.github.io';
const code = 'demo-code-with-at-least-32-characters';
const fields = {
  schema_version: '1', submission_id: 'aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  submitted_at: '2026-09-19T13:00:00.000Z', full_name: 'Demo Person',
  email: 'demo@example.invalid', client_reference: 'DEMO-001', period: '2026-08',
  document_type: 'bank_statement', note: 'Synthetic test', requirement_complete: 'false',
  test_mode: 'true', file_count: '1', invite_code: code,
};

function request(changes = {}, file = new File(['%PDF-1.4\nsynthetic'], 'test.pdf', { type: 'application/pdf' }), source = origin) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...changes })) form.set(key, value);
  form.set('file_1', file);
  return new Request('https://demo.netlify.app/api/intake', {
    method: 'POST', headers: { Origin: source }, body: form,
  });
}

function setup(response = new Response('Accepted')) {
  globalThis.Netlify = { env: { get: name => ({
    MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/synthetic-test',
    INTAKE_DEMO_CODE: code,
  })[name] } };
  let forwarded;
  globalThis.fetch = async (_url, options) => { forwarded = options.body; return response; };
  return () => forwarded;
}

test('valid demo upload forwards one file without the access code', async () => {
  const forwarded = setup();
  const response = await intake(request());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'accepted', submission_id: fields.submission_id });
  assert.equal(forwarded().get('invite_code'), null);
  assert.equal(forwarded().get('file_count'), '1');
  assert.equal(forwarded().get('file_1').name, 'test.pdf');
});

test('rejects wrong code before contacting Make', async () => {
  const forwarded = setup();
  const response = await intake(request({ invite_code: 'wrong-code' }));
  assert.equal(response.status, 403);
  assert.equal(forwarded(), undefined);
});

test('rejects a different website origin', async () => {
  const forwarded = setup();
  const response = await intake(request({}, undefined, 'https://other.example'));
  assert.equal(response.status, 403);
  assert.equal(forwarded(), undefined);
});

test('rejects invalid file bytes', async () => {
  const forwarded = setup();
  const response = await intake(request({}, new File(['not a PDF'], 'test.pdf', { type: 'application/pdf' })));
  assert.equal(response.status, 400);
  assert.equal(forwarded(), undefined);
});

test('returns stored only for a matching Make receipt', async () => {
  setup(new Response(JSON.stringify({ status: 'stored', submission_id: fields.submission_id }), {
    headers: { 'Content-Type': 'application/json' },
  }));
  const response = await intake(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'stored');
});

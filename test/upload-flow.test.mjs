import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/portal.mjs';
import { hash } from '../worker/domain.mjs';

const SITE = 'https://waives-io.github.io';
const CASE_TOKEN = 'c'.repeat(64);
const OFFICE_TOKEN = 'o'.repeat(64);
const env = db => ({
  DB: db, PORTAL_BRIDGE_ENABLED: 'true', MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test',
  MAKE_BRIDGE_KEY: 'k'.repeat(32), PORTAL_LINK_KEY: 'l'.repeat(32),
});

// Minimal D1 over node:sqlite with the migrations applied. batch() runs in one transaction, like D1.
// db.onPrepare(sql) lets a test inject a competing write at an exact point in a request.
function d1() {
  const raw = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) raw.exec(readFileSync(new URL(f, dir), 'utf8'));
  const prepare = sql => {
    db.onPrepare?.(sql);
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() { return raw.prepare(sql).get(...args) ?? null; },
      async all() { return { results: raw.prepare(sql).all(...args) }; },
      async run() { return s.exec(); },
      exec() { const r = raw.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
    return s;
  };
  const db = {
    raw, prepare,
    async batch(list) {
      raw.exec('BEGIN');
      try { const out = list.map(s => s.exec()); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return db;
}

async function seed(requirements = [{ id: 'req-a', required: 1, max: 1 }]) {
  const db = d1();
  db.raw.prepare("INSERT INTO clients(client_id,name,reference) VALUES ('cl1','Test Client','R1')").run();
  db.raw.prepare("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,token_hash) VALUES ('case1','cl1','Monthly','custom','2026-08','2026-10-01',?)").run(await hash(CASE_TOKEN));
  for (const [i, r] of requirements.entries())
    db.raw.prepare('INSERT INTO requirements(requirement_id,case_id,name,required,max_files,position) VALUES (?,?,?,?,?,?)').run(r.id, 'case1', r.id, r.required, r.max, i);
  db.raw.prepare('INSERT INTO sessions VALUES (?,?)').run(await hash(OFFICE_TOKEN), Date.now() + 3600000);
  return db;
}

const receiptFor = (submission_id, drive_file_id = 'file-' + submission_id.slice(0, 8)) =>
  ({ status: 'stored', submission_id, drive_file_id, drive_folder_id: 'folder-1', sheet_updated: true });

// Replaces Make. handler(form) returns a receipt object, or throws to simulate a network failure.
function mockMake(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(init.body);
    const out = await handler(init.body);
    return new Response(JSON.stringify(out), { status: 200 });
  });
  return calls;
}

async function call(e, path, { method = 'GET', data, office = false } = {}) {
  const headers = { Origin: SITE };
  if (office) headers.Authorization = 'Bearer ' + OFFICE_TOKEN; else headers['X-Case-Token'] = CASE_TOKEN;
  let body;
  if (data instanceof FormData) body = data;
  else if (data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
  const res = await worker.fetch(new Request('https://worker.example' + path, { method, headers, body }), e);
  return { status: res.status, body: await res.json() };
}

function upload(e, requirement_id, submission_id = crypto.randomUUID(), content = 'one') {
  const form = new FormData();
  form.set('file', new File(['%PDF-1.4 ' + content], content + '.pdf', { type: 'application/pdf' }));
  form.set('requirement_id', requirement_id);
  form.set('submission_id', submission_id);
  return call(e, '/api/portal/uploads', { method: 'POST', data: form }).then(r => ({ ...r, submission_id }));
}

const row = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const uploadState = (db, id) => row(db, 'SELECT state FROM uploads WHERE submission_id=?', id).state;
const caseRow = db => row(db, "SELECT status,client_completed_at FROM cases WHERE case_id='case1'");
const reqStatus = (db, id = 'req-a') => row(db, 'SELECT status FROM requirements WHERE requirement_id=?', id).status;
const eventCount = (db, action) => row(db, 'SELECT count(*) n FROM events WHERE action=?', action).n;

// Finding 1: an upload stuck in pending must not block the requirement forever.

test('upload is refused before any row is written when the bridge is not configured', async () => {
  const db = await seed();
  const e = { ...env(db), MAKE_BRIDGE_KEY: undefined };
  const r = await upload(e, 'req-a');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'integration_not_ready');
  assert.equal(row(db, 'SELECT count(*) n FROM uploads').n, 0);
});

test('an explicit Make failure marks the upload failed and a retry becomes a new submission', async t => {
  const db = await seed(), e = env(db);
  let fail = true;
  mockMake(t, form => fail ? { status: 'failed', submission_id: form.get('submission_id') } : receiptFor(form.get('submission_id')));
  const first = await upload(e, 'req-a');
  assert.equal(first.status, 502);
  assert.equal(first.body.error, 'storage_failed');
  assert.equal(uploadState(db, first.submission_id), 'failed');
  assert.equal(eventCount(db, 'upload_failed'), 1);
  fail = false;
  const retry = await upload(e, 'req-a', first.submission_id);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'stored');
  assert.notEqual(retry.body.submission_id, first.submission_id);
  assert.equal(uploadState(db, first.submission_id), 'failed');
  assert.equal(uploadState(db, retry.body.submission_id), 'stored');
  assert.equal(reqStatus(db), 'uploaded');
});

test('a late receipt for an expired attempt cannot be credited to its retry', async t => {
  const db = await seed(), e = env(db);
  let mode = 'down';
  mockMake(t, form => { if (mode === 'down') throw new Error('timeout'); return receiptFor(form.get('submission_id'), 'file-retry'); });
  const a = await upload(e, 'req-a');
  db.raw.prepare('UPDATE uploads SET created_at=? WHERE submission_id=?').run(new Date(Date.now() - 16 * 60000).toISOString(), a.submission_id);
  const b = await upload(e, 'req-a', a.submission_id);
  assert.equal(b.body.status, 'pending');
  assert.notEqual(b.body.submission_id, a.submission_id);
  const late = await worker.fetch(new Request('https://worker.example/api/storage-receipt', {
    method: 'POST', headers: { 'X-Bridge-Key': e.MAKE_BRIDGE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(receiptFor(a.submission_id, 'file-attempt-a')),
  }), e);
  assert.equal(late.status, 200);
  assert.equal(uploadState(db, a.submission_id), 'stored');
  assert.equal(uploadState(db, b.body.submission_id), 'pending');
  assert.equal(reqStatus(db), 'missing');
  assert.equal(eventCount(db, 'upload_stored_late'), 1);
});

test('office reconcile marks a lost upload failed and unblocks the client', async t => {
  const db = await seed(), e = env(db);
  let mode = 'down';
  mockMake(t, form => {
    if (mode === 'down') throw new Error('network');
    if (form.get('action') === 'lookup_submission') return { status: 'not_found', submission_id: form.get('submission_id') };
    return receiptFor(form.get('submission_id'));
  });
  const lost = await upload(e, 'req-a');
  assert.equal(lost.body.status, 'pending');
  assert.equal((await upload(e, 'req-a')).body.error, 'upload_pending');
  mode = 'up';
  const early = await call(e, '/api/cases/case1/reconcile', { method: 'POST', data: { submission_id: lost.submission_id }, office: true });
  assert.deepEqual(early.body, { ok: true, state: 'pending' });
  db.raw.prepare('UPDATE uploads SET created_at=? WHERE submission_id=?').run(new Date(Date.now() - 3 * 60000).toISOString(), lost.submission_id);
  const rec = await call(e, '/api/cases/case1/reconcile', { method: 'POST', data: { submission_id: lost.submission_id }, office: true });
  assert.deepEqual(rec.body, { ok: true, state: 'failed' });
  const next = await upload(e, 'req-a', undefined, 'two');
  assert.equal(next.body.status, 'stored');
});

test('a pending upload older than the timeout is released on the next read', async t => {
  const db = await seed(), e = env(db);
  mockMake(t, () => { throw new Error('timeout'); });
  const lost = await upload(e, 'req-a');
  assert.equal(uploadState(db, lost.submission_id), 'pending');
  db.raw.prepare('UPDATE uploads SET created_at=? WHERE submission_id=?').run(new Date(Date.now() - 16 * 60000).toISOString(), lost.submission_id);
  const view = await call(e, '/api/portal');
  assert.equal(view.body.requirements[0].uploads[0].state, 'failed');
  assert.equal(eventCount(db, 'upload_failed'), 1);
});

test('a fresh pending upload is not released early', async t => {
  const db = await seed(), e = env(db);
  mockMake(t, () => { throw new Error('timeout'); });
  const lost = await upload(e, 'req-a');
  await call(e, '/api/portal');
  assert.equal(uploadState(db, lost.submission_id), 'pending');
});

// Finding 2: two receipts for one submission must not undo the office decision.

test('a second receipt that races an office approval does not revert it', async t => {
  const db = await seed(), e = env(db);
  const bridgeKey = e.MAKE_BRIDGE_KEY;
  mockMake(t, async form => {
    const receipt = receiptFor(form.get('submission_id'));
    // Make's callback lands while the upload request is still waiting for Make's response.
    const cb = await worker.fetch(new Request('https://worker.example/api/storage-receipt', {
      method: 'POST', headers: { 'X-Bridge-Key': bridgeKey, 'Content-Type': 'application/json' }, body: JSON.stringify(receipt),
    }), e);
    assert.equal(cb.status, 200);
    const approve = await call(e, '/api/cases/case1/review', { method: 'POST', data: { requirement_id: 'req-a', status: 'approved' }, office: true });
    assert.equal(approve.status, 200);
    return receipt;
  });
  const r = await upload(e, 'req-a');
  assert.equal(r.body.status, 'stored');
  assert.equal(reqStatus(db), 'approved');
  assert.equal(caseRow(db).status, 'ready_for_work');
  assert.equal(eventCount(db, 'upload_stored'), 1);
});

test('a receipt with a different Drive file for a stored upload is a conflict', async t => {
  const db = await seed(), e = env(db);
  mockMake(t, form => receiptFor(form.get('submission_id')));
  const r = await upload(e, 'req-a');
  const res = await worker.fetch(new Request('https://worker.example/api/storage-receipt', {
    method: 'POST', headers: { 'X-Bridge-Key': e.MAKE_BRIDGE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(receiptFor(r.submission_id, 'file-other')),
  }), e);
  assert.equal(res.status, 409);
  assert.equal(row(db, 'SELECT drive_file_id FROM uploads WHERE submission_id=?', r.submission_id).drive_file_id, 'file-' + r.submission_id.slice(0, 8));
});

test('a late receipt for a failed upload records the file without touching an approval', async t => {
  const db = await seed([{ id: 'req-a', required: 1, max: 2 }]), e = env(db);
  let fail = true;
  mockMake(t, form => fail ? { status: 'failed', submission_id: form.get('submission_id') } : receiptFor(form.get('submission_id')));
  const failed = await upload(e, 'req-a');
  fail = false;
  await upload(e, 'req-a', undefined, 'two');
  await call(e, '/api/cases/case1/review', { method: 'POST', data: { requirement_id: 'req-a', status: 'approved' }, office: true });
  const res = await worker.fetch(new Request('https://worker.example/api/storage-receipt', {
    method: 'POST', headers: { 'X-Bridge-Key': e.MAKE_BRIDGE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(receiptFor(failed.submission_id)),
  }), e);
  assert.equal(res.status, 200);
  assert.equal(uploadState(db, failed.submission_id), 'stored');
  assert.equal(reqStatus(db), 'approved');
  assert.equal(eventCount(db, 'upload_stored_late'), 1);
});

test('an approval that lands after the upload checks blocks the upload claim', async t => {
  const db = await seed([{ id: 'req-a', required: 1, max: 2 }]), e = env(db);
  const calls = mockMake(t, form => receiptFor(form.get('submission_id')));
  await upload(e, 'req-a');
  db.onPrepare = sql => { if (sql.startsWith('INSERT INTO uploads')) { db.onPrepare = null; db.raw.prepare("UPDATE requirements SET status='approved' WHERE requirement_id='req-a'").run(); } };
  const r = await upload(e, 'req-a', undefined, 'two');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'already_approved');
  assert.equal(calls.length, 1);
  assert.equal(reqStatus(db), 'approved');
});

test('an upload claimed after the review checks blocks the review', async t => {
  const db = await seed([{ id: 'req-a', required: 1, max: 2 }]), e = env(db);
  mockMake(t, form => receiptFor(form.get('submission_id')));
  await upload(e, 'req-a');
  db.onPrepare = sql => { if (sql.startsWith('INSERT INTO events') && sql.includes('NOT EXISTS')) { db.onPrepare = null; db.raw.prepare("INSERT INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version) VALUES ('racing-upload','req-a','x.pdf','application/pdf',9,'h',9)").run(); } };
  const r = await call(e, '/api/cases/case1/review', { method: 'POST', data: { requirement_id: 'req-a', status: 'approved' }, office: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'upload_pending');
  assert.equal(reqStatus(db), 'uploaded');
  assert.equal(eventCount(db, 'approved'), 0);
});

// Finding 4: only the client's "finished" action marks the case client_completed.

test('uploading a correction does not mark the case completed by itself', async t => {
  const db = await seed(), e = env(db);
  mockMake(t, form => receiptFor(form.get('submission_id')));
  await upload(e, 'req-a');
  await call(e, '/api/portal/complete', { method: 'POST' });
  await call(e, '/api/cases/case1/review', { method: 'POST', data: { requirement_id: 'req-a', status: 'correction', message: 'Wrong month' }, office: true });
  assert.equal(caseRow(db).status, 'action_required');
  const fix = await upload(e, 'req-a', undefined, 'fixed');
  assert.equal(fix.body.status, 'stored');
  assert.deepEqual({ ...caseRow(db) }, { status: 'collecting', client_completed_at: null });
  await call(e, '/api/portal/complete', { method: 'POST' });
  assert.equal(caseRow(db).status, 'client_completed');
});

test('an extra optional upload after "finished" keeps the case completed', async t => {
  const db = await seed([{ id: 'req-a', required: 1, max: 1 }, { id: 'req-opt', required: 0, max: 1 }]), e = env(db);
  mockMake(t, form => receiptFor(form.get('submission_id')));
  await upload(e, 'req-a');
  await call(e, '/api/portal/complete', { method: 'POST' });
  assert.equal(caseRow(db).status, 'client_completed');
  await upload(e, 'req-opt', undefined, 'optional');
  assert.equal(reqStatus(db, 'req-opt'), 'uploaded');
  assert.equal(caseRow(db).status, 'client_completed');
  assert.notEqual(caseRow(db).client_completed_at, null);
});

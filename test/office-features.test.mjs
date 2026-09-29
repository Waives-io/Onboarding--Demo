import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/portal.mjs';
import { hash, caseToken, localDate } from '../worker/domain.mjs';
import { d1 } from './support.mjs';

const SITE = 'https://waives-io.github.io';
const OFFICE_TOKEN = 'o'.repeat(64);
const KEY = 'l'.repeat(32);
const env = db => ({ DB: db, PORTAL_LINK_KEY: KEY, PORTAL_BRIDGE_ENABLED: 'true' });
const addDays = n => { const d = new Date(localDate() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function seed({ phone = '050-123-4567', due = addDays(30) } = {}) {
  const db = d1();
  db.raw.prepare("INSERT INTO clients(client_id,name,reference,phone) VALUES ('cl1','Test Client','R1',?)").run(phone);
  db.raw.prepare("INSERT INTO clients(client_id,name,reference) VALUES ('cl2','Other','R2')").run();
  db.raw.prepare("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,token_hash) VALUES ('case1','cl1','Monthly','custom','2026-08',?,?)").run(due, await hash(await caseToken('case1', KEY)));
  db.raw.prepare("INSERT INTO requirements(requirement_id,case_id,name,required,max_files,position) VALUES ('r1','case1','Bank',1,1,0),('r2','case1','Sales',1,1,1),('r3','case1','Extra',0,1,2)").run();
  db.raw.prepare('INSERT INTO sessions VALUES (?,?)').run(await hash(OFFICE_TOKEN), Date.now() + 3600000);
  return db;
}
async function call(e, path, { method = 'GET', data, auth = 'office', caseToken: ct } = {}) {
  const headers = { Origin: SITE };
  if (auth === 'office') headers.Authorization = 'Bearer ' + OFFICE_TOKEN;
  if (ct) headers['X-Case-Token'] = ct;
  let body;
  if (data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
  const res = await worker.fetch(new Request('https://worker.example' + path, { method, headers, body }), e);
  return { status: res.status, res, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

test('case list carries progress, deadline and a WhatsApp number', async () => {
  const db = await seed({ due: addDays(1) }), e = env(db);
  db.raw.prepare("UPDATE requirements SET status='uploaded' WHERE requirement_id='r1'").run();
  const r = await call(e, '/api/cases');
  assert.equal(r.status, 200);
  const [c] = r.body;
  assert.equal(c.token_hash, undefined);
  assert.equal(c.link_version, undefined);
  assert.deepEqual([c.progress_kind, c.progress_done, c.progress_total], ['sent', 1, 2]);
  assert.deepEqual([c.deadline, c.days_left], ['urgent', 1]);
  assert.equal(c.whatsapp, '972501234567');
});

test('deadline thresholds come from office settings', async () => {
  const db = await seed({ due: addDays(10) }), e = env(db);
  assert.equal((await call(e, '/api/cases')).body[0].deadline, 'ok');
  const s = await call(e, '/api/settings', { method: 'POST', data: { office_name: 'משרד בדיקה', warning_days: 14, urgent_days: 3 } });
  assert.equal(s.status, 200);
  assert.equal((await call(e, '/api/cases')).body[0].deadline, 'warning');
});

test('settings reject bad thresholds and unknown placeholders', async () => {
  const e = env(await seed());
  assert.equal((await call(e, '/api/settings', { method: 'POST', data: { warning_days: 2, urgent_days: 2 } })).body.error, 'invalid_deadline_days');
  assert.equal((await call(e, '/api/settings', { method: 'POST', data: { warning_days: 7, urgent_days: 2, whatsapp_template: 'hi {secret}' } })).body.error, 'invalid_template_placeholder');
  assert.equal((await call(e, '/api/settings', { method: 'POST', data: { warning_days: 7, urgent_days: 2, whatsapp_template: 'hi {client-name}' } })).body.error, 'invalid_template_placeholder');
});

test('reminder uses the office template and the client mobile number', async () => {
  const e = env(await seed());
  await call(e, '/api/settings', { method: 'POST', data: { office_name: 'משרד כהן', warning_days: 7, urgent_days: 2, whatsapp_template: 'היי {client}, חסר:\n{missing}\n{link}\n{office}' } });
  const r = await call(e, '/api/cases/case1/reminder', { method: 'POST', data: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.whatsapp, '972501234567');
  assert.match(r.body.text, /^היי Test Client, חסר:\n• Bank\n• Sales\n/);
  assert.doesNotMatch(r.body.text, /Extra/);
  assert.match(r.body.text, /משרד כהן$/);
});

test('a client can be edited and the reference stays unique', async () => {
  const e = env(await seed());
  const ok = await call(e, '/api/clients/cl1', { method: 'POST', data: { name: 'Renamed', reference: 'R1', phone: '0521112233', email: 'a@b.co' } });
  assert.equal(ok.status, 200);
  assert.equal((await call(e, '/api/clients')).body.find(c => c.client_id === 'cl1').name, 'Renamed');
  const dup = await call(e, '/api/clients/cl1', { method: 'POST', data: { name: 'X', reference: 'R2' } });
  assert.equal(dup.body.error, 'duplicate_reference');
  assert.equal((await call(e, '/api/clients/nope', { method: 'POST', data: { name: 'X', reference: 'R9' } })).status, 404);
});

test('revoking a link locks out the old one and the new one works', async () => {
  const e = env(await seed());
  const old = await caseToken('case1', KEY);
  assert.equal((await call(e, '/api/portal', { auth: 'none', caseToken: old })).status, 200);
  const r = await call(e, '/api/cases/case1/revoke-link', { method: 'POST', data: {} });
  const fresh = r.body.link.split('#')[1];
  assert.notEqual(fresh, old);
  assert.equal((await call(e, '/api/portal', { auth: 'none', caseToken: old })).status, 401);
  assert.equal((await call(e, '/api/portal', { auth: 'none', caseToken: fresh })).status, 200);
  assert.equal((await call(e, '/api/cases/case1/link')).body.link.split('#')[1], fresh);
});

test('client portal gets progress but not office-only fields', async () => {
  const e = env(await seed());
  const r = await call(e, '/api/portal', { auth: 'none', caseToken: await caseToken('case1', KEY) });
  assert.equal(r.body.progress_kind, 'sent');
  for (const k of ['phone', 'email', 'whatsapp', 'link_version', 'events']) assert.equal(r.body[k], undefined, k);
});

test('logo accepts only real PNG or JPEG and is served publicly', async () => {
  const e = env(await seed());
  const bad = await call(e, '/api/settings/logo', { method: 'POST', data: { data: Buffer.from('<svg onload=x>').toString('base64') } });
  assert.equal(bad.body.error, 'invalid_file_signature');
  const ok = await call(e, '/api/settings/logo', { method: 'POST', data: { data: PNG } });
  assert.equal(ok.body.logo_version, 1);
  const img = await call(e, '/api/logo', { auth: 'none' });
  assert.equal(img.res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.res.arrayBuffer()), Buffer.from(PNG, 'base64'));
  assert.deepEqual((await call(e, '/api/branding', { auth: 'none' })).body, { office_name: '', logo_version: 1 });
});

test('settings require an office session', async () => {
  const e = env(await seed());
  assert.equal((await call(e, '/api/settings', { auth: 'none' })).status, 401);
  assert.equal((await call(e, '/api/settings/logo', { method: 'POST', auth: 'none', data: { data: PNG } })).status, 401);
});

test('a document typed inside a template joins the library once', async () => {
  const db = await seed(), e = env(db);
  const r = await call(e, '/api/templates', { method: 'POST', data: { name: 'תבנית בדיקה', items: [
    { document_id: 'bank', required: true, max_files: 1 },
    { name: 'אישור ניכוי במקור', required: true, max_files: 1 },
    { name: 'דוח מכירות', required: false, max_files: 3 },
  ] } });
  assert.equal(r.status, 200);
  const lib = db.raw.prepare("SELECT document_id FROM document_catalog WHERE name='אישור ניכוי במקור'").all();
  assert.equal(lib.length, 1);
  assert.equal(db.raw.prepare("SELECT document_id FROM template_items WHERE template_id=? AND position=2").get(r.body.template_id).document_id, 'sales');
  const dup = await call(e, '/api/templates', { method: 'POST', data: { name: 'x', items: [{ document_id: 'bank', required: true, max_files: 1 }, { name: 'תדפיס בנק', required: true, max_files: 1 }] } });
  assert.equal(dup.body.error, 'duplicate_document');
  const again = await call(e, '/api/templates', { method: 'POST', data: { name: 'y', items: [{ name: 'אישור ניכוי במקור', required: true, max_files: 1 }] } });
  assert.equal(again.status, 200);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM document_catalog WHERE name='אישור ניכוי במקור'").get().n, 1);
});

test('a case period is a validated date range', async () => {
  const e = env(await seed());
  const base = { client_id: 'cl2', name: 'חודשי', type: 'הנהלת חשבונות', due_date: addDays(20), requirements: [{ name: 'Bank', required: true, max_files: 1 }] };
  const ok = await call(e, '/api/cases', { method: 'POST', data: { ...base, period_start: '2026-09-01', period_end: '2026-09-30' } });
  assert.equal(ok.status, 200);
  const c = (await call(e, '/api/cases')).body.find(x => x.case_id === ok.body.case_id);
  assert.deepEqual([c.reporting_period, c.period_start, c.period_end], ['01/09/2026–30/09/2026', '2026-09-01', '2026-09-30']);
  assert.equal((await call(e, '/api/cases', { method: 'POST', data: { ...base, period_start: '2026-09-30', period_end: '2026-09-01' } })).body.error, 'invalid_period');
});

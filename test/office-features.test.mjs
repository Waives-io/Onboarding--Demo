import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/portal.mjs';
import { hash, caseToken, localDate } from '../worker/domain.mjs';
import { d1 } from './support.mjs';

const SITE = 'https://waives-io.github.io';
const OFFICE_TOKEN = 'e'.repeat(64);
const KEY = 'l'.repeat(32);
const env = db => ({ DB: db, PORTAL_LINK_KEY: KEY, PORTAL_BRIDGE_ENABLED: 'true' });
const addDays = n => { const d = new Date(localDate() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function seed({ phone = '050-123-4567', due = addDays(30) } = {}) {
  const db = d1();
  db.raw.prepare("INSERT INTO clients(client_id,name,reference,phone) VALUES ('cl1','Test Client','R1',?)").run(phone);
  db.raw.prepare("INSERT INTO clients(client_id,name,reference) VALUES ('cl2','Other','R2')").run();
  db.raw.prepare("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,token_hash) VALUES ('case1','cl1','Monthly','custom','2026-08',?,?)").run(due, await hash(await caseToken('case1', KEY)));
  db.raw.prepare("INSERT INTO requirements(requirement_id,case_id,name,required,max_files,position) VALUES ('r1','case1','Bank',1,1,0),('r2','case1','Sales',1,1,1),('r3','case1','Extra',0,1,2)").run();
  db.raw.prepare("INSERT INTO staff(staff_id,name,email,role,pw) VALUES ('admin1','Admin','admin@x.test','admin','-')").run();
  db.raw.prepare('INSERT INTO sessions(token_hash,expires_at,staff_id) VALUES (?,?,?)').run(await hash(OFFICE_TOKEN), Date.now() + 3600000, 'admin1');
  return db;
}
async function call(e, path, { method = 'GET', data, auth = 'office', caseToken: ct } = {}) {
  const headers = { Origin: SITE };
  if (auth === 'office') headers.Authorization = 'Bearer ' + OFFICE_TOKEN;
  if (ct) { headers['X-Case-Token'] = ct; headers['X-Case-Pin'] = '4567'; }
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
  assert.match(r.body.text, /משרד כהן\nלכניסה: 4 הספרות האחרונות של הנייד שלך\.$/);
});

test('a client can be edited, and the internal client number never changes', async () => {
  const db = await seed(), e = env(db);
  const ok = await call(e, '/api/clients/cl1', { method: 'POST', data: { name: 'Renamed', reference: 'R2', phone: '0521112233', email: 'a@b.co' } });
  assert.equal(ok.status, 200);
  const c = (await call(e, '/api/clients')).body.find(c => c.client_id === 'cl1');
  assert.deepEqual([c.name, c.reference], ['Renamed', 'R1']);
  assert.equal((await call(e, '/api/clients/nope', { method: 'POST', data: { name: 'X', phone: '0521112233', email: 'a@b.co' } })).status, 404);
});

test('a new client gets the next client number by itself', async () => {
  const db = await seed(), e = env(db), data = { name: 'N', phone: '0521112233', email: 'a@b.co' };
  assert.equal((await call(e, '/api/clients', { method: 'POST', data })).body.reference, 'C-1001');
  db.raw.prepare("INSERT INTO clients(client_id,name,reference) VALUES ('x','X','C-1050')").run();
  assert.equal((await call(e, '/api/clients', { method: 'POST', data: { ...data, reference: 'C-1001' } })).body.reference, 'C-1051');
  // Someone else takes the number between the read and the insert: the next one is used.
  db.onPrepare = sql => { if (sql.startsWith('INSERT INTO clients')) { db.onPrepare = null; db.raw.prepare("INSERT INTO clients(client_id,name,reference) VALUES ('y','Y','C-1052')").run(); } };
  assert.equal((await call(e, '/api/clients', { method: 'POST', data })).body.reference, 'C-1053');
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

test('an impossible date is a clear error, not a crash', async () => {
  const e = env(await seed());
  const r = await call(e, '/api/cases', { method: 'POST', data: { client_id: 'cl2', name: 'x', type: 't', due_date: addDays(5), period_start: '2026-99-99', period_end: '2026-99-99', requirements: [{ name: 'A', required: true, max_files: 1 }] } });
  assert.deepEqual([r.status, r.body.error], [400, 'invalid_period']);
});

test('a client needs a valid email and a reachable phone', async () => {
  const db = await seed(), e = env(db);
  const base = { name: 'New', reference: 'R7', phone: '0521112233', email: 'a@b.co' };
  assert.equal((await call(e, '/api/clients', { method: 'POST', data: { ...base, email: '' } })).body.error, 'invalid_fields');
  assert.equal((await call(e, '/api/clients', { method: 'POST', data: { ...base, email: 'not-an-email' } })).body.error, 'invalid_email');
  assert.equal((await call(e, '/api/clients', { method: 'POST', data: { ...base, phone: '' } })).body.error, 'invalid_fields');
  for (const phone of ['03-1234567', '12345', '050-12'])
    assert.equal((await call(e, '/api/clients', { method: 'POST', data: { ...base, phone } })).body.error, 'invalid_phone', phone);
  for (const [i, phone] of ['050-123-4567', '+972 52 111 2233', '+44 20 7946 0958'].entries())
    assert.equal((await call(e, '/api/clients', { method: 'POST', data: { ...base, reference: 'OK' + i, phone } })).status, 200, phone);
  assert.equal((await call(e, '/api/clients/cl1', { method: 'POST', data: { name: 'Test Client', reference: 'R1', email: 'a@b.co', phone: '' } })).body.error, 'invalid_fields');
});

test('a case loaded without a link gets one the first time the office asks', async () => {
  const db = await seed(), e = env(db);
  db.raw.prepare("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,token_hash,link_version) VALUES ('seeded','cl1','Seeded','custom','p','2026-12-01','unissued-seeded',0)").run();
  db.raw.prepare("INSERT INTO requirements(requirement_id,case_id,name,required,max_files,position) VALUES ('s1','seeded','Bank',1,1,0)").run();
  const first = (await call(e, '/api/cases/seeded/link')).body.link;
  assert.equal((await call(e, '/api/cases/seeded/link')).body.link, first);
  const token = first.split('#')[1];
  const portal = await call(e, '/api/portal', { auth: 'none', caseToken: token });
  assert.equal(portal.status, 200);
  assert.equal(portal.body.name, 'Seeded');
  // The placeholder never opens anything.
  assert.equal((await call(e, '/api/portal', { auth: 'none', caseToken: 'unissued-seeded' })).status, 401);
});

test('a client file keeps a contact person and its regular document list', async () => {
  const db = await seed(), e = env(db);
  db.raw.prepare("INSERT INTO templates VALUES ('t-monthly','חודשי') ON CONFLICT DO NOTHING").run();
  const base = { name: 'נגריית הזית', phone: '0521112233', email: 'a@b.co', contact_name: 'דנה', regular_template_id: 't-monthly' };
  const r = await call(e, '/api/clients', { method: 'POST', data: base });
  assert.equal(r.status, 200);
  const c = (await call(e, '/api/clients')).body.find(x => x.client_id === r.body.client_id);
  assert.deepEqual([c.contact_name, c.regular_template_id], ['דנה', 't-monthly']);
  assert.equal((await call(e, '/api/clients', { method: 'POST', data: { ...base, regular_template_id: 'nope' } })).body.error, 'template_not_found');
  assert.equal((await call(e, '/api/clients/' + r.body.client_id, { method: 'POST', data: { ...base, regular_template_id: '' } })).status, 200);
  assert.equal(db.raw.prepare('SELECT regular_template_id FROM clients WHERE client_id=?').get(r.body.client_id).regular_template_id, null);
  const csv = (await call(e, '/api/csv/export', { method: 'POST', data: { entity: 'clients' } })).body.csv;
  assert.ok(csv.split('\r\n')[0].includes('"contact_name"') && csv.includes('"דנה"'));
});

test('reminders greet the contact person and name the case', async () => {
  const db = await seed(), e = env(db);
  db.raw.prepare("UPDATE clients SET contact_name='דנה' WHERE client_id='cl1'").run();
  const r = await call(e, '/api/cases/case1/reminder', { method: 'POST', data: {} });
  assert.ok(r.body.text.startsWith('שלום דנה,'));
  assert.ok(r.body.text.includes('לתיק Monthly'));
  // A template saved with the old {case} placeholder still works.
  await call(e, '/api/settings', { method: 'POST', data: { office_name: 'x', warning_days: 7, urgent_days: 2, whatsapp_template: '{client}: {case} / {request}' } });
  assert.equal((await call(e, '/api/cases/case1/reminder', { method: 'POST', data: {} })).body.text, 'דנה: Monthly / Monthly\nלכניסה: 4 הספרות האחרונות של הנייד שלך.');
});

test('progress counts received and approved documents the same way in every state', async () => {
  const db = await seed(), e = env(db);
  const counts = async () => { const [c] = (await call(e, '/api/cases')).body; const v = (await call(e, '/api/cases/case1')).body; assert.deepEqual([v.docs_received, v.docs_approved, v.docs_total], [c.docs_received, c.docs_approved, c.docs_total]); return [c.docs_received, c.docs_approved, c.docs_total]; };
  // The untouched optional document does not count.
  assert.deepEqual(await counts(), [0, 0, 2]);
  db.raw.prepare("UPDATE requirements SET status='uploaded' WHERE requirement_id IN ('r1','r2')").run();
  assert.deepEqual(await counts(), [2, 0, 2]);
  // An optional document the client sent joins the count; an approved one is both received and approved.
  db.raw.prepare("UPDATE requirements SET status='uploaded' WHERE requirement_id='r3'").run();
  db.raw.prepare("UPDATE requirements SET status='approved' WHERE requirement_id='r1'").run();
  assert.deepEqual(await counts(), [3, 1, 3]);
  // A correction is not received until the fixed file comes in.
  db.raw.prepare("UPDATE requirements SET status='correction' WHERE requirement_id='r2'").run();
  assert.deepEqual(await counts(), [2, 1, 3]);
});

test('the reminder names the period in words and keeps a date range in reading order', async () => {
  const db = await seed(), e = env(db);
  await call(e, '/api/settings', { method: 'POST', data: { office_name: 'X', warning_days: 7, urgent_days: 2, whatsapp_template: '{period}' } });
  const period = async (a, b) => { db.raw.prepare('UPDATE cases SET period_start=?,period_end=? WHERE case_id=?').run(a, b, 'case1'); return (await call(e, '/api/cases/case1/reminder', { method: 'POST', data: {} })).body.text.split('\n')[0]; };
  assert.equal(await period('2025-01-01', '2025-12-31'), '2025');
  assert.equal(await period('2026-08-01', '2026-08-31'), 'אוגוסט 2026');
  assert.equal(await period('2026-01-15', '2026-02-10'), '\u206615/01/2026–10/02/2026\u2069');
  // An old free-text period is kept as written, isolated left-to-right.
  assert.equal(await period(null, null), '\u20662026-08\u2069');
});

test('a new case has its own opening message, separate from the reminder', async () => {
  const db = await seed(), e = env(db);
  await call(e, '/api/settings', { method: 'POST', data: { office_name: 'משרד כהן', warning_days: 7, urgent_days: 2, whatsapp_template: 'זו תזכורת: {missing}' } });
  db.raw.prepare("UPDATE cases SET due_date='2026-10-04' WHERE case_id='case1'").run();
  const r = await call(e, '/api/cases/case1/opening');
  assert.equal(r.status, 200);
  const lines = r.body.text.split('\n');
  assert.equal(lines[0], 'שלום Test Client,');
  assert.equal(lines[1], 'פתחנו עבורך תיק: Monthly.');
  assert.deepEqual(lines.slice(3, 5), ['• Bank', '• Sales']);
  assert.match(r.body.text, /להעלאת המסמכים: https:\/\/waives-io\.github\.io\/Onboarding--Demo\/client\.html#[0-9a-f]{64}\nעד 04\/10\nלכניסה: 4 הספרות האחרונות של הנייד שלך\.\nמשרד כהן$/);
  // The office's reminder wording never leaks into the opening message, and opening it records no reminder.
  assert.doesNotMatch(r.body.text, /תזכורת/);
  const view = await call(e, '/api/cases/case1');
  assert.equal(view.body.events.some(x => x.action === 'reminder_prepared'), false);
});

test('opening and reminder emails go through Make and are recorded only when Make confirms', async t => {
  const db = await seed(), e = { ...env(db), MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test', MAKE_BRIDGE_KEY: 'k'.repeat(32), PORTAL_BRIDGE_ENABLED: 'true' };
  db.raw.prepare("UPDATE clients SET email='dana@example.com',contact_name='דנה' WHERE client_id='cl1'").run();
  await call(e, '/api/settings', { method: 'POST', data: { office_name: 'משרד כהן', email: 'office@example.com', warning_days: 7, urgent_days: 2 } });
  let sent = [], reply = form => ({ status: 'sent', send_id: form.get('send_id') });
  t.mock.method(globalThis, 'fetch', async (url, init) => { const form = init.body; sent.push(Object.fromEntries(form)); return new Response(JSON.stringify(reply(form)), { headers: { 'content-type': 'application/json' } }); });
  const r = await call(e, '/api/cases/case1/email', { method: 'POST', data: { kind: 'opening' } });
  assert.deepEqual(r.body, { sent: true, to: 'dana@example.com' });
  const [m] = sent;
  assert.equal(m.action, 'send_email'); assert.equal(m.bridge_key, 'k'.repeat(32)); assert.equal(m.to, 'dana@example.com'); assert.equal(m.reply_to, 'office@example.com');
  assert.equal(m.subject, 'מסמכים לתיק Monthly · משרד כהן');
  assert.match(m.html, /^<div dir="rtl"/); assert.match(m.html, /שלום דנה,<br>פתחנו עבורך תיק: Monthly\./); assert.match(m.html, /href="https:\/\/waives-io\.github\.io\/Onboarding--Demo\/client\.html#[0-9a-f]{64}"/);
  let view = (await call(e, '/api/cases/case1')).body;
  assert.equal(view.contact_count, 1); assert.equal(view.last_channel, 'email');
  assert.equal(view.events.find(x => x.action === 'email_sent').detail, 'פתיחת תיק · dana@example.com');
  // A reminder email names only what is missing.
  await call(e, '/api/cases/case1/email', { method: 'POST', data: { kind: 'reminder' } });
  assert.equal(sent[1].subject, 'תזכורת: מסמכים לתיק Monthly · משרד כהן'); assert.match(sent[1].html, /• Bank/);
  // Make answers without a confirmation (an error in Gmail): nothing is recorded and the office is told.
  reply = () => ({ status: 'accepted' });
  const bad = await call(e, '/api/cases/case1/email', { method: 'POST', data: { kind: 'opening' } });
  assert.deepEqual([bad.status, bad.body.error], [502, 'email_failed']);
  view = (await call(e, '/api/cases/case1')).body;
  assert.equal(view.contact_count, 2);
  // Content from the client's record is escaped in the email.
  db.raw.prepare("UPDATE clients SET contact_name='<b>x</b>' WHERE client_id='cl1'").run(); reply = form => ({ status: 'sent', send_id: form.get('send_id') });
  await call(e, '/api/cases/case1/email', { method: 'POST', data: { kind: 'opening' } });
  assert.match(sent.at(-1).html, /שלום &lt;b&gt;x&lt;\/b&gt;,/);
  // No email address: refused before anything is sent.
  db.raw.prepare("UPDATE clients SET email='' WHERE client_id='cl1'").run(); const before = sent.length;
  assert.equal((await call(e, '/api/cases/case1/email', { method: 'POST', data: { kind: 'opening' } })).body.error, 'invalid_email');
  assert.equal(sent.length, before);
});

test('the case list says how many documents wait for review, so the board can group cases', async () => {
  const db = await seed(), e = env(db);
  const count = async () => (await call(e, '/api/cases')).body.find(c => c.case_id === 'case1').reviewable_count;
  assert.equal(await count(), 0);
  db.raw.prepare("UPDATE requirements SET status='uploaded' WHERE requirement_id IN ('r1','r2')").run();
  db.raw.prepare("INSERT INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version,state) VALUES ('s1','r1','a.pdf','application/pdf',10,'h',1,'stored'),('s2','r2','b.pdf','application/pdf',10,'h',1,'pending')").run();
  // Only a stored file with nothing still saving counts.
  assert.equal(await count(), 1);
});

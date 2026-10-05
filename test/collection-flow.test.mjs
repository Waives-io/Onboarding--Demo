import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/portal.mjs';
import { hash, caseToken, phonePin, formatMobile, deriveStatus, caseProgress } from '../worker/domain.mjs';
import { d1 } from './support.mjs';
import { localDate } from '../worker/domain.mjs';
import { addDays } from '../board.mjs';

const SITE = 'https://waives-io.github.io';
const OFFICE_TOKEN = 'e'.repeat(64);
const KEY = 'l'.repeat(32);
const env = db => ({ DB: db, PORTAL_LINK_KEY: KEY, PORTAL_BRIDGE_ENABLED: 'true' });

async function seed({ phone = '050-123-4567' } = {}) {
  const db = d1();
  db.raw.prepare("INSERT INTO clients(client_id,name,reference,phone,email) VALUES ('cl1','Test Client','R1',?,'a@b.co')").run(phone);
  db.raw.prepare("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,token_hash) VALUES ('case1','cl1','Annual','custom','2025','2026-12-01',?)").run(await hash(await caseToken('case1', KEY)));
  db.raw.prepare("INSERT INTO requirements(requirement_id,case_id,name,required,max_files,position) VALUES ('r1','case1','Bank',1,1,0),('r2','case1','Form 106',1,1,1),('r3','case1','Donations',0,1,2)").run();
  db.raw.prepare("INSERT INTO staff(staff_id,name,email,role,pw) VALUES ('admin1','Admin','admin@x.test','admin','-')").run();
  db.raw.prepare('INSERT INTO sessions(token_hash,expires_at,staff_id) VALUES (?,?,?)').run(await hash(OFFICE_TOKEN), Date.now() + 3600000, 'admin1');
  return db;
}
async function call(e, path, { method = 'GET', data, auth = 'office', pin, ip = '1.1.1.1' } = {}) {
  const headers = { Origin: SITE, 'CF-Connecting-IP': ip };
  if (auth === 'office') headers.Authorization = 'Bearer ' + OFFICE_TOKEN;
  if (auth === 'client') { headers['X-Case-Token'] = await caseToken('case1', KEY); if (pin !== undefined) headers['X-Case-Pin'] = pin; }
  let body;
  if (data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
  const res = await worker.fetch(new Request('https://worker.example' + path, { method, headers, body }), e);
  return { status: res.status, body: await res.json() };
}
const client = (e, path, opts = {}) => call(e, path, { auth: 'client', pin: '4567', ...opts });
const caseStatus = db => db.raw.prepare("SELECT status FROM cases WHERE case_id='case1'").get().status;

test('pin and mobile helpers', () => {
  assert.equal(phonePin('050-123-4567'), '4567');
  assert.equal(phonePin('+972 52 111 2233'), '2233');
  assert.equal(phonePin(''), '');
  assert.equal(formatMobile('+972501234567'), '050-1234567');
  assert.equal(formatMobile('0501234567'), '050-1234567');
  assert.equal(formatMobile('00972-52-1112233'), '052-1112233');
  assert.equal(formatMobile('03-1234567'), null);
});

test('the client link needs the last 4 digits of the mobile', async () => {
  const e = env(await seed());
  assert.equal((await call(e, '/api/portal', { auth: 'client' })).body.error, 'pin_required');
  assert.equal((await call(e, '/api/portal', { auth: 'client', pin: '0000' })).body.error, 'wrong_pin');
  const ok = await client(e, '/api/portal');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, 'Annual');
});

test('wrong digits lock the case for a while, even for the right digits', async () => {
  const e = env(await seed());
  for (let i = 0; i < 8; i++) assert.equal((await call(e, '/api/portal', { auth: 'client', pin: String(1000 + i) })).status, 401);
  const locked = await client(e, '/api/portal');
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, 'too_many_attempts');
});

test('a client without a usable phone opens with the link alone', async () => {
  const db = await seed(), e = env(db);
  db.raw.prepare("UPDATE clients SET phone='' WHERE client_id='cl1'").run();
  assert.equal((await call(e, '/api/portal', { auth: 'client' })).status, 200);
});

test('a closed case shows only that it is closed', async () => {
  const db = await seed(), e = env(db);
  db.raw.prepare("UPDATE cases SET status='closed' WHERE case_id='case1'").run();
  const r = await client(e, '/api/portal');
  assert.equal(r.body.closed, true);
  assert.deepEqual(r.body.requirements, []);
});

test('"I do not have this document" counts as answered and the office decides', async () => {
  const db = await seed(), e = env(db);
  db.raw.prepare("UPDATE requirements SET status='uploaded' WHERE requirement_id='r1'").run();
  const marked = await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'r2', note: 'אין לי מעסיק השנה' } });
  assert.equal(marked.status, 200);
  assert.equal(caseStatus(db), 'client_completed');
  // From here progress counts what the office approved.
  assert.equal(marked.body.progress_kind, 'approved');
  // The office list does not count it as missing, and shows it separately.
  const [row] = (await call(e, '/api/cases')).body;
  assert.equal(row.missing, null);
  assert.equal(row.unavailable, 1);
  // The reminder does not ask for it again.
  assert.equal((await call(e, '/api/cases/case1/reminder', { method: 'POST', data: {} })).body.error, 'nothing_missing');
  // Approving the absence needs no file.
  db.raw.prepare("INSERT INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version,state) VALUES ('s1','r1','b.pdf','application/pdf',10,'h',1,'stored')").run();
  assert.equal((await call(e, '/api/cases/case1/review', { method: 'POST', data: { requirement_id: 'r1', status: 'approved' } })).status, 200);
  assert.equal((await call(e, '/api/cases/case1/review', { method: 'POST', data: { requirement_id: 'r2', status: 'approved' } })).status, 200);
  assert.equal(caseStatus(db), 'ready_for_work');
});

test('the office can ask for the document anyway, and the answer is cleared', async () => {
  const db = await seed(), e = env(db);
  await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'r2', note: 'אין לי מעסיק' } });
  const r = await call(e, '/api/cases/case1/review', { method: 'POST', data: { requirement_id: 'r2', status: 'correction', message: 'בכל זאת צריך' } });
  assert.equal(r.status, 200);
  const req = db.raw.prepare("SELECT status,unavailable_note FROM requirements WHERE requirement_id='r2'").get();
  assert.deepEqual([req.status, req.unavailable_note], ['correction', null]);
  assert.equal(caseStatus(db), 'action_required');
});

test('the client can take the answer back, and only a missing document can be marked', async () => {
  const db = await seed(), e = env(db);
  db.raw.prepare("UPDATE requirements SET status='uploaded' WHERE requirement_id='r1'").run();
  // A required document needs a reason.
  assert.equal((await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'r2' } })).body.error, 'reason_required');
  assert.equal((await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'r2', note: ' ' } })).body.error, 'reason_required');
  await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'r2', note: 'לא עבדתי השנה' } });
  assert.equal(caseStatus(db), 'client_completed');
  await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'r2', undo: true } });
  assert.equal(caseStatus(db), 'collecting');
  assert.equal(db.raw.prepare("SELECT client_completed_at FROM cases WHERE case_id='case1'").get().client_completed_at, null);
  assert.equal((await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'r1' } })).body.error, 'not_missing');
  assert.equal((await client(e, '/api/portal/unavailable', { method: 'POST', data: { requirement_id: 'nope' } })).status, 404);
});

test('status rules agree with the server', () => {
  const reqs = [{ required: 1, status: 'uploaded' }, { required: 1, status: 'missing', unavailable_note: '' }, { required: 0, status: 'missing' }];
  assert.equal(deriveStatus(reqs), 'client_completed');
  assert.equal(caseProgress('collecting', reqs).progress_done, 2);
  assert.equal(deriveStatus([{ required: 1, status: 'missing', unavailable_note: null }]), 'collecting');
});

const inquiry = { name: 'נגריית הזית', contact_name: 'דנה', phone: '0521112233', email: ' Dana@Example.co ', need: 'refund', consent: true, source: 'דף נחיתה' };

test('the landing page leaves an inquiry, and the office sees and handles it', async () => {
  const db = await seed(), e = env(db);
  const r = await call(e, '/api/inquiries', { method: 'POST', auth: 'none', data: { ...inquiry, need: 'other', other: 'ייעוץ לפני מכירת דירה' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.opened, false);
  const list = (await call(e, '/api/inquiries')).body;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].phone, list[0].email, list[0].need, list[0].template_id], ['052-1112233', 'dana@example.co', 'משהו אחר: ייעוץ לפני מכירת דירה', null]);
  assert.equal((await call(e, '/api/inquiries/' + list[0].inquiry_id, { method: 'POST', data: { status: 'handled', client_id: 'cl1' } })).status, 200);
  assert.equal((await call(e, '/api/inquiries')).body.length, 0);
  // Handled once only.
  assert.equal((await call(e, '/api/inquiries/' + list[0].inquiry_id, { method: 'POST', data: { status: 'dismissed' } })).status, 404);
  // The list is for staff only.
  assert.equal((await call(e, '/api/inquiries', { auth: 'none' })).status, 401);
});

test('an inquiry needs consent, a valid mobile and a known need; bots and floods are stopped', async () => {
  const db = await seed(), e = env(db), post = (data, ip) => call(e, '/api/inquiries', { method: 'POST', auth: 'none', data, ip });
  assert.equal((await post({ ...inquiry, consent: false })).body.error, 'consent_required');
  assert.equal((await post({ ...inquiry, phone: '03-1234567' })).body.error, 'invalid_mobile');
  assert.equal((await post({ ...inquiry, need: 'x' })).body.error, 'invalid_fields');
  assert.equal((await post({ ...inquiry, email: 'nope' })).body.error, 'invalid_email');
  assert.equal((await post({ ...inquiry, website: 'spam.example' }, '9.9.9.9')).status, 200);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM inquiries').get().n, 0);
  for (let i = 0; i < 5; i++) assert.equal((await post(inquiry, '2.2.2.2')).status, 200);
  assert.equal((await post(inquiry, '2.2.2.2')).status, 429);
});

test('the starting case types are loaded, with required and optional documents', async () => {
  const db = await seed();
  const t = db.raw.prepare("SELECT count(*) n, sum(required) r FROM template_items WHERE template_id='ct-annual-individual'").get();
  assert.deepEqual([t.n, t.r], [9, 3]);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM templates WHERE template_id LIKE 'ct-%'").get().n, 9);
  // A document shared by several case types exists once.
  assert.equal(db.raw.prepare("SELECT count(*) n FROM document_catalog WHERE name='תדפיס בנק'").get().n, 1);
});

test('an inquiry with a ready document list opens the client and the case by itself and emails both sides', async t => {
  const db = await seed(), e = { ...env(db), MAKE_WEBHOOK_URL: 'https://hook.eu1.make.com/test', MAKE_BRIDGE_KEY: 'k'.repeat(32), PORTAL_BRIDGE_ENABLED: 'true' };
  db.raw.prepare("UPDATE settings SET office_name='משרד כהן',email='office@example.com',due_days=10 WHERE id=1").run();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { const m = Object.fromEntries(init.body); sent.push(m); return new Response(JSON.stringify({ status: 'sent', send_id: m.send_id }), { headers: { 'content-type': 'application/json' } }); });
  const r = (await call(e, '/api/inquiries', { method: 'POST', auth: 'none', data: { ...inquiry, need: 'annual_selfemployed' } })).body;
  const year = new Date().getFullYear() - 1;
  assert.equal(r.opened, true); assert.equal(r.email_sent, true);
  assert.match(r.link, /client\.html#[A-Za-z0-9]{10}$/);
  const c = db.raw.prepare('SELECT c.*,cl.name client,cl.email FROM cases c JOIN clients cl USING(client_id) WHERE c.name LIKE ?').get('%' + year);
  assert.equal(c.client, 'נגריית הזית'); assert.equal(c.email, 'dana@example.co'); assert.equal(c.owner_id, 'admin1');
  assert.deepEqual([c.period_start, c.period_end], [year + '-01-01', year + '-12-31']);
  assert.equal(c.due_date, addDays(localDate(), 10));
  assert.ok(db.raw.prepare('SELECT count(*) n FROM requirements WHERE case_id=?').get(c.case_id).n > 0);
  // One email to the client with the link and the list, one alert to the office.
  const toClient = sent.find(m => m.to === 'dana@example.co'), toOffice = sent.find(m => m.to === 'office@example.com');
  assert.match(toClient.html, /פתחנו לך תיק/); assert.equal(toClient.reply_to, 'office@example.com');
  assert.equal(toOffice.subject, 'מסמכים בזמן · השאירו פרטים: נגריית הזית'); assert.equal(toOffice.reply_to, 'dana@example.co');
  assert.equal((await call(e, '/api/inquiries')).body.length, 0);
  const view = (await call(e, '/api/cases/' + c.case_id)).body;
  assert.ok(view.events.some(x => x.action === 'case_from_inquiry')); assert.equal(view.contact_count, 1);
  // The same request again gets the same open case, and the known client is reused.
  const again = (await call(e, '/api/inquiries', { method: 'POST', auth: 'none', data: { ...inquiry, need: 'annual_selfemployed' } })).body;
  assert.equal(again.link, r.link);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM clients WHERE name='נגריית הזית'").get().n, 1);
  // Same mobile with another email is a new client, so a stranger never reaches an existing client's case.
  const other = (await call(e, '/api/inquiries', { method: 'POST', auth: 'none', data: { ...inquiry, email: 'x@example.com', need: 'annual_selfemployed' } })).body;
  assert.notEqual(other.link, r.link);
  // Same mobile and email under another name is also a new client.
  const renamed = (await call(e, '/api/inquiries', { method: 'POST', auth: 'none', data: { ...inquiry, name: 'שרוליק', contact_name: 'שרוליק', need: 'annual_selfemployed' } })).body;
  assert.notEqual(renamed.link, r.link);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM clients WHERE name='שרוליק'").get().n, 1);
  // Something else: a confirmation to the client, and the inquiry waits for the office.
  sent.length = 0;
  assert.equal((await call(e, '/api/inquiries', { method: 'POST', auth: 'none', data: { ...inquiry, need: 'other' }, ip: '7.7.7.7' })).body.error, 'other_required');
  const wait = (await call(e, '/api/inquiries', { method: 'POST', auth: 'none', data: { ...inquiry, need: 'other', other: 'ייעוץ' }, ip: '7.7.7.7' })).body;
  assert.equal(wait.opened, false); assert.equal(wait.email_sent, true);
  assert.match(sent.find(m => m.to === 'dana@example.co').html, /קיבלנו את הפנייה שלך ונחזור אליך בהקדם/);
  assert.equal((await call(e, '/api/inquiries')).body.length, 1);
});

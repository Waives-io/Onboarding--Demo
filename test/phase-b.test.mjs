import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/portal.mjs';
import { hash, caseToken } from '../worker/domain.mjs';
import { d1 } from './support.mjs';

const SITE = 'https://waives-io.github.io';
const KEY = 'l'.repeat(32);
const env = db => ({ DB: db, PORTAL_LINK_KEY: KEY, PORTAL_BRIDGE_ENABLED: 'true' });
const T = { admin: 'a'.repeat(64), m1: 'b'.repeat(64), m2: 'd'.repeat(64) };
const uuid = () => crypto.randomUUID();

async function call(e, path, { method = 'GET', data, token = T.m1 } = {}) {
  const headers = { Origin: SITE, Authorization: 'Bearer ' + token };
  let body;
  if (data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
  const res = await worker.fetch(new Request('https://worker.example' + path, { method, headers, body }), e);
  return { status: res.status, body: await res.json() };
}

// case1 belongs to m1 and has four documents: two sent and stored, one sent but still saving, one missing.
async function office() {
  const db = d1(), q = (sql, ...a) => db.raw.prepare(sql).run(...a);
  for (const [id, role] of [['admin', 'admin'], ['m1', 'manager'], ['m2', 'manager']]) {
    q('INSERT INTO staff(staff_id,name,email,role,pw) VALUES (?,?,?,?,?)', id, id.toUpperCase(), id + '@x.test', role, '-');
    q('INSERT INTO sessions(token_hash,expires_at,staff_id) VALUES (?,?,?)', await hash(T[id]), Date.now() + 3600000, id);
  }
  q("INSERT INTO clients(client_id,name,reference) VALUES ('cl1','One','R1')");
  q("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,owner_id,token_hash,status) VALUES ('case1','cl1','c','custom','p','2026-12-01','m1',?,'collecting')", await hash(await caseToken('case1', KEY)));
  q("INSERT INTO requirements(requirement_id,case_id,name,required,max_files,position,status) VALUES ('a','case1','A',1,1,0,'uploaded'),('b','case1','B',1,1,1,'uploaded'),('c','case1','C',1,1,2,'uploaded'),('d','case1','D',0,1,3,'missing')");
  q("INSERT INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version,state,created_at) VALUES ('sa','a','a.pdf','application/pdf',9,'h',1,'stored',strftime('%Y-%m-%dT%H:%M:%fZ','now')),('sb','b','b.pdf','application/pdf',9,'h',1,'stored',strftime('%Y-%m-%dT%H:%M:%fZ','now')),('sc','c','c.pdf','application/pdf',9,'h',1,'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  return db;
}

test('a contact is recorded once per click, with channel and who', async () => {
  const db = await office(), e = env(db), id = uuid();
  assert.equal((await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: id, channel: 'whatsapp' } })).status, 200);
  assert.equal((await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: id, channel: 'whatsapp' } })).status, 200);
  await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: uuid(), channel: 'copy' } });
  const [c] = (await call(e, '/api/cases')).body;
  assert.equal(c.contact_count, 2);
  assert.equal(c.last_channel, 'copy');
  assert.ok(c.last_contact_at);
  const view = (await call(e, '/api/cases/case1')).body;
  assert.equal(view.contact_count, 2);
  assert.equal(view.events.filter(x => x.action === 'contact').length, 2);
  assert.equal(view.events.find(x => x.action === 'contact').actor_name, 'M1');
});

test('contacts reject bad input, other managers and closed cases', async () => {
  const db = await office(), e = env(db);
  assert.equal((await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: uuid(), channel: 'sms' } })).status, 400);
  assert.equal((await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: 'x', channel: 'copy' } })).status, 400);
  assert.equal((await call(e, '/api/cases/case1/contacts', { method: 'POST', token: T.m2, data: { send_id: uuid(), channel: 'copy' } })).status, 404);
  db.raw.prepare("UPDATE cases SET status='closed' WHERE case_id='case1'").run();
  assert.equal((await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: uuid(), channel: 'copy' } })).status, 409);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM contacts').get().n, 0);
});

test('a contact for a case handed to someone else mid-request is refused', async () => {
  const db = await office(), e = env(db);
  db.onPrepare = sql => { if (sql.includes('INSERT OR IGNORE INTO contacts')) { db.onPrepare = null; db.raw.prepare("UPDATE cases SET owner_id='m2' WHERE case_id='case1'").run(); } };
  assert.equal((await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: uuid(), channel: 'copy' } })).status, 404);
  assert.equal(db.raw.prepare('SELECT count(*) n FROM events').get().n, 0);
});

const ALL = { requirement_ids: ['a', 'b', 'c', 'd'] };
test('approve all approves only stored documents with nothing still saving', async () => {
  const db = await office(), e = env(db);
  const r = await call(e, '/api/cases/case1/review-all', { method: 'POST', data: ALL });
  assert.equal(r.status, 200);
  assert.equal(r.body.approved_count, 2);
  const st = Object.fromEntries(db.raw.prepare('SELECT requirement_id,status FROM requirements').all().map(x => [x.requirement_id, x.status]));
  assert.deepEqual(st, { a: 'approved', b: 'approved', c: 'uploaded', d: 'missing' });
  const ev = db.raw.prepare("SELECT detail,actor_id FROM events WHERE action='approved' ORDER BY detail").all();
  assert.deepEqual(ev.map(x => [x.detail, x.actor_id]), [['A', 'm1'], ['B', 'm1']]);
  assert.equal((await call(e, '/api/cases/case1/review-all', { method: 'POST', data: ALL })).body.error, 'nothing_to_review');
  assert.equal((await call(e, '/api/cases/case1/review-all', { method: 'POST', data: {} })).body.error, 'nothing_to_review');
});

test('approve all finishes the case when nothing else is left', async () => {
  const db = await office(), e = env(db);
  db.raw.prepare("UPDATE uploads SET state='stored' WHERE submission_id='sc'").run();
  const r = await call(e, '/api/cases/case1/review-all', { method: 'POST', data: ALL });
  assert.equal(r.body.approved_count, 3);
  assert.equal(r.body.status, 'ready_for_work');
  assert.ok(db.raw.prepare("SELECT completed_at FROM cases WHERE case_id='case1'").get().completed_at);
});

test('approve all is refused to other managers, on closed cases, and when the case moves mid-request', async () => {
  const db = await office(), e = env(db);
  assert.equal((await call(e, '/api/cases/case1/review-all', { method: 'POST', token: T.m2, data: ALL })).status, 404);
  db.onPrepare = sql => { if (sql.includes("UPDATE requirements SET status='approved'")) { db.onPrepare = null; db.raw.prepare("UPDATE cases SET status='closed' WHERE case_id='case1'").run(); } };
  assert.equal((await call(e, '/api/cases/case1/review-all', { method: 'POST', data: ALL })).status, 409);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM requirements WHERE status='approved'").get().n, 0);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM events WHERE action='approved'").get().n, 0);
  db.raw.prepare("UPDATE cases SET status='collecting' WHERE case_id='case1'").run();
  db.onPrepare = sql => { if (sql.includes("UPDATE requirements SET status='approved'")) { db.onPrepare = null; db.raw.prepare("UPDATE cases SET owner_id='m2' WHERE case_id='case1'").run(); } };
  assert.equal((await call(e, '/api/cases/case1/review-all', { method: 'POST', data: ALL })).status, 404);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM requirements WHERE status='approved'").get().n, 0);
});

test('a document whose receipt arrives during approve all is not approved unseen', async () => {
  const db = await office(), e = env(db);
  // The office saw A and B. C's receipt lands just before the batch; C must wait for its own review.
  db.onPrepare = sql => { if (sql.includes("INSERT INTO events(event_id,case_id,action,detail,actor_type,actor_id) SELECT lower")) { db.onPrepare = null; db.raw.prepare("UPDATE uploads SET state='stored' WHERE submission_id='sc'").run(); } };
  const r = await call(e, '/api/cases/case1/review-all', { method: 'POST', data: { requirement_ids: ['a', 'b'] } });
  assert.equal(r.status, 200);
  assert.equal(db.raw.prepare("SELECT status FROM requirements WHERE requirement_id='c'").get().status, 'uploaded');
  // Whatever was approved has exactly one event, so the audit trail matches.
  const approved = db.raw.prepare("SELECT count(*) n FROM requirements WHERE status='approved'").get().n;
  assert.equal(db.raw.prepare("SELECT count(*) n FROM events WHERE action='approved'").get().n, approved);
  assert.equal(r.body.approved_count, approved);
});

test('a send_id belongs to one case, and a case closed mid-request takes no contact', async () => {
  const db = await office(), e = env(db), id = uuid();
  db.raw.prepare("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,owner_id,token_hash) VALUES ('case2','cl1','c2','custom','p','2026-12-01','m1','h2')").run();
  await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: id, channel: 'copy' } });
  assert.equal((await call(e, '/api/cases/case2/contacts', { method: 'POST', data: { send_id: id, channel: 'copy' } })).body.error, 'conflict');
  db.onPrepare = sql => { if (sql.includes('INSERT OR IGNORE INTO contacts')) { db.onPrepare = null; db.raw.prepare("UPDATE cases SET status='closed' WHERE case_id='case2'").run(); } };
  assert.equal((await call(e, '/api/cases/case2/contacts', { method: 'POST', data: { send_id: uuid(), channel: 'copy' } })).status, 409);
  assert.equal(db.raw.prepare("SELECT count(*) n FROM contacts WHERE case_id='case2'").get().n, 0);
});

test('the client portal works without touching the contacts table', async () => {
  const db = await office(), e = env(db);
  db.raw.exec('DROP TABLE contacts');
  const res = await worker.fetch(new Request('https://worker.example/api/portal', { headers: { Origin: SITE, 'X-Case-Token': await caseToken('case1', KEY) } }), e);
  assert.equal(res.status, 200);
});

test('the client view never shows contact records', async () => {
  const db = await office(), e = env(db);
  await call(e, '/api/cases/case1/contacts', { method: 'POST', data: { send_id: uuid(), channel: 'copy' } });
  const res = await worker.fetch(new Request('https://worker.example/api/portal', { headers: { Origin: SITE, 'X-Case-Token': await caseToken('case1', KEY) } }), e);
  const body = await res.json();
  for (const k of ['contact_count', 'last_contact_at', 'last_channel']) assert.equal(body[k], undefined, k);
});

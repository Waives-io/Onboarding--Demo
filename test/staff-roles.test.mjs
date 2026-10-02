import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/portal.mjs';
import { hash, caseToken, hashPassword } from '../worker/domain.mjs';
import { d1 } from './support.mjs';

const SITE = 'https://waives-io.github.io';
const KEY = 'l'.repeat(32);
const env = db => ({ DB: db, PORTAL_LINK_KEY: KEY, PORTAL_BRIDGE_ENABLED: 'true', OFFICE_CODE: 'first office code' });
const T = { admin: 'a'.repeat(64), m1: 'b'.repeat(64), m2: 'd'.repeat(64) };

async function call(e, path, { method = 'GET', data, token, ip = '1.1.1.1', caseTok } = {}) {
  const headers = { Origin: SITE, 'CF-Connecting-IP': ip };
  if (caseTok) headers['X-Case-Token'] = caseTok;
  if (token) headers.Authorization = 'Bearer ' + token;
  let body;
  if (data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
  const res = await worker.fetch(new Request('https://worker.example' + path, { method, headers, body }), e);
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}

// One admin and two managers. case1 belongs to m1, case2 to m2, case3 is from before personal logins.
async function office() {
  const db = d1(), q = (sql, ...a) => db.raw.prepare(sql).run(...a);
  for (const [id, role] of [['admin', 'admin'], ['m1', 'manager'], ['m2', 'manager']]) {
    q('INSERT INTO staff(staff_id,name,email,role,pw) VALUES (?,?,?,?,?)', id, id.toUpperCase(), id + '@x.test', role, '-');
    q('INSERT INTO sessions(token_hash,expires_at,staff_id) VALUES (?,?,?)', await hash(T[id]), Date.now() + 3600000, id);
  }
  q("INSERT INTO clients(client_id,name,reference) VALUES ('cl1','One','R1'),('cl2','Two','R2'),('cl3','Three','R3')");
  for (const [id, client, owner, ownerText] of [['case1', 'cl1', 'm1', 'M1'], ['case2', 'cl2', 'm2', 'M2'], ['case3', 'cl3', null, 'מיכל']]) {
    q("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,owner,owner_id,token_hash) VALUES (?,?,?,'custom','2026-08','2026-12-01',?,?,?)", id, client, id, ownerText, owner, await hash(await caseToken(id, KEY)));
    q("INSERT INTO requirements(requirement_id,case_id,name,required,max_files,position) VALUES (?,?,'Bank',1,1,0)", 'r-' + id, id);
  }
  return db;
}
const newCase = (client_id, extra = {}) => ({ client_id, name: 'New', type: 'custom', due_date: '2026-12-31', period_start: '2026-01-01', period_end: '2026-01-31', requirements: [{ name: 'Bank', required: true, max_files: 1 }], ...extra });

test('the office code only creates the first admin', async () => {
  const db = d1(), e = env(db);
  assert.deepEqual((await call(e, '/api/auth-state')).body, { setup_required: true });
  const form = { code: 'wrong code!!', name: 'Galli', email: 'Galli@X.test', password: 'long enough' };
  assert.equal((await call(e, '/api/setup', { method: 'POST', data: form })).status, 401);
  const ok = await call(e, '/api/setup', { method: 'POST', data: { ...form, code: 'first office code' } });
  assert.equal(ok.status, 200);
  const me = await call(e, '/api/me', { token: ok.body.token });
  assert.deepEqual([me.body.role, me.body.email], ['admin', 'galli@x.test']);
  assert.equal((await call(e, '/api/setup', { method: 'POST', data: { ...form, code: 'first office code', email: 'b@x.test' } })).body.error, 'already_set_up');
  assert.deepEqual((await call(e, '/api/auth-state')).body, { setup_required: false });
  // The old shared-code login is gone.
  assert.equal((await call(e, '/api/login', { method: 'POST', data: { code: 'first office code' } })).status, 401);
});

test('personal login: right password, wrong password, unknown email, lockout', async () => {
  const db = await office(), e = env(db);
  db.raw.prepare("UPDATE staff SET pw=? WHERE staff_id='m1'").run(await hashPassword('correct horse'));
  const ok = await call(e, '/api/login', { method: 'POST', data: { email: ' M1@x.test ', password: 'correct horse' } });
  assert.equal(ok.status, 200);
  assert.equal((await call(e, '/api/me', { token: ok.body.token })).body.staff_id, 'm1');
  assert.equal((await call(e, '/api/login', { method: 'POST', data: { email: 'm1@x.test', password: 'nope nope' } })).body.error, 'unauthorized');
  assert.equal((await call(e, '/api/login', { method: 'POST', data: { email: 'ghost@x.test', password: 'nope nope' } })).body.error, 'unauthorized');
  // Ten tries per account, whatever the address.
  let last;
  for (let i = 0; i < 11; i++) last = await call(e, '/api/login', { method: 'POST', ip: '9.9.9.' + i, data: { email: 'm2@x.test', password: 'guess ' + i } });
  assert.equal(last.body.error, 'too_many_attempts');
});

test('a session from the shared office code is refused', async () => {
  const db = await office(), e = env(db), old = 'f'.repeat(64);
  db.raw.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES (?,?)').run(await hash(old), Date.now() + 3600000);
  assert.equal((await call(e, '/api/cases', { token: old })).status, 401);
});

test('a manager sees only their own cases and clients', async () => {
  const db = await office(), e = env(db);
  assert.deepEqual((await call(e, '/api/cases', { token: T.m1 })).body.map(c => c.case_id), ['case1']);
  assert.deepEqual((await call(e, '/api/clients', { token: T.m1 })).body.map(c => c.client_id), ['cl1']);
  assert.deepEqual((await call(e, '/api/cases', { token: T.admin })).body.map(c => c.case_id).sort(), ['case1', 'case2', 'case3']);
  assert.equal((await call(e, '/api/clients', { token: T.admin })).body.length, 3);
  const [c1] = (await call(e, '/api/cases', { token: T.m1 })).body;
  assert.equal(c1.owner_name, 'M1');
});

test('every case route answers 404 for someone else\'s case', async () => {
  const db = await office(), e = env(db);
  const routes = [['GET', ''], ['GET', '/link'], ['POST', '/revoke-link'], ['POST', '/review'], ['POST', '/status'], ['POST', '/reminder'], ['POST', '/reconcile'], ['POST', '/owner']];
  for (const id of ['case2', 'case3']) for (const [method, suffix] of routes) {
    const r = await call(e, `/api/cases/${id}${suffix}`, { method, token: T.m1, data: method === 'POST' ? { status: 'closed', requirement_id: 'r-' + id, staff_id: 'm1', submission_id: 'x' } : undefined });
    assert.equal(r.status, 404, `${method} ${id}${suffix}`);
  }
  assert.equal(db.raw.prepare("SELECT status FROM cases WHERE case_id='case2'").get().status, 'collecting');
  assert.equal((await call(e, '/api/cases/case1', { token: T.m1 })).status, 200);
});

test('admin-only routes are refused to a manager', async () => {
  const db = await office(), e = env(db);
  const routes = [
    ['/api/settings', { office_name: 'x', warning_days: 7, urgent_days: 2 }], ['/api/settings/logo', { data: '' }],
    ['/api/catalog', { name: 'Doc' }], ['/api/templates', { name: 'T', items: [{ name: 'Doc', required: true, max_files: 1 }] }],
    ['/api/csv/export', { entity: 'clients' }], ['/api/staff', { name: 'X', email: 'x@x.test', role: 'admin', password: 'long enough' }],
    ['/api/owners/map', { owner: 'מיכל', staff_id: 'm1' }], ['/api/cases/case1/owner', { staff_id: 'm2' }],
  ];
  for (const [path, data] of routes) assert.equal((await call(e, path, { method: 'POST', token: T.m1, data })).status, 403, path);
  assert.equal((await call(e, '/api/owners/legacy', { token: T.m1 })).status, 403);
  assert.equal(db.raw.prepare("SELECT owner_id FROM cases WHERE case_id='case1'").get().owner_id, 'm1');
  assert.equal(db.raw.prepare('SELECT count(*) n FROM staff').get().n, 3);
  // A manager's staff list has no emails or activity.
  const list = (await call(e, '/api/staff', { token: T.m1 })).body;
  assert.deepEqual(Object.keys(list[0]).sort(), ['name', 'role', 'staff_id']);
});

test('a manager opens cases only for themselves and for their own clients', async () => {
  const db = await office(), e = env(db);
  const r = await call(e, '/api/cases', { method: 'POST', token: T.m1, data: newCase('cl1', { owner_id: 'm2' }) });
  assert.equal(r.status, 200);
  assert.equal(db.raw.prepare('SELECT owner_id FROM cases WHERE case_id=?').get(r.body.case_id).owner_id, 'm1');
  assert.equal((await call(e, '/api/cases', { method: 'POST', token: T.m1, data: newCase('cl2') })).body.error, 'client_not_found');
  // A client the manager creates is theirs before it has any case.
  const cl = await call(e, '/api/clients', { method: 'POST', token: T.m1, data: { name: 'Fresh', reference: 'R9', phone: '0521112233', email: 'a@b.co' } });
  assert.equal((await call(e, '/api/cases', { method: 'POST', token: T.m1, data: newCase(cl.body.client_id) })).status, 200);
  // The admin can hand a new case to anyone active.
  const a = await call(e, '/api/cases', { method: 'POST', token: T.admin, data: newCase('cl2', { owner_id: 'm2' }) });
  assert.equal(db.raw.prepare('SELECT owner FROM cases WHERE case_id=?').get(a.body.case_id).owner, 'M2');
});

test('a manager edits a client only when all its cases are theirs', async () => {
  const db = await office(), e = env(db);
  const edit = { name: 'Renamed', reference: 'R1', phone: '0521112233', email: 'a@b.co' };
  assert.equal((await call(e, '/api/clients/cl1', { method: 'POST', token: T.m1, data: edit })).status, 200);
  assert.equal((await call(e, '/api/clients/cl2', { method: 'POST', token: T.m1, data: { ...edit, reference: 'R2' } })).status, 404);
  db.raw.prepare("INSERT INTO cases(case_id,client_id,name,type,reporting_period,due_date,owner_id,token_hash) VALUES ('case4','cl1','x','custom','p','2026-12-01','m2','h4')").run();
  assert.equal((await call(e, '/api/clients/cl1', { method: 'POST', token: T.m1, data: edit })).status, 403);
  assert.equal((await call(e, '/api/clients/cl1', { method: 'POST', token: T.admin, data: edit })).status, 200);
});

test('deactivating or changing a role signs the member out; the last admin stays', async () => {
  const db = await office(), e = env(db);
  const m1 = { staff_id: 'm1', name: 'M1', email: 'm1@x.test', role: 'manager' };
  assert.equal((await call(e, '/api/staff', { method: 'POST', token: T.admin, data: { ...m1, name: 'Mira' } })).status, 200);
  assert.equal((await call(e, '/api/me', { token: T.m1 })).body.name, 'Mira');
  assert.equal(db.raw.prepare("SELECT owner FROM cases WHERE case_id='case1'").get().owner, 'Mira');
  await call(e, '/api/staff', { method: 'POST', token: T.admin, data: { ...m1, active: false } });
  assert.equal((await call(e, '/api/cases', { token: T.m1 })).status, 401);
  await call(e, '/api/staff', { method: 'POST', token: T.admin, data: { staff_id: 'm2', name: 'M2', email: 'm2@x.test', role: 'admin' } });
  assert.equal((await call(e, '/api/cases', { token: T.m2 })).status, 401);
  // m2 is now an admin, so the first admin may step down. Then m2 cannot.
  const self = { staff_id: 'admin', name: 'ADMIN', email: 'admin@x.test', role: 'manager' };
  assert.equal((await call(e, '/api/staff', { method: 'POST', token: T.admin, data: self })).status, 200);
  const m2 = (await call(e, '/api/login', { method: 'POST', data: { email: 'm2@x.test', password: 'x' } }));
  assert.equal(m2.status, 401);
  db.raw.prepare('INSERT INTO sessions(token_hash,expires_at,staff_id) VALUES (?,?,?)').run(await hash('c'.repeat(64)), Date.now() + 3600000, 'm2');
  const r = await call(e, '/api/staff', { method: 'POST', token: 'c'.repeat(64), data: { staff_id: 'm2', name: 'M2', email: 'm2@x.test', role: 'manager' } });
  assert.equal(r.body.error, 'last_admin');
  assert.equal((await call(e, '/api/staff', { method: 'POST', token: 'c'.repeat(64), data: { staff_id: 'x', name: 'Dup', email: 'M1@x.test', role: 'manager', password: 'long enough' } })).body.error, 'duplicate_email');
});

test('old free-text owners map to a staff member once', async () => {
  const db = await office(), e = env(db);
  assert.deepEqual((await call(e, '/api/owners/legacy', { token: T.admin })).body, [{ owner: 'מיכל', cases: 1 }]);
  assert.equal((await call(e, '/api/owners/map', { method: 'POST', token: T.admin, data: { owner: 'מיכל', staff_id: 'm2' } })).body.mapped, 1);
  assert.deepEqual((await call(e, '/api/cases', { token: T.m2 })).body.map(c => c.case_id).sort(), ['case2', 'case3']);
  assert.deepEqual((await call(e, '/api/owners/legacy', { token: T.admin })).body, []);
});

test('changing your own password signs out your other devices', async () => {
  const db = await office(), e = env(db), other = 'c'.repeat(64);
  db.raw.prepare("UPDATE staff SET pw=? WHERE staff_id='m1'").run(await hashPassword('old password'));
  db.raw.prepare('INSERT INTO sessions(token_hash,expires_at,staff_id) VALUES (?,?,?)').run(await hash(other), Date.now() + 3600000, 'm1');
  assert.equal((await call(e, '/api/me/password', { method: 'POST', token: T.m1, data: { current: 'wrong one', password: 'new password' } })).status, 403);
  assert.equal((await call(e, '/api/me/password', { method: 'POST', token: T.m1, data: { current: 'old password', password: 'short' } })).body.error, 'weak_password');
  assert.equal((await call(e, '/api/me/password', { method: 'POST', token: T.m1, data: { current: 'old password', password: 'new password' } })).status, 200);
  assert.equal((await call(e, '/api/me', { token: T.m1 })).status, 200);
  assert.equal((await call(e, '/api/me', { token: other })).status, 401);
  assert.equal((await call(e, '/api/login', { method: 'POST', data: { email: 'm1@x.test', password: 'new password' } })).status, 200);
});

test('office actions record who did them', async () => {
  const db = await office(), e = env(db);
  await call(e, '/api/cases/case1/status', { method: 'POST', token: T.m1, data: { status: 'closed' } });
  const view = await call(e, '/api/cases/case1', { token: T.m1 });
  const ev = view.body.events.find(x => x.action === 'case_status');
  assert.deepEqual([ev.actor_type, ev.actor_id, ev.actor_name], ['staff', 'm1', 'M1']);
  assert.equal(view.body.owner_name, 'M1');
  // The client's view never shows who owns the case.
  const portal = (await call(e, '/api/portal', { caseTok: await caseToken('case1', KEY) })).body;
  for (const k of ['owner', 'owner_id', 'owner_name', 'events']) assert.equal(portal[k], undefined, k);
});

test('a case handed to someone else mid-request stays out of the old manager\'s reach', async () => {
  const db = await office(), e = env(db);
  db.raw.prepare("INSERT INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version,state) VALUES ('s1','r-case1','a.pdf','application/pdf',10,'h',1,'stored')").run();
  // The admin moves case1 to m2 right after m1 passed the ownership check.
  const moveAt = marker => { db.onPrepare = sql => { if (sql.includes(marker)) { db.onPrepare = null; db.raw.prepare("UPDATE cases SET owner_id='m2' WHERE case_id='case1'").run(); } }; };
  moveAt('closed_at=?');
  assert.equal((await call(e, '/api/cases/case1/status', { method: 'POST', token: T.m1, data: { status: 'closed' } })).status, 404);
  db.raw.prepare("UPDATE cases SET owner_id='m1' WHERE case_id='case1'").run();
  moveAt('UPDATE requirements SET status=?');
  assert.notEqual((await call(e, '/api/cases/case1/review', { method: 'POST', token: T.m1, data: { requirement_id: 'r-case1', status: 'approved' } })).status, 200);
  db.raw.prepare("UPDATE cases SET owner_id='m1' WHERE case_id='case1'").run();
  moveAt('link_version=?,token_hash=?');
  assert.equal((await call(e, '/api/cases/case1/revoke-link', { method: 'POST', token: T.m1, data: {} })).status, 409);
  const c = db.raw.prepare("SELECT status,link_version FROM cases WHERE case_id='case1'").get();
  assert.deepEqual([c.status, c.link_version], ['collecting', 1]);
  assert.equal(db.raw.prepare("SELECT status FROM requirements WHERE requirement_id='r-case1'").get().status, 'missing');
  assert.equal(db.raw.prepare("SELECT count(*) n FROM events WHERE case_id='case1'").get().n, 0);
});

test('closing a request puts it in the archive, and it can come back', async () => {
  const db = await office(), e = env(db);
  for (const s of ['closed', 'archived']) {
    assert.equal((await call(e, '/api/cases/case1/status', { method: 'POST', token: T.m1, data: { status: s } })).status, 200);
    assert.equal(db.raw.prepare("SELECT status FROM cases WHERE case_id='case1'").get().status, 'archived');
    assert.equal((await call(e, '/api/cases/case1/status', { method: 'POST', token: T.m1, data: { status: 'reopen' } })).status, 200);
    assert.notEqual(db.raw.prepare("SELECT status FROM cases WHERE case_id='case1'").get().status, 'archived');
  }
  const details = db.raw.prepare("SELECT detail FROM events WHERE case_id='case1' AND action='case_status' ORDER BY rowid").all().map(r => r.detail);
  assert.deepEqual(details, ['archived', 'reopen', 'archived', 'reopen']);
});

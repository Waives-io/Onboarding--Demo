// Writes seed/demo-data.sql: 10 fictional clients and 15 cases spread across every status and deadline state.
// Run: node seed/make-demo-data.mjs, then: npx wrangler d1 execute files-readiness-demo --remote --file seed/demo-data.sql
// Cases get link_version 0, so each one receives its client link the first time the office opens it.
// Every row is owned by the first active admin. Re-running the file does nothing (INSERT OR IGNORE on fixed ids).
import { writeFileSync } from 'node:fs';

const today = new Date(process.argv[2] || new Date().toISOString().slice(0, 10));
const day = n => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const q = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const ADMIN = "(SELECT staff_id FROM staff WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1)";
const ADMIN_NAME = "(SELECT name FROM staff WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1)";

const clients = [
  ['demo-cl-01', 'נגריית עץ הזית בע״מ', 'C-1001', '514839201', 'office@olive-wood.example.com', '050-4411223', 'חברה בע״מ'],
  ['demo-cl-02', 'רונית כהן – עיצוב פנים', 'C-1002', '032145678', 'ronit.cohen@example.com', '052-3344556', 'עצמאית'],
  ['demo-cl-03', 'מסעדת הגפן', 'C-1003', '515002331', 'hagefen@example.com', '054-7788990', 'חברה בע״מ'],
  ['demo-cl-04', 'ד״ר אבי לוי – מרפאת שיניים', 'C-1004', '028877665', 'dr.levi@example.com', '053-2211445', 'עצמאי'],
  ['demo-cl-05', 'סטודיו תנועה – מיכל ברק', 'C-1005', '039988776', 'studio.michal@example.com', '058-6655443', 'עצמאית'],
  ['demo-cl-06', 'אלקטרו-גל מערכות בע״מ', 'C-1006', '516677889', 'finance@electrogal.example.com', '050-9988771', 'חברה בע״מ'],
  ['demo-cl-07', 'יוסי מזרחי – שיפוצים', 'C-1007', '024455667', 'yossi.renov@example.com', '052-1122334', 'עצמאי'],
  ['demo-cl-08', 'עמותת יד לקהילה', 'C-1008', '580123456', 'info@yadlakehila.example.com', '054-5566778', 'עמותה'],
  ['demo-cl-09', 'נועה שפירא – צילום', 'C-1009', '035566778', 'noa.photo@example.com', '053-8877665', 'עצמאית'],
  ['demo-cl-10', 'מאפה השכונה בע״מ', 'C-1010', '517788990', 'bakery@example.com', '058-2233445', 'חברה בע״מ'],
];

// status of each document: m=missing, u=uploaded (stored, waiting for review), c=correction, a=approved
const MONTHLY = [['expenses', 'מסמכי הוצאות', 1, 10], ['sales', 'דוח מכירות', 1, 1], ['bank', 'תדפיס בנק', 1, 3]];
const ANNUAL = [['annual', 'אישור יתרות שנתי', 1, 3], ['bank', 'תדפיס בנק', 1, 3]];
const cases = [
  // client, work type, period, due (days from today), case status, document states, correction note
  ['demo-cl-01', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], -4, 'collecting', 'umm'],
  ['demo-cl-02', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 1, 'collecting', 'mmm'],
  ['demo-cl-03', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 5, 'collecting', 'uum'],
  ['demo-cl-04', 'דוח שנתי', ANNUAL, ['2025-01-01', '2025-12-31'], 30, 'collecting', 'mm'],
  ['demo-cl-05', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 12, 'client_completed', 'uuu'],
  ['demo-cl-06', 'דוח שנתי', ANNUAL, ['2025-01-01', '2025-12-31'], 3, 'client_completed', 'uu'],
  ['demo-cl-07', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 8, 'client_completed', 'auu'],
  ['demo-cl-08', 'דוח שנתי', ANNUAL, ['2025-01-01', '2025-12-31'], 2, 'action_required', 'cu', 'התדפיס חתוך בעמוד השני. נא להעלות קובץ מלא.'],
  ['demo-cl-09', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], -1, 'action_required', 'acm', 'דוח המכירות של חודש יולי ולא של אוגוסט.'],
  ['demo-cl-10', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 10, 'ready_for_work', 'aaa'],
  ['demo-cl-01', 'דוח שנתי', ANNUAL, ['2025-01-01', '2025-12-31'], 20, 'ready_for_work', 'aa'],
  ['demo-cl-03', 'דוח שנתי', ANNUAL, ['2025-01-01', '2025-12-31'], 45, 'collecting', 'um'],
  ['demo-cl-06', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 6, 'collecting', 'mum'],
  ['demo-cl-02', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-07-01', '2026-07-31'], -20, 'closed', 'aaa'],
  ['demo-cl-10', 'דוח שנתי', ANNUAL, ['2025-01-01', '2025-12-31'], 60, 'collecting', 'mm'],
  // Added 2026-09-30: two more cases whose documents are all approved.
  ['demo-cl-04', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 4, 'ready_for_work', 'aaa'],
  ['demo-cl-08', 'הנהלת חשבונות חודשית', MONTHLY, ['2026-08-01', '2026-08-31'], 9, 'ready_for_work', 'aaa'],
];

const period = ([a, b]) => a.slice(5, 7) === '01' && b.slice(5, 7) === '12' ? a.slice(0, 4) : `${a.slice(5, 7)}/${a.slice(0, 4)}`;
const ddmm = d => d.split('-').reverse().join('/');
const out = ['-- Demo data. Fictional clients and cases. Safe to re-run.'];
for (const [id, name, ref, biz, email, phone, tags] of clients)
  out.push(`INSERT OR IGNORE INTO clients(client_id,name,reference,business_number,email,phone,tags,notes) VALUES (${[id, name, ref, biz, email, phone, tags, 'לקוח לדוגמה'].map(q).join(',')});`);
cases.forEach(([client, type, docs, range, due, status, states, note], i) => {
  const id = `demo-case-${String(i + 1).padStart(2, '0')}`, done = ['ready_for_work', 'closed'].includes(status);
  out.push(`INSERT OR IGNORE INTO cases(case_id,client_id,name,type,category,reporting_period,period_start,period_end,due_date,owner,owner_id,token_hash,link_version,status,client_completed_at,completed_at,closed_at) VALUES (${[id, client, `${type} · ${period(range)}`, type, clients.find(c => c[0] === client)[6], `${ddmm(range[0])}–${ddmm(range[1])}`, range[0], range[1], day(due)].map(q).join(',')},${ADMIN_NAME},${ADMIN},${q('unissued-' + id)},0,${q(status)},${['client_completed', 'ready_for_work', 'closed'].includes(status) ? q(day(-3) + 'T09:00:00.000Z') : 'NULL'},${done ? q(day(-1) + 'T12:00:00.000Z') : 'NULL'},${status === 'closed' ? q(day(-1) + 'T12:00:00.000Z') : 'NULL'});`);
  docs.forEach(([doc, docName, required, max], j) => {
    const rid = `${id}-r${j + 1}`, st = { m: 'missing', u: 'uploaded', c: 'correction', a: 'approved' }[states[j]];
    out.push(`INSERT OR IGNORE INTO requirements(requirement_id,case_id,document_id,name,required,max_files,position,status,correction_message) VALUES (${[rid, id, doc, docName, required, max, j, st, st === 'correction' ? note : ''].map(q).join(',')});`);
    if (st !== 'missing')
      out.push(`INSERT OR IGNORE INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version,state,created_at,stored_at) VALUES (${[`${rid}-u1`, rid, `${docName}.pdf`, 'application/pdf', 184320, 'demo', 1, 'stored', day(-4) + 'T10:00:00.000Z', day(-4) + 'T10:00:05.000Z'].map(q).join(',')});`);
  });
  out.push(`INSERT OR IGNORE INTO events(event_id,case_id,action,detail,actor_type,actor_id) VALUES (${q(id + '-created')},${q(id)},'case_created',${ADMIN_NAME},'staff',${ADMIN});`);
});
writeFileSync(new URL('./demo-data.sql', import.meta.url), out.join('\n') + '\n');
console.log(`${clients.length} clients, ${cases.length} cases, ${out.length} statements`);

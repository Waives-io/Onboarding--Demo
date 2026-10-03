import legacy from './intake.mjs';
import {HttpError,requireThat,clean,hash,randomToken,caseToken,caseLinkToken,localDate,deadlineState,israeliMobile,caseProgress,docCounts,periodText,validateFile,toCSV,validPassword,hashPassword,checkPassword,validPhone,phonePin,formatMobile} from './domain.mjs';
const ORIGIN='https://waives-io.github.io';
const SITE=ORIGIN+'/Onboarding--Demo/';
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const one=(db,sql,...args)=>stmt(db,sql,...args).first();
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results;
// actor is {type:'staff'|'client', id}. Receipts from Make and timeouts leave it empty (system).
const event=(db,id,action,detail='',actor=null)=>stmt(db,'INSERT INTO events(event_id,case_id,action,detail,actor_type,actor_id) VALUES (?,?,?,?,?,?)',uid(),id,action,detail,actor?.type||null,actor?.id||null);
const staffActor=me=>({type:'staff',id:me.staff_id});
function reply(body,status=200,origin='') { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{})}}); }
async function body(req) { requireThat(Number(req.headers.get('content-length')||0)<=1000000,'too_large',413); try{return await req.json();}catch{throw new HttpError(400,'invalid_json');} }
function active(c) {requireThat(!['closed','archived'].includes(c.status),'case_closed',409);}
// A pending upload older than this never got a receipt. Make times out after 25s, so it is safe to release the lock.
const PENDING_TTL_MS=15*60000;
function expirePending(db,caseId) {
 const cutoff=new Date(Date.now()-PENDING_TTL_MS).toISOString(),stale="state='pending' AND created_at<? AND requirement_id IN (SELECT requirement_id FROM requirements WHERE case_id=?)";
 return db.batch([
 stmt(db,`INSERT INTO events(event_id,case_id,action,detail) SELECT lower(hex(randomblob(16))),?,'upload_failed',filename FROM uploads WHERE ${stale}`,caseId,cutoff,caseId),
 stmt(db,`UPDATE uploads SET state='failed' WHERE ${stale}`,cutoff,caseId)
 ]);
}
function markFailed(db,caseId,u) {
 return db.batch([
 stmt(db,"INSERT INTO events(event_id,case_id,action,detail) SELECT ?,?,'upload_failed',filename FROM uploads WHERE submission_id=? AND state='pending'",uid(),caseId,u.submission_id),
 stmt(db,"UPDATE uploads SET state='failed' WHERE submission_id=? AND state='pending'",u.submission_id)
 ]);
}
// Make answers with this only when it knows the file was not stored (lookup miss or explicit failure).
// A lookup miss for a very recent upload may just mean Make is still running it.
const LOOKUP_GRACE_MS=2*60000;
const failedReceipt=(receipt,u)=>['failed','not_found'].includes(receipt?.status)&&receipt.submission_id===u.submission_id;
function syncCase(db,id) {
 return stmt(db,`UPDATE cases SET status=CASE
 WHEN status IN ('closed','archived') THEN status
 WHEN EXISTS(SELECT 1 FROM requirements WHERE case_id=cases.case_id AND status='correction') THEN 'action_required'
 WHEN NOT EXISTS(SELECT 1 FROM requirements WHERE case_id=cases.case_id AND status!='approved' AND (required=1 OR status!='missing')) THEN 'ready_for_work'
 WHEN NOT EXISTS(SELECT 1 FROM requirements WHERE case_id=cases.case_id AND required=1 AND status NOT IN ('uploaded','approved') AND unavailable_note IS NULL) THEN 'client_completed'
 ELSE 'collecting' END, last_activity=? WHERE case_id=?`,now(),id);
}
const DEFAULT_REMINDER='שלום {client},\nלתיק {case} חסרים:\n{missing}\nתאריך יעד: {due}\nלהעלאת המסמכים: {link}';
// What a visitor can choose on the landing page, in their words, and the case type it suggests to the office.
const NEEDS={refund:{label:'החזר מס',template:'ct-refund'},annual_individual:{label:'דוח שנתי – שכיר או יחיד',template:'ct-annual-individual'},annual_selfemployed:{label:'דוח שנתי – עצמאי',template:'ct-annual-selfemployed'},annual_company:{label:'דוח שנתי – חברה',template:'ct-annual-company'},open_business:{label:'פתיחת עסק',template:'ct-open-business'},capital:{label:'הצהרת הון',template:'ct-capital-declaration'},other:{label:'משהו אחר',template:null}};
// The link asks for the last 4 digits of the client's mobile. Every message says so, also a custom one.
const PIN_HINT='לכניסה: 4 הספרות האחרונות של הנייד שלך.';
const withPinHint=(text,phone)=>phonePin(phone)&&!text.includes('4 הספרות')?text+'\n'+PIN_HINT:text;
const PLACEHOLDERS=['client','request','case','period','due','missing','link','office'];
async function settings(db) {return await one(db,'SELECT * FROM settings WHERE id=1')||{office_name:'',warning_days:7,urgent_days:2,whatsapp_template:'',logo_version:0};}
// Read the version at use time so a concurrent revoke can never hand out the old link.
// A case loaded straight into the database (demo data, imports) has link_version 0 and no usable token yet.
// The first time the office asks for its link, version 1 is issued. The guard makes two first requests agree.
// 10 letters and digits (about 59 bits). It only leads to the PIN screen; the 4 digits and the lockout still guard the documents.
const BASE62='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const shortCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>BASE62[b%62]).join('');
const portalLink=async(env,db,id)=>{const version=async()=>(await one(db,'SELECT link_version FROM cases WHERE case_id=?',id)).link_version;
 if(await version()===0)await stmt(db,'UPDATE cases SET link_version=1,token_hash=? WHERE case_id=? AND link_version=0',await hash(await caseLinkToken(id,1,env.PORTAL_LINK_KEY)),id).run();
 await version();
 // Two first requests may race; the guard keeps the code that won.
 for(let i=0;i<5;i++){try{await stmt(db,'UPDATE cases SET short_code=? WHERE case_id=? AND short_code IS NULL',shortCode(),id).run();break;}catch(e){if(i===4)throw e;}}
 return SITE+'client.html#'+(await one(db,'SELECT short_code FROM cases WHERE case_id=?',id)).short_code;};
const ddmmyyyy=d=>String(d||'').split('-').reverse().join('/');
function reminderText(s,view,link) {
 const missing=view.requirements.filter(r=>['missing','correction'].includes(r.status)&&(r.required||r.status==='correction')&&!(r.status==='missing'&&r.unavailable_note!=null));
 const values={client:view.contact_name||view.client_name,request:view.name,case:view.name,period:periodText(view.period_start,view.period_end,view.reporting_period),due:ddmmyyyy(view.due_date),office:s.office_name,link,
  missing:missing.map(r=>'• '+r.name+(r.correction_message?' — '+r.correction_message:'')).join('\n')};
 if(!s.whatsapp_template)return {missing,text:withPinHint([`שלום ${values.client},`,`חסר לתיק ${view.name}: ${missing.map(r=>r.name+(r.correction_message?' (לתקן: '+r.correction_message+')':'')).join(', ')}`,`להעלאה: ${link}`,...(view.due_date?[`עד ${ddmmyyyy(view.due_date).slice(0,5)}`]:[])].join('\n'),view.phone)};
 return {missing,text:withPinHint(s.whatsapp_template.replace(/\{(\w+)\}/g,(m,k)=>k in values?values[k]:m),view.phone)};
}
// The first message, when a case opens: what the office needs and the link. A reminder is a different message (reminderText).
const ddmm=d=>ddmmyyyy(d).slice(0,5);
function openingText(s,view,link) {
 const lines=[`שלום ${view.contact_name||view.client_name},`,`פתחנו לך תיק ${view.name}. נצטרך: ${view.requirements.filter(r=>r.required).map(r=>r.name).join(', ')}`,`להעלאה: ${link}`];
 if(view.due_date)lines.push(`עד ${ddmm(view.due_date)}`);
 return withPinHint(lines.join('\n'),view.phone)+(s.office_name?'\n'+s.office_name:'');
}
const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The email version of a message: the same words, right to left, with the link as a button.
function emailHtml(text,link) {
 const body=text.split('\n').filter(l=>!l.includes(link)).map(escHtml).join('<br>');
 return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#1b1b1f;text-align:right;max-width:560px">${body}<p style="margin:22px 0"><a href="${escHtml(link)}" style="display:inline-block;background:#2e9e64;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:12px">להעלאת המסמכים</a></p></div>`;
}
// The office's last contact with the client about a case: when, how, and how many times.
const contactSql=t=>`(SELECT count(*) FROM contacts WHERE case_id=${t}.case_id) contact_count,(SELECT max(created_at) FROM contacts WHERE case_id=${t}.case_id) last_contact_at,(SELECT channel FROM contacts WHERE case_id=${t}.case_id ORDER BY created_at DESC LIMIT 1) last_channel`;
// One definition of "waiting for review" for the approve-all button, the route and its events.
const REVIEWABLE="r.case_id=? AND r.status='uploaded' AND EXISTS(SELECT 1 FROM uploads u WHERE u.requirement_id=r.requirement_id AND u.state='stored') AND NOT EXISTS(SELECT 1 FROM uploads u WHERE u.requirement_id=r.requirement_id AND u.state='pending')";
const caseMeta=(c,requirements,s,today)=>({...caseProgress(c.status,requirements),...docCounts(requirements),...deadlineState(c.due_date,c.status,today,s.warning_days,s.urgent_days)});
// Every request re-reads the staff row, so a deactivated member or a role change takes effect at once.
async function office(req,db) {
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 requireThat(/^[a-f0-9]{64}$/.test(token),'unauthorized',401);
 const th=await hash(token),time=Date.now();
 const me=await one(db,'SELECT s.token_hash,s.last_seen_at seen,st.staff_id,st.name,st.email,st.role FROM sessions s JOIN staff st USING(staff_id) WHERE s.token_hash=? AND s.expires_at>? AND st.active=1',th,time);
 requireThat(me,'unauthorized',401);
 if(!me.seen||me.seen<time-5*60000)await db.batch([stmt(db,'UPDATE sessions SET last_seen_at=? WHERE token_hash=?',time,th),stmt(db,'UPDATE staff SET last_seen_at=? WHERE staff_id=?',now(),me.staff_id)]);
 delete me.seen;return me;
}
const isAdmin=me=>me.role==='admin';
const adminOnly=me=>requireThat(isAdmin(me),'forbidden',403);
// A manager sees the cases they own, and the clients they created or own a case for.
const CLIENT_SCOPE='(cl.created_by=? OR EXISTS(SELECT 1 FROM cases x WHERE x.client_id=cl.client_id AND x.owner_id=?))';
async function visibleClient(db,me,id){return one(db,`SELECT cl.* FROM clients cl WHERE cl.client_id=?${isAdmin(me)?'':' AND '+CLIENT_SCOPE}`,id,...(isAdmin(me)?[]:[me.staff_id,me.staff_id]));}
// Someone else's case answers 404, the same as a case that does not exist.
async function ownCase(db,me,id){const c=await one(db,'SELECT * FROM cases WHERE case_id=?',id);requireThat(c&&(isAdmin(me)||c.owner_id===me.staff_id),'not_found',404);return c;}
async function activeStaff(db,id){const s=await one(db,'SELECT staff_id,name FROM staff WHERE staff_id=? AND active=1',id);requireThat(s,'staff_not_found',404);return s;}
// Counts every attempt from an address, before any password work, so the key derivation cannot be used to burn CPU.
async function limited(db,key,max){const bucket=await hash(key),time=Date.now();
 await stmt(db,'INSERT INTO login_limits(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END',bucket,time+900000,time,time).run();
 requireThat((await one(db,'SELECT attempts FROM login_limits WHERE bucket=?',bucket)).attempts<=max,'too_many_attempts',429);return bucket;}
async function newSession(db,staffId){const token=randomToken(),time=Date.now();
 await db.batch([stmt(db,'INSERT INTO sessions(token_hash,expires_at,staff_id,last_seen_at) VALUES (?,?,?,?)',await hash(token),time+8*3600000,staffId,time),stmt(db,'DELETE FROM sessions WHERE expires_at<?',time),stmt(db,'UPDATE staff SET last_seen_at=? WHERE staff_id=?',now(),staffId)]);return token;}
const emailOf=v=>{const e=clean(v,254,true).toLowerCase();requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),'invalid_email');return e;};
// Unknown emails still run exactly one derivation, so response time does not tell which emails exist.
// On a fresh isolate that one derivation is the one that creates the dummy record.
let dummy;
async function verify(password,stored){if(stored)return checkPassword(password,stored);if(!dummy){dummy=await hashPassword(password);return false;}await checkPassword(password,dummy);return false;}
// The link is the key to the case; the last 4 digits of the client's mobile are a second check, so a forwarded link alone
// does not open the documents. Wrong digits are counted per case: 8 tries per 15 minutes, then even the right digits wait.
const PIN_TRIES=8;
async function portal(req,db) {
 const token=req.headers.get('X-Case-Token')||'';
 requireThat(/^[a-f0-9]{64}$/.test(token),'unauthorized',401);
 const c=await one(db,'SELECT cases.*,clients.name AS client_name,clients.contact_name,clients.reference AS client_reference,clients.email AS client_email,clients.phone AS client_phone FROM cases JOIN clients USING(client_id) WHERE token_hash=?',await hash(token)); requireThat(c,'unauthorized',401);
 const pin=phonePin(c.client_phone);delete c.client_phone;
 if(pin){const key='pin:'+c.case_id,l=await one(db,'SELECT attempts,expires_at FROM login_limits WHERE bucket=?',await hash(key));
  requireThat(!(l&&l.expires_at>Date.now()&&l.attempts>=PIN_TRIES),'too_many_attempts',429);
  const given=String(req.headers.get('X-Case-Pin')||'').slice(0,8);
  if(given!==pin){if(given)await limited(db,key,PIN_TRIES);throw new HttpError(401,given?'wrong_pin':'pin_required');}}
 return c;
}
async function caseView(db,id,isOffice=false) {
 const c=await one(db,`SELECT cases.*,clients.name AS client_name,clients.contact_name,clients.reference,clients.email,clients.phone,clients.business_number,staff.name AS owner_name${isOffice?','+contactSql('cases'):''} FROM cases JOIN clients USING(client_id) LEFT JOIN staff ON staff.staff_id=cases.owner_id WHERE case_id=?`,id);
 requireThat(c,'not_found',404); delete c.token_hash;
 const requirements=await all(db,'SELECT * FROM requirements WHERE case_id=? ORDER BY position',id);
 for(const r of requirements){r.uploads=await all(db,`SELECT submission_id,filename,mime_type,size,version,state,created_at,stored_at${isOffice?',drive_file_id,drive_folder_id,client_note':''} FROM uploads WHERE requirement_id=? ORDER BY version DESC`,r.requirement_id);if(!isOffice)delete r.drive_folder_id;}
 const meta=caseMeta(c,requirements,await settings(db),localDate());
 if(isOffice)meta.whatsapp=israeliMobile(c.phone);
 if(!isOffice){for(const k of ['email','phone','business_number','drive_folder_id','client_id','reference','link_version','owner','owner_id','owner_name'])delete c[k];}
 return {...c,...meta,requirements,...(isOffice?{events:await all(db,'SELECT e.*,s.name actor_name FROM events e LEFT JOIN staff s ON s.staff_id=e.actor_id WHERE e.case_id=? ORDER BY e.created_at DESC LIMIT 100',id)}:{})};
}
// The office identifies a client by name and company number. The client number is internal (Drive folders, exports),
// so the office never types it: a new client gets the next C-number.
function clientFields(b) {
 const r={name:clean(b.name,120,true),contact_name:clean(b.contact_name||'',120),business_number:clean(b.business_number||'',40),email:clean(b.email??'',254,true),phone:clean(b.phone??'',40,true),notes:clean(b.notes||'',2000),regular_template_id:clean(b.regular_template_id||'',64)||null};
 // Email and phone are how the office sends the link and reminders, so a client cannot be saved without both.
 requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email),'invalid_email');requireThat(validPhone(r.phone),'invalid_phone');return r;
}
// The regular document list must exist. Any staff member may set it; only admins edit the lists themselves.
async function checkTemplate(db,r){if(r.regular_template_id)requireThat(await one(db,'SELECT 1 FROM templates WHERE template_id=?',r.regular_template_id),'template_not_found',404);}
async function insertClient(db,id,b,createdBy) {const r=clientFields(b);await checkTemplate(db,r);
 // Two offices adding a client at once can pick the same number; the UNIQUE index refuses one, which then takes the next.
 for(let i=0;i<5;i++){const n=(await one(db,"SELECT max(CAST(substr(reference,3) AS INTEGER)) n FROM clients WHERE reference GLOB 'C-[0-9]*'"))?.n,ref='C-'+(Math.max(Number(n)||1000,1000)+1);
  try{await stmt(db,'INSERT INTO clients(client_id,name,reference,business_number,email,phone,notes,created_by,contact_name,regular_template_id) VALUES (?,?,?,?,?,?,?,?,?,?)',id,r.name,ref,r.business_number,r.email,r.phone,r.notes,createdBy,r.contact_name,r.regular_template_id).run();return ref;}catch(e){if(!/UNIQUE/i.test(String(e?.message)))throw e;}}
 throw new HttpError(409,'conflict');}
// owner is the staff member already checked by the caller. The old owner text keeps their name for exports.
async function caseStatements(db,b,env,me,owner) {
 const id=uid();
 requireThat(await visibleClient(db,me,b.client_id),'client_not_found',404);
 const isDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const name=clean(b.name,160,true),type=clean(b.type||'custom',80,true),category=clean(b.category||'',80),due=clean(b.due_date,10,true);
 requireThat(isDate(due),'invalid_due_date');
 // The office picks a date range. Imports may still send a free-text period.
 const start=b.period_start||null,end=b.period_end||null;
 if(start||end)requireThat(isDate(start)&&isDate(end)&&start<=end,'invalid_period');
 const period=start?`${ddmmyyyy(start)}–${ddmmyyyy(end)}`:clean(b.reporting_period,80,true);
 let items=b.requirements;
 if(!items && b.template_id)items=await all(db,'SELECT ti.*,dc.name FROM template_items ti JOIN document_catalog dc USING(document_id) WHERE template_id=? ORDER BY position',b.template_id);
 requireThat(Array.isArray(items)&&items.length>0&&items.length<=40,'requirements_required');
 requireThat(items.some(r=>r.required===true||r.required===1),'mandatory_requirement_required');
 const token=await caseToken(id,env.PORTAL_LINK_KEY);
 const statements=[stmt(db,'INSERT INTO cases(case_id,client_id,name,type,category,reporting_period,period_start,period_end,due_date,owner,owner_id,token_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,b.client_id,name,type,category,period,start,end,due,owner.name,owner.staff_id,await hash(token))];
 for(const [i,r] of items.entries()) {const max=Number(r.max_files||1);requireThat(Number.isInteger(max)&&max>=1&&max<=20);statements.push(stmt(db,'INSERT INTO requirements(requirement_id,case_id,document_id,name,required,max_files,position) VALUES (?,?,?,?,?,?,?)',uid(),id,r.document_id||null,clean(r.name,160,true),r.required?1:0,max,i));}
 statements.push(event(db,id,'case_created',owner.name,staffActor(me)));return {id,token,statements};
}
function bridge(env) {
 const url=new URL(env.LOCAL_BRIDGE_URL||env.MAKE_WEBHOOK_URL||'https://invalid.invalid');
 const localBridge=env.LOCAL_BRIDGE_URL && ['127.0.0.1','localhost'].includes(url.hostname) && url.protocol==='http:';
 requireThat((localBridge || url.protocol==='https:' && /^hook(?:\.[a-z0-9-]+)?\.make\.com$/.test(url.hostname)) && !url.search && !url.hash && !url.username,'not_configured',503);
 requireThat(env.MAKE_BRIDGE_KEY?.length>=32 && env.PORTAL_BRIDGE_ENABLED==='true','integration_not_ready',503);
 return url;
}
async function make(env,payload) {
 const url=bridge(env);
 payload.set('bridge_key',env.MAKE_BRIDGE_KEY);payload.set('schema_version','2');payload.set('test_mode','true');
 const response=await fetch(url,{method:'POST',body:payload,redirect:'manual',signal:AbortSignal.timeout(25000)});
 requireThat(response.ok,'storage_unconfirmed',502);try{return await response.json();}catch{throw new HttpError(502,'storage_unconfirmed');}
}
async function storeReceipt(db,u,receipt) {
 requireThat(receipt.status==='stored' && receipt.submission_id===u.submission_id && /^[\w-]{5,200}$/.test(receipt.drive_file_id||'') && /^[\w-]{5,200}$/.test(receipt.drive_folder_id||'') && receipt.sheet_updated===true,'storage_unconfirmed',502);
 if(u.state==='stored'){requireThat(u.drive_file_id===receipt.drive_file_id,'receipt_conflict',409);return;}
 const r=await one(db,'SELECT requirement_id,case_id FROM requirements WHERE requirement_id=?',u.requirement_id),sid=u.submission_id;
 // Two receipts for one submission (Make callback and Make response) can race. Every status change is guarded
 // on the upload still being pending inside the same transaction, and the upload row flips last, so only one wins.
 // A late receipt for a failed upload records the file but leaves requirement and case status alone.
 const pending="EXISTS(SELECT 1 FROM uploads WHERE submission_id=? AND state='pending')",failed="EXISTS(SELECT 1 FROM uploads WHERE submission_id=? AND state='failed')";
 await db.batch([
 stmt(db,`UPDATE requirements SET status='uploaded',correction_message='',unavailable_note=NULL,unavailable_at=NULL WHERE requirement_id=? AND ${pending}`,r.requirement_id,sid),
 stmt(db,'UPDATE requirements SET drive_folder_id=coalesce(drive_folder_id,?) WHERE requirement_id=?',receipt.drive_folder_id,r.requirement_id),
 stmt(db,`UPDATE cases SET completed_at=NULL WHERE case_id=? AND ${pending}`,r.case_id,sid),
 stmt(db,'UPDATE cases SET drive_folder_id=coalesce(drive_folder_id,?) WHERE case_id=?',receipt.drive_folder_id,r.case_id),
 syncCase(db,r.case_id),
 // The last required document moves the case to the office. Record that moment once, like the old "finished" step did.
 stmt(db,"INSERT INTO events(event_id,case_id,action,detail) SELECT ?,case_id,'client_completed','' FROM cases WHERE case_id=? AND status='client_completed' AND client_completed_at IS NULL",uid(),r.case_id),
 stmt(db,"UPDATE cases SET client_completed_at=? WHERE case_id=? AND status='client_completed' AND client_completed_at IS NULL",now(),r.case_id),
 stmt(db,`INSERT INTO events(event_id,case_id,action,detail) SELECT ?,?,CASE WHEN ${pending} THEN 'upload_stored' ELSE 'upload_stored_late' END,? WHERE ${pending} OR ${failed}`,uid(),r.case_id,sid,u.filename,sid,sid),
 stmt(db,"UPDATE uploads SET state='stored',drive_file_id=?,drive_folder_id=?,stored_at=? WHERE submission_id=? AND state IN ('pending','failed')",receipt.drive_file_id,receipt.drive_folder_id,now(),sid)
 ]);
 const after=await one(db,'SELECT state,drive_file_id FROM uploads WHERE submission_id=?',sid);
 requireThat(after.state==='stored'&&after.drive_file_id===receipt.drive_file_id,'receipt_conflict',409);
}
async function handle(req,env) {
 const path=new URL(req.url).pathname,method=req.method,db=env.DB;
 requireThat(db,'not_configured',503);
 if(path==='/api/health')return {ok:true,version:2,storage_ready:env.PORTAL_BRIDGE_ENABLED==='true'};
 const ip='ip:'+(req.headers.get('CF-Connecting-IP')||'local'),noAdmin=async()=>!await one(db,"SELECT 1 FROM staff WHERE role='admin' AND active=1");
 if(path==='/api/auth-state'&&method==='GET')return {setup_required:await noAdmin()};
 // The office code is only a key for creating the first admin. Once an admin exists it opens nothing.
 if(path==='/api/setup'&&method==='POST') {
 const b=await body(req);await limited(db,ip,20);
 requireThat(await noAdmin(),'already_set_up',409);
 requireThat(env.OFFICE_CODE?.length>=8,'not_configured',503);
 requireThat(typeof b.code==='string'&&b.code.length<=200&&await hash(b.code)===await hash(env.OFFICE_CODE),'unauthorized',401);
 requireThat(validPassword(b.password),'weak_password');
 const id=uid(),done=await stmt(db,"INSERT INTO staff(staff_id,name,email,role,pw) SELECT ?,?,?,'admin',? WHERE NOT EXISTS(SELECT 1 FROM staff WHERE role='admin' AND active=1)",id,clean(b.name,120,true),emailOf(b.email),await hashPassword(b.password)).run();
 requireThat(done.meta.changes===1,'already_set_up',409);return {token:await newSession(db,id)};
 }
 if(path==='/api/login'&&method==='POST') {
 const b=await body(req);await limited(db,ip,30);
 const email=typeof b.email==='string'?b.email.trim().toLowerCase().slice(0,254):'',account=await limited(db,'account:'+email,10);
 const s=await one(db,'SELECT staff_id,pw FROM staff WHERE email=? AND active=1',email);
 const ok=await verify(typeof b.password==='string'?b.password.slice(0,200):'',s?.pw);
 requireThat(s&&ok,'unauthorized',401);
 await stmt(db,'DELETE FROM login_limits WHERE bucket=?',account).run();return {token:await newSession(db,s.staff_id)};
 }
 if(path==='/api/storage-receipt'&&method==='POST') {
 requireThat(env.MAKE_BRIDGE_KEY?.length>=32 && await hash(req.headers.get('X-Bridge-Key')||'')===await hash(env.MAKE_BRIDGE_KEY),'unauthorized',401);
 const b=await body(req),u=await one(db,'SELECT * FROM uploads WHERE submission_id=?',b.submission_id);requireThat(u,'not_found',404);await storeReceipt(db,u,b);return {ok:true};
 }
 if(path.startsWith('/api/short/')&&method==='GET'){const code=path.slice(11);requireThat(/^[A-Za-z0-9]{10}$/.test(code),'not_found',404);await limited(db,'short:'+ip,60);
  const c=await one(db,'SELECT case_id,link_version FROM cases WHERE short_code=?',code);requireThat(c,'not_found',404);return {token:await caseLinkToken(c.case_id,c.link_version,env.PORTAL_LINK_KEY)};}
 if(path==='/api/branding'&&method==='GET'){const x=await settings(db);return {office_name:x.office_name,logo_version:x.logo_version};}
 if(path==='/api/logo'&&method==='GET'){const l=await one(db,'SELECT mime,data FROM logo WHERE id=1');requireThat(l,'not_found',404);
  return new Response(Uint8Array.from(atob(l.data),ch=>ch.charCodeAt(0)),{headers:{'Content-Type':l.mime,'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});}
 if(path.startsWith('/api/portal')) {
 const c=await portal(req,db);
 if(path==='/api/portal'&&method==='GET'){if(['closed','archived'].includes(c.status))return {closed:true,status:c.status,name:c.name,client_name:c.client_name,contact_name:c.contact_name,requirements:[]};await expirePending(db,c.case_id);
  await stmt(db,"INSERT OR IGNORE INTO events(event_id,case_id,action,detail,actor_type,actor_id) VALUES (?,?,'client_opened','','client',?)",'opened-'+c.case_id+'-'+Math.floor(Date.now()/21600000),c.case_id,c.client_id).run();
  return caseView(db,c.case_id);}
 active(c);
 if(path==='/api/portal/complete'&&method==='POST') {
 const missing=await one(db,"SELECT count(*) AS n FROM requirements WHERE case_id=? AND (status='correction' OR (required=1 AND status NOT IN ('uploaded','approved') AND unavailable_note IS NULL))",c.case_id);
 requireThat(missing.n===0,'missing_requirements',409);
 await db.batch([stmt(db,'UPDATE cases SET client_completed_at=? WHERE case_id=?',now(),c.case_id),syncCase(db,c.case_id),event(db,c.case_id,'client_completed','',{type:'client',id:c.client_id})]);return caseView(db,c.case_id);
 }
 // The client says they do not have a document, with an optional reason. It counts as answered, and the office approves
 // the absence or asks for the document anyway. Uploading a file later clears it. Only a missing document can be marked.
 if(path==='/api/portal/unavailable'&&method==='POST') {
 const b=await body(req),r=await one(db,'SELECT * FROM requirements WHERE requirement_id=? AND case_id=?',b.requirement_id,c.case_id);requireThat(r,'not_found',404);
 requireThat(r.status==='missing','not_missing',409);
 const undo=b.undo===true,note=undo?null:clean(b.note??'',500),who={type:'client',id:c.client_id};
 // A required document the client does not have needs a reason, so the office can decide what to do.
 requireThat(undo||note.length>=2,'reason_required');
 await db.batch([
  stmt(db,"UPDATE requirements SET unavailable_note=?,unavailable_at=? WHERE requirement_id=? AND status='missing'",note,undo?null:now(),r.requirement_id),
  syncCase(db,c.case_id),
  stmt(db,"UPDATE cases SET client_completed_at=NULL WHERE case_id=? AND status='collecting'",c.case_id),
  stmt(db,"INSERT INTO events(event_id,case_id,action,detail,actor_type,actor_id) SELECT ?,case_id,'client_completed','','client',? FROM cases WHERE case_id=? AND status='client_completed' AND client_completed_at IS NULL",uid(),c.client_id,c.case_id),
  stmt(db,"UPDATE cases SET client_completed_at=? WHERE case_id=? AND status='client_completed' AND client_completed_at IS NULL",now(),c.case_id),
  event(db,c.case_id,undo?'client_unavailable_undone':'client_unavailable',r.name+(note?': '+note:''),who)]);
 return caseView(db,c.case_id);
 }
 if(path==='/api/portal/uploads'&&method==='POST') {
 bridge(env);
 requireThat(Number(req.headers.get('content-length')||0)<=4500000,'too_large',413);
 let form;try{form=await req.formData();}catch{throw new HttpError(400,'invalid_form');}
 const rid=form.get('requirement_id');let submission=form.get('submission_id');
 // The client's note goes to the office only: not to Make, events, exports or the client view. Too long is refused, not cut.
 const rawNote=form.get('client_note');requireThat(rawNote===null||typeof rawNote==='string','invalid_fields');const note=rawNote===null?'':clean(rawNote,500)||null;
 requireThat(typeof submission==='string'&&/^[0-9a-f-]{36}$/.test(submission),'invalid_submission_id');
 const r=await one(db,'SELECT * FROM requirements WHERE requirement_id=? AND case_id=?',rid,c.case_id);requireThat(r,'not_found',404);
 const file=form.get('file'),f=await validateFile(file);
 await expirePending(db,c.case_id);
 const prior=await one(db,'SELECT * FROM uploads WHERE submission_id=?',submission);
 if(prior){requireThat(prior.requirement_id===rid&&prior.content_hash===f.contentHash&&(prior.client_note||null)===(note||null),'submission_conflict',409);if(prior.state!=='failed')return {submission_id:submission,status:prior.state, retry_safe:false};
 // A failed attempt keeps its id so a late receipt can only ever match that attempt. The retry is a new submission.
 submission=uid();}
 requireThat(r.status!=='approved','already_approved',409);
 const count=await one(db,"SELECT count(*) n FROM uploads WHERE requirement_id=? AND state='stored'",rid);
 requireThat(r.status==='correction'||count.n<r.max_files,'max_files',409);
 const pending=await one(db,"SELECT submission_id FROM uploads WHERE requirement_id=? AND state='pending'",rid);requireThat(!pending,'upload_pending',409);
 const version=(await one(db,'SELECT coalesce(max(version),0)+1 AS n FROM uploads WHERE requirement_id=?',rid)).n;
 // The approval check is repeated inside the insert so an approval that lands after the reads above wins.
 // The upload_pending_lock index allows one pending upload per requirement.
 let claimed;try{claimed=(await stmt(db,"INSERT INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version,client_note) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM requirements WHERE requirement_id=? AND status!='approved')",submission,rid,f.filename,f.mime,f.size,f.contentHash,version,note||null,rid).run()).meta.changes===1;}catch{throw new HttpError(409,'upload_pending');}
 requireThat(claimed,'already_approved',409);
 const u=await one(db,'SELECT * FROM uploads WHERE submission_id=?',submission);
 if(env.FILES)await env.FILES.put('file:'+submission,await file.arrayBuffer(),{metadata:{mime:f.mime,filename:f.filename},expirationTtl:15552000}).catch(()=>{});
 const payload=new FormData();for(const [k,v]of Object.entries({action:r.drive_folder_id?'upload_document_revision':'upload_document',submission_id:submission,client_id:c.client_id,client_reference:c.client_reference,full_name:c.client_name,email:c.client_email,case_id:c.case_id,requirement_id:rid,requirement_name:r.name,reporting_period:c.reporting_period,version:String(version),filename:f.filename,content_hash:f.contentHash,requirement_folder_id:r.drive_folder_id||'',note:r.drive_folder_id||''}))payload.set(k,v);
 payload.set('file_1',file,f.filename);
 const waiting={submission_id:submission,status:'pending',message:'ממתין לאישור שמירה. אין להעלות שוב.'};
 let receipt;try{receipt=await make(env,payload);}catch{return waiting;}
 if(failedReceipt(receipt,u)){await markFailed(db,c.case_id,u);throw new HttpError(502,'storage_failed');}
 try{await storeReceipt(db,u,receipt);return {submission_id:submission,status:'stored'};}catch{return waiting;}
 }
 throw new HttpError(404,'not_found');
 }
 // The public landing page. A visitor leaves their details and what they need; the office sees it as a new inquiry
 // and opens a client and a case from it. Nothing is created for the client until the office decides.
 if(path==='/api/inquiries'&&method==='POST') {
 const b=await body(req);
 // A filled hidden field means a bot. It gets the same answer as a person, and nothing is saved.
 if(b.website)return {ok:true};
 await limited(db,'inquiry:'+ip,5);
 requireThat(b.consent===true,'consent_required');
 const phone=formatMobile(clean(b.phone??'',40,true));requireThat(phone,'invalid_mobile');
 const need=clean(b.need??'',40,true);requireThat(need in NEEDS,'invalid_fields');
 const tpl=NEEDS[need].template&&await one(db,'SELECT template_id FROM templates WHERE template_id=?',NEEDS[need].template);
 await stmt(db,'INSERT INTO inquiries(inquiry_id,name,contact_name,business_number,phone,email,need,template_id,note,source) VALUES (?,?,?,?,?,?,?,?,?,?)',
  uid(),clean(b.name??'',120,true),clean(b.contact_name??'',120),clean(b.business_number??'',40),phone,emailOf(b.email),NEEDS[need].label,tpl?.template_id||null,clean(b.note??'',500),clean(b.source??'',60)).run();
 return {ok:true};
 }
 // Deny by default: every route below either checks adminOnly, or limits a manager to their own cases and clients.
 const me=await office(req,db),actor=staffActor(me);
 if(path==='/api/logout'&&method==='POST'){await stmt(db,'DELETE FROM sessions WHERE token_hash=?',me.token_hash).run();return {ok:true};}
 if(path==='/api/me'&&method==='GET')return {staff_id:me.staff_id,name:me.name,email:me.email,role:me.role};
 if(path==='/api/me/password'&&method==='POST'){const b=await body(req);await limited(db,'account:'+me.email,10);
  requireThat(await checkPassword(String(b.current??'').slice(0,200),(await one(db,'SELECT pw FROM staff WHERE staff_id=?',me.staff_id)).pw),'wrong_password',403);
  requireThat(validPassword(b.password),'weak_password');
  // Other devices are signed out. This one stays in.
  await db.batch([stmt(db,'UPDATE staff SET pw=? WHERE staff_id=?',await hashPassword(b.password),me.staff_id),stmt(db,'DELETE FROM sessions WHERE staff_id=? AND token_hash!=?',me.staff_id,me.token_hash)]);return {ok:true};}
 if(path==='/api/staff'&&method==='GET')return isAdmin(me)
  ?all(db,"SELECT staff_id,name,email,role,active,created_at,last_seen_at,(SELECT count(*) FROM cases WHERE owner_id=staff.staff_id AND status NOT IN ('closed','archived')) open_cases FROM staff ORDER BY active DESC,name")
  :all(db,'SELECT staff_id,name,role FROM staff WHERE active=1 ORDER BY name');
 if(path==='/api/staff'&&method==='POST'){adminOnly(me);const b=await body(req);requireThat(['admin','manager'].includes(b.role));
  const role=b.role,active=b.active===false?0:1,name=clean(b.name,120,true),email=emailOf(b.email);
  requireThat(b.password===undefined||b.password===''||validPassword(b.password),'weak_password');
  requireThat(!await one(db,'SELECT staff_id FROM staff WHERE email=? AND staff_id!=?',email,b.staff_id||''),'duplicate_email',409);
  if(!b.staff_id){requireThat(validPassword(b.password),'weak_password');const id=uid();
   await stmt(db,'INSERT INTO staff(staff_id,name,email,role,pw,active) VALUES (?,?,?,?,?,?)',id,name,email,role,await hashPassword(b.password),active).run();return {staff_id:id};}
  const cur=await one(db,'SELECT * FROM staff WHERE staff_id=?',b.staff_id);requireThat(cur,'not_found',404);
  // The office always keeps one active admin. The check sits inside the update so two admins cannot demote each other at once.
  const keepsAdmin=role==='admin'&&active===1?1:0;
  const done=await db.batch([
   stmt(db,"UPDATE staff SET name=?,email=?,role=?,active=?,pw=coalesce(?,pw) WHERE staff_id=? AND (?=1 OR EXISTS(SELECT 1 FROM staff o WHERE o.role='admin' AND o.active=1 AND o.staff_id!=staff.staff_id))",name,email,role,active,b.password?await hashPassword(b.password):null,cur.staff_id,keepsAdmin),
   // A new role, a deactivation or a new password signs the member out everywhere. Both follow-ups run only if the update above did.
   ...(role!==cur.role||active!==cur.active||b.password?[stmt(db,'DELETE FROM sessions WHERE staff_id=? AND EXISTS(SELECT 1 FROM staff WHERE staff_id=? AND role=? AND active=?)',cur.staff_id,cur.staff_id,role,active)]:[]),
   stmt(db,'UPDATE cases SET owner=? WHERE owner_id=? AND EXISTS(SELECT 1 FROM staff WHERE staff_id=? AND role=? AND active=?)',name,cur.staff_id,cur.staff_id,role,active)]);
  requireThat(done[0].meta.changes===1,'last_admin',409);return {staff_id:cur.staff_id};}
 // Cases from before personal logins carry a free-text owner. The admin maps each name to a staff member once.
 if(path==='/api/owners/legacy'&&method==='GET'){adminOnly(me);return all(db,'SELECT owner,count(*) cases FROM cases WHERE owner_id IS NULL GROUP BY owner ORDER BY owner');}
 if(path==='/api/owners/map'&&method==='POST'){adminOnly(me);const b=await body(req),s=await activeStaff(db,b.staff_id);
  const r=await stmt(db,'UPDATE cases SET owner_id=?,owner=? WHERE owner_id IS NULL AND owner=?',s.staff_id,s.name,clean(b.owner??'',100)).run();return {mapped:r.meta.changes};}
 // Inquiries belong to the whole office, so every staff member sees the new ones and can open a case from them.
 if(path==='/api/inquiries'&&method==='GET')return all(db,"SELECT * FROM inquiries WHERE status='new' ORDER BY created_at DESC LIMIT 200");
 const inquiryMatch=path.match(/^\/api\/inquiries\/([\w-]+)$/);
 if(inquiryMatch&&method==='POST'){const b=await body(req);requireThat(['handled','dismissed'].includes(b.status));
  if(b.client_id)requireThat(await visibleClient(db,me,b.client_id),'client_not_found',404);
  const done=await stmt(db,"UPDATE inquiries SET status=?,client_id=?,handled_at=?,handled_by=? WHERE inquiry_id=? AND status='new'",b.status,b.client_id||null,now(),me.staff_id,inquiryMatch[1]).run();
  requireThat(done.meta.changes===1,'not_found',404);return {ok:true};}
 if(path==='/api/clients'&&method==='GET')return isAdmin(me)?all(db,'SELECT * FROM clients ORDER BY name'):all(db,`SELECT cl.* FROM clients cl WHERE ${CLIENT_SCOPE} ORDER BY cl.name`,me.staff_id,me.staff_id);
 const clientMatch=path.match(/^\/api\/clients\/([\w-]+)$/);
 if(clientMatch&&method==='POST'){const id=clientMatch[1],b=await body(req),r=clientFields(b);requireThat(await visibleClient(db,me,id),'not_found',404);
  // A client that also has someone else's case is edited by an admin.
  if(!isAdmin(me))requireThat(!await one(db,'SELECT 1 FROM cases WHERE client_id=? AND (owner_id IS NULL OR owner_id!=?)',id,me.staff_id),'forbidden',403);
  await checkTemplate(db,r);
  await stmt(db,"UPDATE clients SET name=?,contact_name=?,business_number=?,email=?,phone=?,notes=?,regular_template_id=?,updated_at=? WHERE client_id=?",r.name,r.contact_name,r.business_number,r.email,r.phone,r.notes,r.regular_template_id,now(),id).run();return {client_id:id};}
 if(path==='/api/settings'&&method==='GET')return settings(db);
 if(path==='/api/settings'&&method==='POST'){adminOnly(me);const b=await body(req),w=Number(b.warning_days),u=Number(b.urgent_days),t=clean(b.whatsapp_template||'',1000);
  requireThat(Number.isInteger(w)&&Number.isInteger(u)&&u>=0&&u<w&&w<=60,'invalid_deadline_days');
  requireThat([...t.matchAll(/\{([^{}]*)\}/g)].every(m=>PLACEHOLDERS.includes(m[1])),'invalid_template_placeholder');
  requireThat(!b.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email));
  await stmt(db,'UPDATE settings SET office_name=?,office_size=?,manager_name=?,phone=?,email=?,address=?,warning_days=?,urgent_days=?,whatsapp_template=?,updated_at=? WHERE id=1',
   clean(b.office_name||'',120),clean(b.office_size||'',40),clean(b.manager_name||'',120),clean(b.phone||'',40),clean(b.email||'',254),clean(b.address||'',200),w,u,t,now()).run();return settings(db);}
 if(path==='/api/settings/logo'&&method==='POST'){adminOnly(me);const b=await body(req);
  if(!b.data){await db.batch([stmt(db,'DELETE FROM logo WHERE id=1'),stmt(db,'UPDATE settings SET logo_version=logo_version+1 WHERE id=1')]);return settings(db);}
  let bytes;try{bytes=Uint8Array.from(atob(String(b.data)),ch=>ch.charCodeAt(0));}catch{throw new HttpError(400,'invalid_file');}
  requireThat(bytes.length>=8&&bytes.length<=200*1024,'logo_too_large',413);
  const mime=[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
  requireThat(mime,'invalid_file_signature');
  // Store a re-encoded copy of the verified bytes, never the caller's string.
  let bin='';for(const x of bytes)bin+=String.fromCharCode(x);
  await db.batch([stmt(db,'INSERT INTO logo(id,mime,data) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET mime=excluded.mime,data=excluded.data',mime,btoa(bin)),stmt(db,'UPDATE settings SET logo_version=logo_version+1 WHERE id=1')]);return settings(db);}
 if(path==='/api/clients'&&method==='POST'){const b=await body(req),id=uid();return {client_id:id,reference:await insertClient(db,id,b,me.staff_id)};}
 if(path.startsWith('/api/files/')&&method==='GET'){const sid=path.slice(11);requireThat(/^[\w-]{1,80}$/.test(sid),'not_found',404);
  const u=await one(db,'SELECT u.submission_id,u.filename,u.mime_type,r.case_id FROM uploads u JOIN requirements r USING(requirement_id) WHERE u.submission_id=?',sid);requireThat(u,'not_found',404);await ownCase(db,me,u.case_id);
  const file=env.FILES?await env.FILES.get('file:'+sid,'arrayBuffer'):null;requireThat(file,'no_preview',404);
  return new Response(file,{headers:{'Content-Type':u.mime_type,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(u.filename)}});}
 if(path==='/api/cases'&&method==='GET'){const scope=isAdmin(me)?'':' WHERE c.owner_id=?',args=isAdmin(me)?[]:[me.staff_id];return all(db,`SELECT c.*,cl.name client_name,cl.reference,cl.business_number,cl.email,cl.phone,st.name owner_name,${contactSql('c')},(SELECT count(*) FROM requirements WHERE case_id=c.case_id) total,(SELECT count(*) FROM requirements WHERE case_id=c.case_id AND status IN ('uploaded','approved')) received,(SELECT group_concat(name,' • ') FROM requirements WHERE case_id=c.case_id AND (status='correction' OR status='missing' AND required=1 AND unavailable_note IS NULL)) missing,(SELECT count(*) FROM requirements WHERE case_id=c.case_id AND status='missing' AND unavailable_note IS NOT NULL) unavailable,(SELECT count(*) FROM requirements r WHERE r.case_id=c.case_id AND r.status='uploaded' AND EXISTS(SELECT 1 FROM uploads u WHERE u.requirement_id=r.requirement_id AND u.state='stored') AND NOT EXISTS(SELECT 1 FROM uploads u WHERE u.requirement_id=r.requirement_id AND u.state='pending')) reviewable_count FROM cases c JOIN clients cl USING(client_id) LEFT JOIN staff st ON st.staff_id=c.owner_id${scope} ORDER BY c.last_activity DESC`,...args).then(async rows=>{const s=await settings(db),today=localDate(),reqs=await all(db,`SELECT r.case_id,r.required,r.status,r.unavailable_note FROM requirements r JOIN cases c USING(case_id)${scope}`,...args);
  return rows.map(({token_hash,link_version,...r})=>({...r,...caseMeta(r,reqs.filter(x=>x.case_id===r.case_id),s,today),whatsapp:israeliMobile(r.phone)}));});}
 if(path==='/api/cases'&&method==='POST'){const b=await body(req);
  // A manager always opens cases for themselves. An admin can hand a case to any active staff member.
  const owner=isAdmin(me)&&b.owner_id?await activeStaff(db,b.owner_id):{staff_id:me.staff_id,name:me.name};
  const x=await caseStatements(db,b,env,me,owner);await db.batch(x.statements);return {case_id:x.id,link:SITE+'client.html#'+x.token};}
 if(path==='/api/catalog'&&method==='GET')return all(db,'SELECT * FROM document_catalog ORDER BY name');
 if(path==='/api/catalog'&&method==='POST'){adminOnly(me);const b=await body(req),id=b.document_id||uid();await stmt(db,'INSERT INTO document_catalog(document_id,name,description,active) VALUES (?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET name=excluded.name,description=excluded.description,active=excluded.active',id,clean(b.name,160,true),clean(b.description||'',500),b.active===false?0:1).run();return {document_id:id};}
 if(path==='/api/templates'&&method==='GET'){const rows=await all(db,'SELECT * FROM templates ORDER BY name');for(const r of rows)r.items=await all(db,'SELECT ti.*,dc.name FROM template_items ti JOIN document_catalog dc USING(document_id) WHERE template_id=? ORDER BY position',r.template_id);return rows;}
 if(path==='/api/templates'&&method==='POST'){adminOnly(me);const b=await body(req),id=b.template_id||uid();requireThat(Array.isArray(b.items)&&b.items.length>0&&b.items.length<=40,'requirements_required');
  const statements=[stmt(db,'INSERT INTO templates VALUES (?,?) ON CONFLICT(template_id) DO UPDATE SET name=excluded.name',id,clean(b.name,120,true)),stmt(db,'DELETE FROM template_items WHERE template_id=?',id)],used=new Set();
  // A document typed by name inside a template joins the shared document library, or reuses the entry with the same name.
  const library=await all(db,'SELECT document_id,name FROM document_catalog');
  for(const [i,r]of b.items.entries()){requireThat(Number.isInteger(r.max_files)&&r.max_files>=1&&r.max_files<=20);let doc=r.document_id;
   if(doc)requireThat(library.some(x=>x.document_id===doc),'not_found',404);
   else{const name=clean(r.name,160,true),found=library.find(x=>x.name.trim().toLowerCase()===name.toLowerCase());doc=found?.document_id||uid();if(!found){library.push({document_id:doc,name});statements.push(stmt(db,'INSERT INTO document_catalog(document_id,name) VALUES (?,?)',doc,name));}}
   requireThat(!used.has(doc),'duplicate_document',409);used.add(doc);
   statements.push(stmt(db,'INSERT INTO template_items VALUES (?,?,?,?,?)',id,doc,r.required?1:0,r.max_files,i));}
  await db.batch(statements);return {template_id:id};}
 const match=path.match(/^\/api\/cases\/([\w-]+)(?:\/(link|revoke-link|review|review-all|status|reminder|opening|email|reconcile|owner|contacts))?$/);
 if(match){const id=match[1],action=match[2],c=await ownCase(db,me,id);
 // An admin may hand the case to someone else mid-request. Writes repeat the ownership check in SQL.
 const mine='EXISTS(SELECT 1 FROM cases WHERE case_id=? AND (?=1 OR owner_id=?))',mineArgs=[id,isAdmin(me)?1:0,me.staff_id];
 if(!action&&method==='GET'){await expirePending(db,id);return caseView(db,id,true);}
 if(action==='link'&&method==='GET')return {link:await portalLink(env,db,id)};
 // A leaked link is revoked by moving the case to a new link version. The old token stops matching token_hash.
 if(action==='revoke-link'&&method==='POST'){const v=c.link_version+1,t=await caseLinkToken(id,v,env.PORTAL_LINK_KEY);
  let code=shortCode();for(let i=0;i<5&&await one(db,'SELECT 1 FROM cases WHERE short_code=?',code);i++)code=shortCode();
  const done=await db.batch([stmt(db,`UPDATE cases SET link_version=?,token_hash=?,short_code=? WHERE case_id=? AND link_version=? AND ${mine}`,v,await hash(t),code,id,c.link_version,...mineArgs),stmt(db,`INSERT INTO events(event_id,case_id,action,actor_type,actor_id) SELECT ?,?,'link_revoked','staff',? WHERE EXISTS(SELECT 1 FROM cases WHERE case_id=? AND link_version=?)`,uid(),id,me.staff_id,id,v)]);
  requireThat(done[0].meta.changes===1,'conflict',409);return {link:SITE+'client.html#'+code};}
 if(action==='status'&&method==='POST'){const b=await body(req);requireThat(['closed','archived','reopen'].includes(b.status));const to=b.status==='reopen'?'reopen':'archived';const done=await db.batch([stmt(db,`INSERT INTO events(event_id,case_id,action,detail,actor_type,actor_id) SELECT ?,?,'case_status',?,'staff',? WHERE ${mine}`,uid(),id,to,me.staff_id,...mineArgs),stmt(db,`UPDATE cases SET status=?,closed_at=? WHERE case_id=? AND ${mine}`,to==='reopen'?'collecting':'archived',to==='reopen'?null:now(),id,...mineArgs),syncCase(db,id)]);requireThat(done[1].meta.changes===1,'not_found',404);return {ok:true};}
 if(action==='owner'&&method==='POST'){adminOnly(me);const b=await body(req),s=await activeStaff(db,b.staff_id);
  await db.batch([stmt(db,'UPDATE cases SET owner_id=?,owner=? WHERE case_id=?',s.staff_id,s.name,id),event(db,id,'owner_changed',s.name,actor)]);return caseView(db,id,true);}
 active(c);
 if(action==='review'&&method==='POST'){const b=await body(req);requireThat(['approved','correction'].includes(b.status));const r=await one(db,'SELECT * FROM requirements WHERE case_id=? AND requirement_id=?',id,b.requirement_id);requireThat(r,'not_found',404);requireThat(r.unavailable_note!=null&&r.status==='missing'||await one(db,"SELECT submission_id FROM uploads WHERE requirement_id=? AND state='stored'",r.requirement_id),'no_stored_upload',409);await expirePending(db,id);requireThat(!await one(db,"SELECT submission_id FROM uploads WHERE requirement_id=? AND state='pending'",r.requirement_id),'upload_pending',409);const message=b.status==='correction'?clean(b.message,1000,true):'',idle=`NOT EXISTS(SELECT 1 FROM uploads WHERE requirement_id=? AND state='pending') AND ${mine}`,rq=r.requirement_id;const done=await db.batch([stmt(db,`INSERT INTO events(event_id,case_id,action,detail,actor_type,actor_id) SELECT ?,?,?,?,'staff',? WHERE ${idle}`,uid(),id,b.status,r.name+(message?': '+message:''),me.staff_id,rq,...mineArgs),...(b.status==='correction'?[stmt(db,`UPDATE cases SET client_completed_at=NULL,completed_at=NULL WHERE case_id=? AND ${idle}`,id,rq,...mineArgs)]:[]),stmt(db,`UPDATE requirements SET status=?,correction_message=?,unavailable_note=CASE WHEN ?='correction' THEN NULL ELSE unavailable_note END WHERE requirement_id=? AND ${idle}`,b.status,message,b.status,rq,rq,...mineArgs),syncCase(db,id),stmt(db,"UPDATE cases SET completed_at=CASE WHEN status='ready_for_work' THEN coalesce(completed_at,?) ELSE NULL END WHERE case_id=?",now(),id)]);requireThat(done[b.status==='correction'?2:1].meta.changes===1,'upload_pending',409);return caseView(db,id,true);}
 // The office opened WhatsApp or email with the link, or copied it. Retries with the same send_id stay one record.
 if(action==='contacts'&&method==='POST'){const b=await body(req);requireThat(typeof b.send_id==='string'&&/^[0-9a-f-]{36}$/.test(b.send_id),'invalid_fields');requireThat(['whatsapp','email','copy'].includes(b.channel),'invalid_fields');
  const used=await one(db,'SELECT case_id FROM contacts WHERE send_id=?',b.send_id);requireThat(!used||used.case_id===id,'conflict',409);
  await db.batch([stmt(db,`INSERT OR IGNORE INTO contacts(send_id,case_id,channel,actor_id) SELECT ?,?,?,? WHERE ${mine} AND EXISTS(SELECT 1 FROM cases WHERE case_id=? AND status NOT IN ('closed','archived'))`,b.send_id,id,b.channel,me.staff_id,...mineArgs,id),
   stmt(db,"INSERT OR IGNORE INTO events(event_id,case_id,action,detail,actor_type,actor_id) SELECT 'contact-'||send_id,case_id,'contact',channel,'staff',actor_id FROM contacts WHERE send_id=? AND case_id=?",b.send_id,id)]);
  if(!await one(db,'SELECT 1 FROM contacts WHERE send_id=? AND case_id=?',b.send_id,id)){await ownCase(db,me,id);active(await one(db,'SELECT status FROM cases WHERE case_id=?',id));throw new HttpError(409,'conflict');}return {ok:true};}
 // Approves every document waiting for review in one transaction. Events, update and count share one predicate.
 if(action==='review-all'&&method==='POST'){const b=await body(req),ids=b.requirement_ids;await expirePending(db,id);
  requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=40&&ids.every(x=>typeof x==='string'&&/^[\w-]{1,64}$/.test(x)),'nothing_to_review',409);
  const seen=`r.requirement_id IN (${ids.map(()=>'?').join(',')})`;
  const n=(await one(db,`SELECT count(*) n FROM requirements r WHERE ${REVIEWABLE} AND ${seen}`,id,...ids)).n;requireThat(n>0,'nothing_to_review',409);
  const open=`${mine} AND EXISTS(SELECT 1 FROM cases WHERE case_id=? AND status NOT IN ('closed','archived'))`,openArgs=[...mineArgs,id];
  const done=await db.batch([
   stmt(db,`INSERT INTO events(event_id,case_id,action,detail,actor_type,actor_id) SELECT lower(hex(randomblob(16))),r.case_id,'approved',r.name,'staff',? FROM requirements r WHERE ${REVIEWABLE} AND ${seen} AND ${open}`,me.staff_id,id,...ids,...openArgs),
   stmt(db,`UPDATE requirements SET status='approved',correction_message='' WHERE requirement_id IN (SELECT r.requirement_id FROM requirements r WHERE ${REVIEWABLE} AND ${seen}) AND ${open}`,id,...ids,...openArgs),
   syncCase(db,id),
   stmt(db,"UPDATE cases SET completed_at=CASE WHEN status='ready_for_work' THEN coalesce(completed_at,?) ELSE NULL END WHERE case_id=?",now(),id)]);
  if(done[1].meta.changes===0){await ownCase(db,me,id);active(await one(db,'SELECT status FROM cases WHERE case_id=?',id));throw new HttpError(409,'conflict');}
  return {...await caseView(db,id,true),approved_count:done[1].meta.changes};}
 if(action==='reminder'&&method==='POST'){const view=await caseView(db,id,true),x=await settings(db),link=await portalLink(env,db,id),{missing,text}=reminderText(x,view,link);requireThat(missing.length,'nothing_missing',409);
  await event(db,id,'reminder_prepared',missing.map(r=>r.name).join(', '),actor).run();return {text,link,email:view.email,phone:view.phone,whatsapp:israeliMobile(view.phone),subject:'השלמת מסמכים — '+view.name};}
 if(action==='opening'&&method==='GET'){const view=await caseView(db,id,true),link=await portalLink(env,db,id);return {text:openingText(await settings(db),view,link),link,email:view.email,phone:view.phone,whatsapp:israeliMobile(view.phone),subject:'מסמכים לתיק '+view.name};}
 // Sends the opening message or a reminder by email through Make. "Sent" only when Make confirms this send_id.
 if(action==='email'&&method==='POST'){const b=await body(req),kind=b.kind==='opening'?'opening':'reminder',view=await caseView(db,id,true);
  requireThat(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(view.email||''),'invalid_email');
  const x=await settings(db),link=await portalLink(env,db,id),msg=kind==='opening'?{text:openingText(x,view,link),missing:[1]}:reminderText(x,view,link);
  requireThat(msg.missing.length,'nothing_missing',409);
  const send_id=typeof b.send_id==='string'&&/^[0-9a-f-]{36}$/.test(b.send_id)?b.send_id:crypto.randomUUID(),p=new FormData();
  if(await one(db,'SELECT 1 FROM contacts WHERE send_id=? AND case_id=?',send_id,id))return {sent:true,to:view.email,repeat:true};
  try{bridge(env);}catch{throw new HttpError(502,'email_failed');}
  const tried='send:'+send_id;if(env.FILES){requireThat(!await env.FILES.get(tried),'email_maybe_sent',409);await env.FILES.put(tried,'1',{expirationTtl:86400});}
  const line=v=>String(v??'').replace(/[\r\n]+/g,' ').trim();
  for(const [k,v] of Object.entries({action:'send_email',send_id,to:line(view.email),reply_to:line(x.email||''),subject:(kind==='opening'?'מסמכים לתיק ':'תזכורת: מסמכים לתיק ')+view.name+(x.office_name?' · '+x.office_name:''),html:emailHtml(msg.text,link)}))p.set(k,k==='subject'?line(v):v);
  // A clear refusal (Make answered without sending) frees the id for a retry; a lost answer keeps it blocked for a day.
  // Make answered with an error status: nothing was sent. No answer at all (timeout, network): it may have been sent.
  let r;try{r=await make(env,p);}catch(e){if(e instanceof HttpError){if(env.FILES)await env.FILES.delete(tried).catch(()=>{});throw new HttpError(502,'email_failed');}throw new HttpError(502,'email_maybe_sent');}
  if(!(r?.status==='sent'&&r.send_id===send_id)){if(env.FILES)await env.FILES.delete(tried).catch(()=>{});throw new HttpError(502,'email_failed');}
  await db.batch([stmt(db,'INSERT INTO contacts(send_id,case_id,channel,actor_id) VALUES (?,?,?,?)',send_id,id,'email',me.staff_id),
   stmt(db,"INSERT INTO events(event_id,case_id,action,detail,actor_type,actor_id) VALUES (?,?,'email_sent',?,'staff',?)",'contact-'+send_id,id,(kind==='opening'?'פתיחת תיק':'תזכורת')+' · '+view.email,me.staff_id)]);
  return {sent:true,to:view.email};}
 if(action==='reconcile'&&method==='POST'){const b=await body(req),u=await one(db,'SELECT u.* FROM uploads u JOIN requirements r USING(requirement_id) WHERE u.submission_id=? AND r.case_id=?',b.submission_id,id);requireThat(u,'not_found',404);const p=new FormData();p.set('action','lookup_submission');p.set('submission_id',u.submission_id);const receipt=await make(env,p);if(failedReceipt(receipt,u)){if(Date.parse(u.created_at)<Date.now()-LOOKUP_GRACE_MS)await markFailed(db,id,u);}else await storeReceipt(db,u,receipt);return {ok:true,state:(await one(db,'SELECT state FROM uploads WHERE submission_id=?',u.submission_id)).state};}
 }
 if(path==='/api/csv/export'&&method==='POST'){adminOnly(me);const b=await body(req);requireThat(['clients','cases'].includes(b.entity));const keys=b.entity==='clients'?['client_id','name','contact_name','reference','regular_template_id','business_number','email','phone','status','tags','notes']:['case_id','client_id','name','type','category','reporting_period','period_start','period_end','due_date','owner','status'];return {csv:toCSV(await all(db,'SELECT * FROM '+b.entity),keys)};}
 throw new HttpError(404,'not_found');
}
export default {async fetch(req,env){const path=new URL(req.url).pathname;
 if(path==='/api/intake')return legacy.fetch(req,env);
 const target=new URL(req.url),origin=req.headers.get('Origin')||'';
 const localTarget=['localhost','127.0.0.1'].includes(target.hostname);
 const localOrigin=localTarget && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
 if(origin && origin!==ORIGIN && !localOrigin)return reply({error:'origin_denied'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin===ORIGIN?ORIGIN:localOrigin?origin:ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Case-Token, X-Case-Pin','Vary':'Origin'}});
 try{const out=await handle(req,env);
  // Files and the logo are raw responses; the page reads files with fetch, so they carry the same CORS answer as JSON.
  if(out instanceof Response){if(origin){out.headers.set('Access-Control-Allow-Origin',origin);out.headers.append('Vary','Origin');}return out;}
  return reply(out,200,origin);}catch(e){return reply({error:e instanceof HttpError?e.message:'internal_error'},e instanceof HttpError?e.status:500,origin);}
}};

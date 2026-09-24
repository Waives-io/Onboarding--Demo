import legacy from './intake.mjs';
import {HttpError,requireThat,clean,hash,randomToken,caseToken,validateFile,parseCSV,toCSV} from './domain.mjs';
const ORIGIN='https://waives-io.github.io';
const SITE=ORIGIN+'/Onboarding--Demo/';
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const one=(db,sql,...args)=>stmt(db,sql,...args).first();
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results;
const event=(db,id,action,detail='')=>stmt(db,'INSERT INTO events(event_id,case_id,action,detail) VALUES (?,?,?,?)',uid(),id,action,detail);
function reply(body,status=200,origin='') { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{})}}); }
async function body(req) { requireThat(Number(req.headers.get('content-length')||0)<=1000000,'too_large',413); try{return await req.json();}catch{throw new HttpError(400,'invalid_json');} }
function active(c) {requireThat(!['closed','archived'].includes(c.status),'case_closed',409);}
function syncCase(db,id) {
 return stmt(db,`UPDATE cases SET status=CASE
 WHEN status IN ('closed','archived') THEN status
 WHEN EXISTS(SELECT 1 FROM requirements WHERE case_id=cases.case_id AND status='correction') THEN 'action_required'
 WHEN NOT EXISTS(SELECT 1 FROM requirements WHERE case_id=cases.case_id AND status!='approved' AND (required=1 OR status!='missing')) THEN 'ready_for_work'
 WHEN client_completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM requirements WHERE case_id=cases.case_id AND required=1 AND status NOT IN ('uploaded','approved')) THEN 'client_completed'
 ELSE 'collecting' END, last_activity=? WHERE case_id=?`,now(),id);
}
async function office(req,db) {
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 requireThat(token.length===64 && await one(db,'SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?',await hash(token),Date.now()),'unauthorized',401);
}
async function portal(req,db) {
 const token=req.headers.get('X-Case-Token')||'';
 requireThat(/^[a-f0-9]{64}$/.test(token),'unauthorized',401);
 const c=await one(db,'SELECT cases.*,clients.name AS client_name,clients.reference AS client_reference,clients.email AS client_email FROM cases JOIN clients USING(client_id) WHERE token_hash=?',await hash(token)); requireThat(c,'unauthorized',401); return c;
}
async function caseView(db,id,isOffice=false) {
 const c=await one(db,`SELECT cases.*,clients.name AS client_name,clients.reference,clients.email,clients.phone,clients.business_number FROM cases JOIN clients USING(client_id) WHERE case_id=?`,id);
 requireThat(c,'not_found',404); delete c.token_hash;
 const requirements=await all(db,'SELECT * FROM requirements WHERE case_id=? ORDER BY position',id);
 for(const r of requirements){r.uploads=await all(db,`SELECT submission_id,filename,mime_type,size,version,state,created_at,stored_at${isOffice?',drive_file_id,drive_folder_id':''} FROM uploads WHERE requirement_id=? ORDER BY version DESC`,r.requirement_id);if(!isOffice)delete r.drive_folder_id;}
 if(!isOffice){delete c.email;delete c.phone;delete c.business_number;delete c.drive_folder_id;delete c.client_id;delete c.reference;}
 return {...c,requirements,...(isOffice?{events:await all(db,'SELECT * FROM events WHERE case_id=? ORDER BY created_at DESC LIMIT 100',id)}:{})};
}
function clientFields(b) {
 const r={name:clean(b.name,120,true),reference:clean(b.reference,64,true),business_number:clean(b.business_number||'',40),email:clean(b.email||'',254),phone:clean(b.phone||'',40),status:clean(b.status||'active',30),tags:clean(b.tags||'',200),notes:clean(b.notes||'',2000)};
 requireThat(!r.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));return r;
}
function insertClient(db,id,b) {const r=clientFields(b);return stmt(db,'INSERT INTO clients(client_id,name,reference,business_number,email,phone,status,tags,notes) VALUES (?,?,?,?,?,?,?,?,?)',id,...Object.values(r));}
async function caseStatements(db,b,env) {
 const id=b.case_id||uid(); requireThat(/^[a-zA-Z0-9-]{1,64}$/.test(id));
 requireThat(await one(db,'SELECT client_id FROM clients WHERE client_id=?',b.client_id),'client_not_found',404);
 const name=clean(b.name,160,true),type=clean(b.type||'custom',80,true),category=clean(b.category||'',80),period=clean(b.reporting_period,80,true),owner=clean(b.owner||'',100),due=clean(b.due_date,10,true);
 requireThat(/^\d{4}-\d{2}-\d{2}$/.test(due)&&new Date(due).toISOString().slice(0,10)===due,'invalid_due_date');
 let items=b.requirements;
 if(!items && b.template_id)items=await all(db,'SELECT ti.*,dc.name FROM template_items ti JOIN document_catalog dc USING(document_id) WHERE template_id=? ORDER BY position',b.template_id);
 requireThat(Array.isArray(items)&&items.length>0&&items.length<=40,'requirements_required');
 requireThat(items.some(r=>r.required===true||r.required===1),'mandatory_requirement_required');
 const token=await caseToken(id,env.PORTAL_LINK_KEY);
 const statements=[stmt(db,'INSERT INTO cases(case_id,client_id,name,type,category,reporting_period,due_date,owner,token_hash) VALUES (?,?,?,?,?,?,?,?,?)',id,b.client_id,name,type,category,period,due,owner,await hash(token))];
 for(const [i,r] of items.entries()) {const max=Number(r.max_files||1);requireThat(Number.isInteger(max)&&max>=1&&max<=20);statements.push(stmt(db,'INSERT INTO requirements(requirement_id,case_id,document_id,name,required,max_files,position) VALUES (?,?,?,?,?,?,?)',uid(),id,r.document_id||null,clean(r.name,160,true),r.required?1:0,max,i));}
 statements.push(event(db,id,'case_created'));return {id,token,statements};
}
async function make(env,payload) {
 const url=new URL(env.LOCAL_BRIDGE_URL||env.MAKE_WEBHOOK_URL||'https://invalid.invalid');
 const localBridge=env.LOCAL_BRIDGE_URL && ['127.0.0.1','localhost'].includes(url.hostname) && url.protocol==='http:';
 requireThat((localBridge || url.protocol==='https:' && /^hook(?:\.[a-z0-9-]+)?\.make\.com$/.test(url.hostname)) && !url.search && !url.hash && !url.username,'not_configured',503);
 requireThat(env.MAKE_BRIDGE_KEY?.length>=32 && env.PORTAL_BRIDGE_ENABLED==='true','integration_not_ready',503);
 payload.set('bridge_key',env.MAKE_BRIDGE_KEY);payload.set('schema_version','2');payload.set('test_mode','true');
 const response=await fetch(url,{method:'POST',body:payload,redirect:'manual',signal:AbortSignal.timeout(25000)});
 requireThat(response.ok,'storage_unconfirmed',502);try{return await response.json();}catch{throw new HttpError(502,'storage_unconfirmed');}
}
async function storeReceipt(db,u,receipt) {
 requireThat(receipt.status==='stored' && receipt.submission_id===u.submission_id && /^[\w-]{5,200}$/.test(receipt.drive_file_id||'') && /^[\w-]{5,200}$/.test(receipt.drive_folder_id||'') && receipt.sheet_updated===true,'storage_unconfirmed',502);
 if(u.state==='stored'){requireThat(u.drive_file_id===receipt.drive_file_id,'receipt_conflict',409);return;}
 const r=await one(db,'SELECT * FROM requirements WHERE requirement_id=?',u.requirement_id);
 const completedAfterCorrection=r.status==='correction';
 await db.batch([
 stmt(db,"UPDATE uploads SET state='stored',drive_file_id=?,drive_folder_id=?,stored_at=? WHERE submission_id=? AND state='pending'",receipt.drive_file_id,receipt.drive_folder_id,now(),u.submission_id),
 stmt(db,"UPDATE requirements SET status='uploaded',correction_message='',drive_folder_id=coalesce(drive_folder_id,?) WHERE requirement_id=?",receipt.drive_folder_id,r.requirement_id),
 stmt(db,'UPDATE cases SET drive_folder_id=coalesce(drive_folder_id,?),client_completed_at=?,completed_at=NULL WHERE case_id=?',receipt.drive_folder_id,completedAfterCorrection?now():null,r.case_id),
 syncCase(db,r.case_id),event(db,r.case_id,'upload_stored',u.filename)
 ]);
}
async function handle(req,env) {
 const path=new URL(req.url).pathname,method=req.method,db=env.DB;
 requireThat(db,'not_configured',503);
 if(path==='/api/health')return {ok:true,version:2,storage_ready:env.PORTAL_BRIDGE_ENABLED==='true'};
 if(path==='/api/login'&&method==='POST') {
 const b=await body(req),ip=req.headers.get('CF-Connecting-IP')||'local',bucket=await hash(ip),time=Date.now();
 await stmt(db,'INSERT INTO login_limits(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END',bucket,time+900000,time,time).run();
 const limit=await one(db,'SELECT * FROM login_limits WHERE bucket=?',bucket);requireThat(limit.attempts<=5,'too_many_attempts',429);
 requireThat(env.OFFICE_CODE?.length>=16,'not_configured',503);
 requireThat(typeof b.code==='string' && b.code.length<=200 && await hash(b.code)===await hash(env.OFFICE_CODE),'unauthorized',401);
 const token=randomToken();await db.batch([stmt(db,'INSERT INTO sessions VALUES (?,?)',await hash(token),time+8*3600000),stmt(db,'DELETE FROM sessions WHERE expires_at<?',time)]);return {token};
 }
 if(path==='/api/storage-receipt'&&method==='POST') {
 requireThat(env.MAKE_BRIDGE_KEY?.length>=32 && await hash(req.headers.get('X-Bridge-Key')||'')===await hash(env.MAKE_BRIDGE_KEY),'unauthorized',401);
 const b=await body(req),u=await one(db,'SELECT * FROM uploads WHERE submission_id=?',b.submission_id);requireThat(u,'not_found',404);await storeReceipt(db,u,b);return {ok:true};
 }
 if(path.startsWith('/api/portal')) {
 const c=await portal(req,db);
 if(path==='/api/portal'&&method==='GET')return caseView(db,c.case_id);
 active(c);
 if(path==='/api/portal/complete'&&method==='POST') {
 const missing=await one(db,"SELECT count(*) AS n FROM requirements WHERE case_id=? AND (status='correction' OR (required=1 AND status NOT IN ('uploaded','approved')))",c.case_id);
 requireThat(missing.n===0,'missing_requirements',409);
 await db.batch([stmt(db,'UPDATE cases SET client_completed_at=? WHERE case_id=?',now(),c.case_id),syncCase(db,c.case_id),event(db,c.case_id,'client_completed')]);return caseView(db,c.case_id);
 }
 if(path==='/api/portal/uploads'&&method==='POST') {
 requireThat(env.PORTAL_BRIDGE_ENABLED==='true','integration_not_ready',503);
 requireThat(Number(req.headers.get('content-length')||0)<=4500000,'too_large',413);
 let form;try{form=await req.formData();}catch{throw new HttpError(400,'invalid_form');}
 const rid=form.get('requirement_id'),submission=form.get('submission_id');
 requireThat(typeof submission==='string'&&/^[0-9a-f-]{36}$/.test(submission),'invalid_submission_id');
 const r=await one(db,'SELECT * FROM requirements WHERE requirement_id=? AND case_id=?',rid,c.case_id);requireThat(r,'not_found',404);
 const file=form.get('file'),f=await validateFile(file);
 const prior=await one(db,'SELECT * FROM uploads WHERE submission_id=?',submission);
 if(prior){requireThat(prior.requirement_id===rid&&prior.content_hash===f.contentHash,'submission_conflict',409);return {submission_id:submission,status:prior.state, retry_safe:false};}
 requireThat(r.status!=='approved','already_approved',409);
 const count=await one(db,"SELECT count(*) n FROM uploads WHERE requirement_id=? AND state='stored'",rid);
 requireThat(r.status==='correction'||count.n<r.max_files,'max_files',409);
 const pending=await one(db,"SELECT submission_id FROM uploads WHERE requirement_id=? AND state='pending'",rid);requireThat(!pending,'upload_pending',409);
 const version=(await one(db,'SELECT coalesce(max(version),0)+1 AS n FROM uploads WHERE requirement_id=?',rid)).n;
 try{await stmt(db,'INSERT INTO uploads(submission_id,requirement_id,filename,mime_type,size,content_hash,version) VALUES (?,?,?,?,?,?,?)',submission,rid,f.filename,f.mime,f.size,f.contentHash,version).run();}catch{throw new HttpError(409,'upload_pending');}
 const u=await one(db,'SELECT * FROM uploads WHERE submission_id=?',submission);
 const payload=new FormData();for(const [k,v]of Object.entries({action:r.drive_folder_id?'upload_document_revision':'upload_document',submission_id:submission,client_id:c.client_id,client_reference:c.client_reference,full_name:c.client_name,email:c.client_email,case_id:c.case_id,requirement_id:rid,requirement_name:r.name,reporting_period:c.reporting_period,version:String(version),filename:f.filename,content_hash:f.contentHash,requirement_folder_id:r.drive_folder_id||'',note:r.drive_folder_id||''}))payload.set(k,v);
 payload.set('file_1',file,f.filename);
 try{await storeReceipt(db,u,await make(env,payload));return {submission_id:submission,status:'stored'};}catch{return {submission_id:submission,status:'pending',message:'ממתין לאישור שמירה. אין להעלות שוב.'};}
 }
 throw new HttpError(404,'not_found');
 }
 await office(req,db);
 if(path==='/api/logout'&&method==='POST'){await stmt(db,'DELETE FROM sessions WHERE token_hash=?',await hash(req.headers.get('Authorization').slice(7))).run();return {ok:true};}
 if(path==='/api/clients'&&method==='GET')return all(db,'SELECT * FROM clients ORDER BY name');
 if(path==='/api/clients'&&method==='POST'){const b=await body(req),id=uid();requireThat(!await one(db,'SELECT client_id FROM clients WHERE reference=?',b.reference),'duplicate_reference',409);await insertClient(db,id,b).run();return {client_id:id};}
 if(path==='/api/cases'&&method==='GET')return all(db,`SELECT c.*,cl.name client_name,cl.reference,cl.email,cl.phone,(SELECT count(*) FROM requirements WHERE case_id=c.case_id) total,(SELECT count(*) FROM requirements WHERE case_id=c.case_id AND status IN ('uploaded','approved')) received,(SELECT group_concat(name,' • ') FROM requirements WHERE case_id=c.case_id AND status IN ('missing','correction')) missing FROM cases c JOIN clients cl USING(client_id) ORDER BY c.last_activity DESC`).then(rows=>rows.map(({token_hash,...r})=>r));
 if(path==='/api/cases'&&method==='POST'){const x=await caseStatements(db,await body(req),env);await db.batch(x.statements);return {case_id:x.id,link:SITE+'client.html#'+x.token};}
 if(path==='/api/catalog'&&method==='GET')return all(db,'SELECT * FROM document_catalog ORDER BY name');
 if(path==='/api/catalog'&&method==='POST'){const b=await body(req),id=b.document_id||uid();await stmt(db,'INSERT INTO document_catalog(document_id,name,description,active) VALUES (?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET name=excluded.name,description=excluded.description,active=excluded.active',id,clean(b.name,160,true),clean(b.description||'',500),b.active===false?0:1).run();return {document_id:id};}
 if(path==='/api/templates'&&method==='GET'){const rows=await all(db,'SELECT * FROM templates ORDER BY name');for(const r of rows)r.items=await all(db,'SELECT ti.*,dc.name FROM template_items ti JOIN document_catalog dc USING(document_id) WHERE template_id=? ORDER BY position',r.template_id);return rows;}
 if(path==='/api/templates'&&method==='POST'){const b=await body(req),id=b.template_id||uid();requireThat(Array.isArray(b.items)&&b.items.length>0&&b.items.length<=40);const statements=[stmt(db,'INSERT INTO templates VALUES (?,?) ON CONFLICT(template_id) DO UPDATE SET name=excluded.name',id,clean(b.name,120,true)),stmt(db,'DELETE FROM template_items WHERE template_id=?',id)];for(const [i,r]of b.items.entries()){requireThat(Number.isInteger(r.max_files)&&r.max_files>=1&&r.max_files<=20);statements.push(stmt(db,'INSERT INTO template_items VALUES (?,?,?,?,?)',id,r.document_id,r.required?1:0,r.max_files,i));}await db.batch(statements);return {template_id:id};}
 const match=path.match(/^\/api\/cases\/([\w-]+)(?:\/(link|review|status|reminder|reconcile))?$/);
 if(match){const id=match[1],action=match[2],c=await one(db,'SELECT * FROM cases WHERE case_id=?',id);requireThat(c,'not_found',404);
 if(!action&&method==='GET')return caseView(db,id,true);
 if(action==='link'&&method==='GET')return {link:SITE+'client.html#'+await caseToken(id,env.PORTAL_LINK_KEY)};
 if(action==='status'&&method==='POST'){const b=await body(req);requireThat(['closed','archived','reopen'].includes(b.status));await db.batch([stmt(db,'UPDATE cases SET status=?,closed_at=? WHERE case_id=?',b.status==='reopen'?'collecting':b.status,b.status==='reopen'?null:now(),id),syncCase(db,id),event(db,id,'case_status',b.status)]);return {ok:true};}
 active(c);
 if(action==='review'&&method==='POST'){const b=await body(req);requireThat(['approved','correction'].includes(b.status));const r=await one(db,'SELECT * FROM requirements WHERE case_id=? AND requirement_id=?',id,b.requirement_id);requireThat(r,'not_found',404);requireThat(await one(db,"SELECT submission_id FROM uploads WHERE requirement_id=? AND state='stored'",r.requirement_id),'no_stored_upload',409);requireThat(!await one(db,"SELECT submission_id FROM uploads WHERE requirement_id=? AND state='pending'",r.requirement_id),'upload_pending',409);const message=b.status==='correction'?clean(b.message,1000,true):'';await db.batch([stmt(db,'UPDATE requirements SET status=?,correction_message=? WHERE requirement_id=?',b.status,message,r.requirement_id),...(b.status==='correction'?[stmt(db,'UPDATE cases SET client_completed_at=NULL,completed_at=NULL WHERE case_id=?',id)]:[]),syncCase(db,id),stmt(db,"UPDATE cases SET completed_at=CASE WHEN status='ready_for_work' THEN coalesce(completed_at,?) ELSE NULL END WHERE case_id=?",now(),id),event(db,id,b.status,r.name+(message?': '+message:''))]);return caseView(db,id,true);}
 if(action==='reminder'&&method==='POST'){const view=await caseView(db,id,true),missing=view.requirements.filter(r=>['missing','correction'].includes(r.status));requireThat(missing.length,'nothing_missing',409);const link=SITE+'client.html#'+await caseToken(id,env.PORTAL_LINK_KEY);const text=`שלום ${view.client_name},\nלהשלמת ${view.name} (${view.reporting_period}) נדרשים:\n${missing.map(r=>'• '+r.name+(r.correction_message?' — '+r.correction_message:'')).join('\n')}\nתאריך יעד: ${view.due_date}\nלהעלאת המסמכים: ${link}`;await event(db,id,'reminder_prepared',missing.map(r=>r.name).join(', ')).run();return {text,link,email:view.email,phone:view.phone,subject:'השלמת מסמכים — '+view.name};}
 if(action==='reconcile'&&method==='POST'){const b=await body(req),u=await one(db,'SELECT u.* FROM uploads u JOIN requirements r USING(requirement_id) WHERE u.submission_id=? AND r.case_id=?',b.submission_id,id);requireThat(u,'not_found',404);const p=new FormData();p.set('action','lookup_submission');p.set('submission_id',u.submission_id);const receipt=await make(env,p);await storeReceipt(db,u,receipt);return {ok:true};}
 }
 if(path==='/api/csv/export'&&method==='POST'){const b=await body(req);requireThat(['clients','cases'].includes(b.entity));const keys=b.entity==='clients'?['client_id','name','reference','business_number','email','phone','status','tags','notes']:['case_id','client_id','name','type','category','reporting_period','due_date','owner','status'];return {csv:toCSV(await all(db,'SELECT * FROM '+b.entity),keys)};}
 if(path==='/api/csv/import'&&method==='POST'){const b=await body(req);requireThat(['clients','cases'].includes(b.entity));const rows=parseCSV(b.csv),errors=[],statements=[],seen=new Set();for(const [i,r]of rows.entries()){try{if(b.entity==='clients'){clientFields(r);requireThat(!seen.has(r.reference)&&!await one(db,'SELECT client_id FROM clients WHERE reference=?',r.reference),'duplicate_reference',409);seen.add(r.reference);statements.push(insertClient(db,uid(),r));}else{requireThat(r.template_id,'template_required');requireThat(!r.case_id||!seen.has(r.case_id),'duplicate_case',409);if(r.case_id){requireThat(!await one(db,'SELECT case_id FROM cases WHERE case_id=?',r.case_id),'duplicate_case',409);seen.add(r.case_id);}const x=await caseStatements(db,r,env);statements.push(...x.statements);}}catch(e){errors.push({row:i+2,error:e.message});}}if(errors.length)return {imported:0,errors};requireThat(rows.length<=40,'import_limit_40');await db.batch(statements);return {imported:rows.length,errors:[]};}
 throw new HttpError(404,'not_found');
}
export default {async fetch(req,env){const path=new URL(req.url).pathname;
 if(path==='/api/intake')return legacy.fetch(req,env);
 const target=new URL(req.url),origin=req.headers.get('Origin')||'';
 const localTarget=['localhost','127.0.0.1'].includes(target.hostname);
 const localOrigin=localTarget && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
 if(origin && origin!==ORIGIN && !localOrigin)return reply({error:'origin_denied'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin===ORIGIN?ORIGIN:localOrigin?origin:ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Case-Token','Vary':'Origin'}});
 try{return reply(await handle(req,env),200,origin);}catch(e){return reply({error:e instanceof HttpError?e.message:'internal_error'},e instanceof HttpError?e.status:500,origin);}
}};

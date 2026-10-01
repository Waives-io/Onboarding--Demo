import {$,esc,status,badge,date,toast,api,field,dialog,bindForm,progress,deadlineLabel} from './common.mjs';
let token=sessionStorage.getItem('office_session')||'',inquiries=[],cases=[],clients=[],catalog=[],templates=[],settings={},staff=[],me={},view='cases',statusFilter='active';
const call=(path,data)=>api(path,{token,...(data!==undefined?{method:'POST',data}:{})});
const app=$('#app');
const ACTIVE=['collecting','action_required','client_completed','ready_for_work'];
const clientLabel=c=>[c.name,c.business_number||c.phone].filter(Boolean).join(' · ');
// Clicking a column header sorts by it; clicking again reverses. Empty values go last either way.
const collator=new Intl.Collator('he',{numeric:true,sensitivity:'base'});
function sortRows(rows,keys,sort){const k=keys[sort.id];if(!k)return rows;return [...rows].sort((a,b)=>{const x=k(a)??'',y=k(b)??'';return (x==='')-(y==='')||sort.dir*collator.compare(String(x),String(y));});}
const sortHead=(label,id,sort)=>`<th aria-sort="${sort.id===id?(sort.dir>0?'ascending':'descending'):'none'}"><button type="button" class="sort" data-sort="${id}">${label}<span aria-hidden="true">${sort.id===id?(sort.dir>0?' ▲':' ▼'):''}</span></button></th>`;
function bindSort(sort,redraw){document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const id=b.dataset.sort;sort.dir=sort.id===id?-sort.dir:1;sort.id=id;redraw();});}
let clientSort={id:'new',dir:-1},caseSort={id:'activity',dir:-1},freshClient='';
const CLIENT_KEYS={new:c=>c.created_at,name:c=>c.name,business:c=>c.business_number,email:c=>c.email,phone:c=>c.phone};
const CASE_KEYS={client:c=>c.client_name+' '+c.name,period:c=>c.period_start||c.reporting_period,due:c=>c.due_date,status:c=>['action_required','client_completed','collecting','ready_for_work','closed','archived'].indexOf(c.status),owner:c=>ownerName(c),activity:c=>c.last_activity};
const caseCount=id=>cases.filter(x=>x.client_id===id).length;
const isAdmin=()=>me.role==='admin';
const ownerName=c=>c.owner_name||c.owner||'';
const roles={admin:'מנהל/ת משרד',manager:'מנהל/ת תיקים'};
const ADMIN_VIEWS=['templates','documents','settings','staff'];

// While no admin exists, the office code opens a one-time form that creates the first admin. After that everyone signs in with their own email.
async function login(){let setup=false;try{setup=(await api('/api/auth-state')).setup_required;}catch{}
 app.innerHTML=setup?`<section class="panel login"><span class="eyebrow">הגדרה ראשונה</span><h1>יוצרים את חשבון מנהל המשרד</h1><p class="muted">פעם אחת בלבד. קוד המשרד מאשר שזה אתם. אחר כך כל אחד בצוות נכנס עם הדוא״ל והסיסמה שלו.</p><form id="login">${field('code','קוד המשרד','password','',true)}${field('name','השם שלך','text','',true)}${field('email','דוא״ל','email','',true)}<label>סיסמה<input name="password" type="password" minlength="8" autocomplete="new-password" required><small class="muted">8 תווים לפחות.</small></label><button class="primary">יצירת החשבון וכניסה</button><p id="login-error" class="error" role="alert"></p></form></section>`
 :`<section class="panel login"><span class="eyebrow">סביבת המשרד</span><h1>נכנסים לתיק מוכן</h1><p class="muted">כל אחד בצוות נכנס עם הדוא״ל והסיסמה שלו.</p><form id="login"><label>דוא״ל<input name="email" type="email" autocomplete="username" required></label><label>סיסמה<input name="password" type="password" autocomplete="current-password" required></label><button class="primary">כניסה</button><p class="muted">שכחת סיסמה? מנהל המשרד יכול לקבוע לך סיסמה חדשה.</p><p id="login-error" class="error" role="alert"></p></form></section>`;
 bindForm('#login',async b=>{const r=await api(setup?'/api/setup':'/api/login',{method:'POST',data:b});token=r.token;sessionStorage.setItem('office_session',token);await load();});}

function applyBranding(b){if(b.office_name)$('#office-name').textContent=b.office_name;const mark=$('.brand-mark');mark.innerHTML=b.logo_version?`<img src="${esc(window.PORTAL_CONFIG.api)}/api/logo?v=${Number(b.logo_version)}" alt="">`:'✓';}
async function load(){[me,cases,clients,catalog,templates,settings,staff,inquiries]=await Promise.all(['/api/me','/api/cases','/api/clients','/api/catalog','/api/templates','/api/settings','/api/staff','/api/inquiries'].map(p=>call(p)));applyBranding(settings);
 // A manager's menu has no office-wide pages. The server refuses them anyway.
 document.querySelectorAll('[data-view]').forEach(b=>b.hidden=ADMIN_VIEWS.includes(b.dataset.view)&&!isAdmin());if(ADMIN_VIEWS.includes(view)&&!isAdmin())view='cases';
 $('#me').hidden=false;$('#me').textContent='החשבון שלי';$('#me').title=roles[me.role];$('#logout').hidden=false;$('#user-name').textContent=me.name;$('#user-role').textContent=roles[me.role];$('.user-avatar').textContent=(me.name||'א').split(/\s+/).map(x=>x[0]).join('').slice(0,2);render();}
const SETTINGS_TABS=[['settings','פרטי המשרד'],['templates','רשימות מסמכים'],['staff','צוות']];
function render(){const nav=ADMIN_VIEWS.includes(view)?'settings':view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===nav));
 return Promise.resolve(({cases:renderCases,clients:renderClients,documents:renderDocuments,templates:renderTemplates,settings:renderSettings,staff:renderStaff}[view]||renderCases)()).then(()=>{if(!ADMIN_VIEWS.includes(view))return;
  app.insertAdjacentHTML('afterbegin',`<nav class="subtabs" aria-label="הגדרות">${SETTINGS_TABS.map(([k,l])=>`<button type="button" data-sub="${k}" class="${k===view||(k==='templates'&&view==='documents')?'active':''}">${l}</button>`).join('')}</nav>`);
  document.querySelectorAll('[data-sub]').forEach(b=>b.onclick=()=>{view=b.dataset.sub;render().catch(e=>toast(e.message));});});}
// Filter chips hide their label, so every option says which filter it is: "קטגוריה: הכול", "אחראי: גלי".
// The first option names the filter ("כל האחראים"); the values themselves are plain.
const options=(values,all)=>`<option value="">${esc(all)}</option>`+[...new Set(values)].filter(Boolean).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
// One period appears once, newest first. Old free-text periods like "2026-09" read as "09/2026".
const periodKey=c=>periodLabel(c.period_start,c.period_end)||String(c.reporting_period||'').replace(/^(\d{4})-(\d{2})$/,'$2/$1');
const periodOrder=k=>{let m=k.match(/^(\d{2})\/(\d{4})$/);if(m)return m[2]+'-'+m[1];m=k.match(/^(\d{4})$/);if(m)return m[1]+'-13';m=k.match(/(\d{2})\/(\d{2})\/(\d{4})$/);return m?m[3]+'-'+m[2]:k;};
const periodOptions=()=>`<option value="">כל התקופות</option>`+[...new Set(cases.map(periodKey).filter(Boolean))].sort((a,b)=>periodOrder(b).localeCompare(periodOrder(a))).map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('');
let showClosed=false;

// Dashboard tiles are the status filter. Their labels are the same words as the status badges.
const tiles=[{key:'active',label:'כל הפעילים',match:c=>ACTIVE.includes(c.status)},{key:'client_completed',label:'מוכן לבדיקה',match:c=>c.status==='client_completed'},{key:'action_required',label:'נדרש תיקון',match:c=>c.status==='action_required'},{key:'collecting',label:'ממתין ללקוח',match:c=>c.status==='collecting'},{key:'due',label:'יעד קרוב או באיחור',match:c=>ACTIVE.includes(c.status)&&['warning','urgent','overdue'].includes(c.deadline)}];
const statusMatch=c=>statusFilter==='all'||(tiles.find(t=>t.key===statusFilter)?.match||(x=>x.status===statusFilter))(c);

// We only open WhatsApp or email with the message ready, so the record says "contact", never "sent".
const CHANNEL={whatsapp:'WhatsApp',email:'דוא״ל',copy:'העתקת הקישור'};
const recordContact=(id,channel)=>call('/api/cases/'+id+'/contacts',{send_id:crypto.randomUUID(),channel}).catch(()=>{});
const contactLine=c=>['closed','archived','ready_for_work'].includes(c.status)?'':`<small class="contact" data-contacted="${c.contact_count?'yes':'no'}">${c.contact_count?`פנייה אחרונה ${date(c.last_contact_at)} · ${CHANNEL[c.last_channel]||''}${c.contact_count>1?` · ${c.contact_count} פניות`:''}`:'טרם פנו ללקוח'}</small>`;
function sendWhatsapp(id){return sendDialog(id,false,'whatsapp').catch(e=>toast(e.message));}
const whatsappButton=c=>['urgent','overdue'].includes(c.deadline)?`<button type="button" data-whatsapp="${esc(c.case_id)}">שליחת תזכורת</button>`:'';

// The landing page's new inquiries sit on top of the dashboard until someone opens a case from them or sets them aside.
const digits=v=>String(v||'').replace(/\D/g,'').replace(/^972/,'0');
const matchClient=q=>clients.find(c=>(digits(c.phone)&&digits(c.phone)===digits(q.phone))||(q.business_number&&c.business_number===q.business_number));
function inquiriesHtml(){if(!inquiries.length)return '';
 return `<section class="panel card inquiries"><div class="card-head"><h2>פניות חדשות מדף הנחיתה</h2><span class="badge blue">${inquiries.length}</span></div><ul class="file-list">${inquiries.map(q=>{const known=matchClient(q);return `<li><div><strong>${esc(q.name)}</strong><small>${esc([q.contact_name,q.need].filter(Boolean).join(' · '))} · <bdi dir="ltr">${esc(q.phone)}</bdi> · ${date(q.created_at)}${known?' · תיק קיים':''}</small>${q.note?`<p class="inquiry-note">${esc(q.note)}</p>`:''}</div><div class="actions"><button class="primary" data-inquiry-open="${esc(q.inquiry_id)}">בקשת מסמכים</button><button data-inquiry-dismiss="${esc(q.inquiry_id)}">לא רלוונטי</button></div></li>`;}).join('')}</ul></section>`;}
function bindInquiries(){
 document.querySelectorAll('[data-inquiry-open]').forEach(b=>b.onclick=()=>{const q=inquiries.find(x=>x.inquiry_id===b.dataset.inquiryOpen),known=matchClient(q),opts={template:q.template_id,inquiry:q.inquiry_id};
  if(known)return newCase(known.client_id,null,opts);
  // A new client: the form opens with what the visitor typed, and saving it goes straight to the new case.
  clientForm({name:q.name,contact_name:q.contact_name,business_number:q.business_number,phone:q.phone,email:q.email,notes:q.note},id=>newCase(id,null,opts));});
 document.querySelectorAll('[data-inquiry-dismiss]').forEach(b=>b.onclick=async()=>{const q=inquiries.find(x=>x.inquiry_id===b.dataset.inquiryDismiss);if(!confirm(`להוריד את הפנייה של ${q.name} מהרשימה?`))return;try{await call('/api/inquiries/'+q.inquiry_id,{status:'dismissed'});toast('הפנייה הוסרה מהרשימה');await load();}catch(e){toast(e.message);}});}
const unavailableLine=c=>c.unavailable?`<small class="unavailable-line">${c.unavailable===1?'מסמך אחד':c.unavailable+' מסמכים'} שאין ללקוח</small>`:'';

function renderCases(){const today=new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'numeric',year:'numeric'}).format(new Date());app.innerHTML=`<div class="page-topline"><small>${esc(today)}</small><span class="badge green">המערכת מעודכנת</span></div><div class="page-heading"><div><span class="eyebrow">לוח עבודה</span><h1>כל בקשה. כל המסמכים.</h1><p>מה הגיע, מה חסר ומה מחכה לבדיקה שלך.</p></div><div class="actions"><button class="primary" id="new-case">＋ בקשת מסמכים</button></div></div>
${inquiriesHtml()}
<div class="stats">${tiles.map(t=>`<button type="button" class="stat" data-tile="${t.key}" aria-pressed="${statusFilter===t.key}"><span>${esc(t.label)}</span><strong>${cases.filter(t.match).length}</strong></button>`).join('')}</div>
<div class="filters"><label>חיפוש<input id="search" placeholder="שם תיק, ח״פ או שם בקשה"></label><label>תקופת דיווח<select id="period">${periodOptions()}</select></label><label class="due-filter"><span>יעד עד</span><input type="date" id="due"></label><label>אחראי<select id="owner">${options(cases.map(ownerName),'כל האחראים')}</select></label><button type="button" class="sort" id="closed-toggle" aria-pressed="${showClosed}">בקשות סגורות (${cases.filter(c=>['closed','archived'].includes(c.status)).length})</button></div>
<section class="panel table-wrap"><table><thead id="case-head"></thead><tbody id="rows"></tbody></table><div id="empty" class="empty" hidden>אין בקשות להצגה. אפשר לפתוח בקשת מסמכים או לשנות את הסינון.</div><div id="client-hits"></div></section>`;
 const filter=()=>{const q=$('#search').value.trim().toLowerCase();
  const rows=cases.filter(c=>[c.client_name,c.business_number,c.name].join(' ').toLowerCase().includes(q)&&(showClosed?['closed','archived'].includes(c.status):statusMatch(c))&&(!$('#period').value||periodKey(c)===$('#period').value)&&(!$('#due').value||c.due_date<=$('#due').value)&&(!$('#owner').value||ownerName(c)===$('#owner').value));
  $('#case-head').innerHTML=`<tr>${sortHead('תיק / בקשה','client',caseSort)}${sortHead('תקופת דיווח','period',caseSort)}${sortHead('תאריך יעד','due',caseSort)}<th>מסמכים</th>${sortHead('סטטוס','status',caseSort)}<th>פנייה ללקוח</th>${sortHead('אחראי','owner',caseSort)}${sortHead('פעילות אחרונה','activity',caseSort)}</tr>`;bindSort(caseSort,filter);
  $('#rows').innerHTML=sortRows(rows,CASE_KEYS,caseSort).map(c=>`<tr data-deadline="${esc(c.deadline)}"><td><button class="case-name" data-case="${esc(c.case_id)}"><strong>${esc(c.client_name)}</strong><small>${esc(c.name)}</small></button></td><td><bdi dir="ltr">${esc(periodKey(c))}</bdi></td><td><strong class="due" data-deadline="${esc(c.deadline)}">${date(c.due_date)}</strong>${whatsappButton(c)}</td><td class="compact-progress">${progress(c)}<small>${c.missing?'חסר: '+esc(c.missing):'כל מסמכי החובה התקבלו'}</small>${unavailableLine(c)}</td><td>${badge(c.status)}</td><td>${contactLine(c)||'—'}</td><td>${esc(ownerName(c)||'—')}</td><td>${date(c.last_activity)}</td></tr>`).join('');
  $('#empty').hidden=rows.length>0;
  // A search for a client who has no matching case should still lead somewhere: offer to open a case for them.
  const shown=new Set(rows.map(c=>c.client_id)),hits=q?clients.filter(c=>!shown.has(c.client_id)&&[c.name,c.business_number].join(' ').toLowerCase().includes(q)).slice(0,5):[];
  $('#client-hits').innerHTML=hits.length?`<p class="muted">תיקים שנמצאו בחיפוש בלי בקשה מתאימה:</p><ul class="file-list">${hits.map(c=>`<li><div><strong>${esc(c.name)}</strong><small>${esc(c.business_number||c.phone)} · ${caseCount(c.client_id)} בקשות</small></div><button type="button" data-new-for="${esc(c.client_id)}">＋ בקשת מסמכים</button></li>`).join('')}</ul>`:'';
  document.querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>showCase(b.dataset.case).catch(e=>toast(e.message)));
  document.querySelectorAll('[data-whatsapp]').forEach(b=>b.onclick=()=>sendWhatsapp(b.dataset.whatsapp));
  document.querySelectorAll('[data-new-for]').forEach(b=>b.onclick=()=>newCase(b.dataset.newFor));
  document.querySelectorAll('[data-tile]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tile===statusFilter)));};
 document.querySelectorAll('[data-tile]').forEach(b=>b.onclick=()=>{showClosed=false;$('#closed-toggle').setAttribute('aria-pressed','false');statusFilter=statusFilter===b.dataset.tile?'active':b.dataset.tile;filter();});
 $('#closed-toggle').onclick=e=>{showClosed=!showClosed;e.currentTarget.setAttribute('aria-pressed',String(showClosed));if(showClosed)statusFilter='';else statusFilter='active';filter();};
 document.querySelectorAll('.filters input,.filters select').forEach(i=>i.oninput=filter);filter();
 $('#new-case').onclick=()=>newCase();bindInquiries();}

// A "תיק" is the client's file: who they are, who to talk to, and the documents they usually send.
// Each document request (בקשת מסמכים, a "case" in the code) collects one period's documents inside it.
const openRequests=id=>cases.filter(x=>x.client_id===id&&!['closed','archived'].includes(x.status));
const regularName=c=>templates.find(t=>t.template_id===c.regular_template_id)?.name||'';
const nextDue=id=>openRequests(id).map(x=>x.due_date).filter(Boolean).sort()[0]||'';
function clientForm(selected,after){const c=selected||{};$('#modal').oncancel=null;
 dialog(c.client_id?'עריכת תיק':'תיק חדש',`<form id="client-form"><div class="form-grid">${field('name','שם הלקוח או העסק','text',c.name||'',true)}${field('business_number','ח״פ / ע״מ / ת״ז','text',c.business_number||'')}
<label>איש קשר<input name="contact_name" value="${esc(c.contact_name||'')}" placeholder="לדוגמה: דנה כהן"><small class="muted">ההודעות ללקוח יפנו אליו בשם. ריק = שם התיק.</small></label>
<label>דוא״ל *<input name="email" type="email" inputmode="email" autocomplete="email" dir="ltr" required value="${esc(c.email||'')}" placeholder="name@example.co.il"></label><label>טלפון נייד *<input name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" required value="${esc(c.phone||'')}" placeholder="050-0000000" pattern="[+]?[0-9 \\(\\)\\-]{9,20}" title="נייד ישראלי (05X) או מספר בינלאומי שמתחיל ב־+"><small class="muted">לשליחת הקישור. 4 הספרות האחרונות הן קוד הכניסה של הלקוח.</small></label>
<label class="wide">רשימת המסמכים הקבועה<select name="regular_template_id" id="regular-list"><option value="">ללא רשימה קבועה</option>${templates.map(t=>`<option value="${esc(t.template_id)}" ${t.template_id===c.regular_template_id?'selected':''}>${esc(t.name)}</option>`).join('')}${isAdmin()?addOption('רשימת מסמכים חדשה'):''}</select><small class="muted">נבחרת אוטומטית בכל בקשת מסמכים חדשה לתיק הזה. אפשר לשנות בכל בקשה.</small></label>
<label class="wide">הערות<textarea name="notes">${esc(c.notes||'')}</textarea></label></div><button class="primary">שמירת התיק</button></form>`);
 // Adding a list from here comes back to this form with what was typed, also when the new list is cancelled.
 onAdd($('#regular-list'),()=>{const typed={...c,...Object.fromEntries(new FormData($('#client-form')))},m=$('#modal'),back=()=>{m.oncancel=null;clientForm(typed,after);};
  templateForm({},id=>{m.oncancel=null;clientForm({...typed,regular_template_id:id},after);});$('#close-modal').onclick=back;m.oncancel=e=>{e.preventDefault();back();};});
 bindForm('#client-form',async b=>{const r=await call(c.client_id?'/api/clients/'+c.client_id:'/api/clients',b);if(!c.client_id)freshClient=r.client_id;$('#modal').close();await load();toast('התיק נשמר');if(after)after(r.client_id);});}

function renderClients(){app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">התיקים של המשרד</span><h1>תיקים</h1><p>תיק אחד לכל לקוח. בתוכו פרטי הקשר, רשימת המסמכים הקבועה וכל בקשות המסמכים לפי תקופה.</p></div><button class="primary" id="new-client">＋ תיק חדש</button></div><div class="filters"><label>חיפוש<input id="client-search" placeholder="שם, ח״פ, איש קשר, טלפון או דוא״ל"></label><button type="button" class="sort" id="newest" data-sort="new"></button></div><section class="panel table-wrap"><table><thead id="client-head"></thead><tbody id="client-rows"></tbody></table>${clients.length?'':'<div class="empty">עדיין אין תיקים. מתחילים ב־"＋ תיק חדש".</div>'}</section>`;
 const draw=()=>{const q=$('#client-search').value.trim().toLowerCase();
  $('#client-head').innerHTML=`<tr>${sortHead('תיק','name',clientSort)}${sortHead('ח״פ / ע״מ','business',clientSort)}<th>איש קשר</th>${sortHead('טלפון','phone',clientSort)}<th>רשימה קבועה</th><th>בקשות פתוחות</th><th></th></tr>`;$('#newest').textContent=clientSort.id==='new'?'חדשים קודם ✓':'חדשים קודם';bindSort(clientSort,draw);
  // Newest first is a fixed order, not a toggle.
  if(clientSort.id==='new')clientSort.dir=-1;
  $('#client-rows').innerHTML=sortRows(clients.filter(c=>[c.name,c.business_number,c.contact_name,c.phone,c.email].join(' ').toLowerCase().includes(q)),CLIENT_KEYS,clientSort).map(c=>{const open=openRequests(c.client_id),due=nextDue(c.client_id);
   return `<tr ${c.client_id===freshClient?'class="fresh"':''}><td><button class="case-name" data-client="${esc(c.client_id)}"><strong>${esc(c.name)}</strong></button>${c.client_id===freshClient?'<small>נוסף עכשיו</small>':''}</td><td>${esc(c.business_number||'—')}</td><td>${esc(c.contact_name||'—')}</td><td><bdi dir="ltr">${esc(c.phone)}</bdi></td><td>${esc(regularName(c)||'—')}</td><td>${open.length?`<strong>${open.length}</strong>${due?`<small>יעד קרוב ${date(due)}</small>`:''}`:'<span class="muted">אין</span>'}</td><td><button data-client="${esc(c.client_id)}">פתיחת התיק</button></td></tr>`;}).join('');
  document.querySelectorAll('[data-client]').forEach(b=>b.onclick=()=>showClient(b.dataset.client));};
 $('#client-search').oninput=draw;draw();$('#new-client').onclick=()=>clientForm(null,id=>showClient(id));}

// The client page: contact card on the side, the client's cases in the middle.
function showClient(id){const c=clients.find(x=>x.client_id===id),own=cases.filter(x=>x.client_id===id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 app.innerHTML=`<button class="back-button" id="back">→ חזרה לכל התיקים</button><div class="page-heading"><div><span class="eyebrow">${esc(c.business_number||'תיק')}</span><h1>${esc(c.name)}</h1>${c.contact_name?`<p>איש קשר: ${esc(c.contact_name)}</p>`:''}</div><div class="actions"><button id="edit-client">עריכת התיק</button><button class="primary" id="client-new-case">＋ בקשת מסמכים</button></div></div>
<div class="detail-grid"><div><section class="panel card"><h2>בקשות המסמכים</h2>${own.length?`<ul class="file-list">${own.map(x=>`<li><div><button class="case-name" data-case="${esc(x.case_id)}"><strong>${esc(x.name)}</strong></button><small>יעד ${date(x.due_date)} · ${esc(status[x.status])} · ${Number(x.progress_done)||0} מתוך ${Number(x.progress_total)||0}</small></div>${['closed','archived'].includes(x.status)?'':`<button data-link="${esc(x.case_id)}">שליחה ללקוח</button>`}</li>`).join('')}</ul>`:`<div class="empty"><p>עדיין אין בקשות מסמכים בתיק הזה.</p><button class="primary" id="first-request">＋ בקשת מסמכים ראשונה</button></div>`}</section></div>
<aside><section class="panel card"><h3>פרטי הקשר</h3><dl class="meta-grid"><div><dt>איש קשר</dt><dd>${esc(c.contact_name||'—')}</dd></div><div><dt>טלפון</dt><dd><bdi dir="ltr">${esc(c.phone||'—')}</bdi></dd></div><div><dt>דוא״ל</dt><dd><bdi dir="ltr">${esc(c.email||'—')}</bdi></dd></div><div><dt>ח״פ / ע״מ</dt><dd>${esc(c.business_number||'—')}</dd></div></dl>${c.notes?`<p>${esc(c.notes)}</p>`:''}</section>
<section class="panel card"><h3>רשימת המסמכים הקבועה</h3>${regularName(c)?`<p><strong>${esc(regularName(c))}</strong></p><p class="muted">${(templates.find(t=>t.template_id===c.regular_template_id)?.items||[]).map(i=>esc(i.name)).join(' · ')}</p>`:'<p class="muted">לא נבחרה רשימה קבועה. אפשר לבחור אותה בעריכת התיק.</p>'}</section></aside></div>`;
 $('#back').onclick=()=>{view='clients';render();};$('#edit-client').onclick=()=>clientForm(c,()=>showClient(id));$('#client-new-case').onclick=()=>newCase(id);
 if($('#first-request'))$('#first-request').onclick=()=>newCase(id);
 document.querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>showCase(b.dataset.case).catch(e=>toast(e.message)));
 document.querySelectorAll('[data-link]').forEach(b=>b.onclick=()=>openLink(b.dataset.link));}

// One editor for the documents of a case type and of a case. Each row says one thing: required or "as needed", and how many files.
// In a new case every row also has a checkbox: required documents start checked, "as needed" ones start unchecked.
// A name that is not in the library is still allowed; saving a case type adds it to the library.
function rowHtml(i,pick=false){return `<div class="check-row${pick?' pickable':''}" data-document="${esc(i.document_id||'')}" data-name="${esc(i.name)}"${i.added?' data-added="1"':''}>${pick?`<label class="include"><input type="checkbox" class="include-box" ${i.included!==false?'checked':''} aria-label="לבקש: ${esc(i.name)}"></label>`:''}<span>${esc(i.name)}</span><label>סוג<select class="required"><option value="1" ${i.required?'selected':''}>חובה</option><option value="0" ${i.required?'':'selected'}>לפי הצורך</option></select></label><label>מספר קבצים<input type="number" class="max" min="1" max="20" value="${Number(i.max_files)||1}"></label><button type="button" class="remove" aria-label="הסרת ${esc(i.name)}">×</button></div>`;}
function rowsEditor(items,pick=false){return `<div class="requirement-editor" id="req-rows" data-pick="${pick?1:0}">${items.map(i=>rowHtml(i,pick)).join('')}</div><p class="muted" id="no-rows" ${items.length?'hidden':''}>עדיין לא נבחרו מסמכים.</p><div class="add-document"><input id="doc-search" list="doc-options" placeholder="＋ הוספת מסמך: בוחרים מהרשימה או מקלידים שם" aria-label="הוספת מסמך" autocomplete="off"><datalist id="doc-options"></datalist><button type="button" id="add-doc" class="text-button" hidden></button></div>`;}
function bindRows(onChange=()=>{}){const box=$('#req-rows'),input=$('#doc-search'),btn=$('#add-doc'),pick=box.dataset.pick==='1',names=()=>new Set([...box.querySelectorAll('[data-name]')].map(r=>r.dataset.name.trim().toLowerCase()));
 const known=name=>catalog.find(c=>c.active&&c.name.trim().toLowerCase()===name.toLowerCase());
 const refresh=()=>{const used=names();$('#doc-options').innerHTML=catalog.filter(c=>c.active&&!used.has(c.name.trim().toLowerCase())).map(c=>`<option value="${esc(c.name)}">`).join('');$('#no-rows').hidden=used.size>0;onChange();};
 const add=()=>{const name=input.value.trim();if(!name)return;if(names().has(name.toLowerCase())){toast('המסמך כבר ברשימה.');return;}const doc=known(name);box.insertAdjacentHTML('beforeend',rowHtml({document_id:doc?.document_id,name:doc?.name||name,required:true,max_files:1,included:true,added:true},pick));input.value='';btn.hidden=true;refresh();input.focus();};
 // The add button only appears while something is typed, and says exactly what it will add.
 input.oninput=e=>{const name=input.value.trim(),picked=!e.inputType||e.inputType==='insertReplacementText';if(picked&&name&&known(name)&&!names().has(name.toLowerCase())){add();return;}btn.hidden=!name;btn.textContent=name?`＋ הוספת "${name}" כמסמך חדש`:'';};
 box.onclick=e=>{if(e.target.classList.contains('remove')){e.target.closest('.check-row').remove();refresh();}};
 // Making a document required also asks for it.
 box.onchange=e=>{if(e.target.classList.contains('required')&&e.target.value==='1'){const c=e.target.closest('.check-row').querySelector('.include-box');if(c)c.checked=true;}};
 btn.onclick=add;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add();}};refresh();}
const rowData=r=>({...(r.dataset.document?{document_id:r.dataset.document}:{}),name:r.dataset.name,required:r.querySelector('.required').value==='1',max_files:Math.min(20,Math.max(1,Number(r.querySelector('.max').value)||1))});
// Every row as it stands, ticked or not, so a detour to add a client can bring the form back exactly.
function rowsState(){return [...document.querySelectorAll('#req-rows [data-name]')].map(r=>({...rowData(r),included:r.querySelector('.include-box')?.checked!==false,added:r.dataset.added==='1'}));}
function selectedItems(){return rowsState().filter(r=>r.included).map(({included,added,...r})=>r);}

// A case name the office would write by hand: the work type and the period.
function periodLabel(a,b){if(!a||!b)return '';const [y1,m1,d1]=a.split('-'),[y2,m2,d2]=b.split('-'),last=new Date(Date.UTC(+y2,+m2,0)).getUTCDate();
 if(d1==='01'&&+d2===last){if(y1===y2&&m1===m2)return `${m1}/${y1}`;if(y1===y2&&m1==='01'&&m2==='12')return y1;return `${m1}/${y1}–${m2}/${y2}`;}
 return `${d1}/${m1}/${y1}–${d2}/${m2}/${y2}`;}
const iso=d=>d.toISOString().slice(0,10);
// A new case: the client, the case type with its documents, the period and the due date. Name and category have defaults.
// opts.template preselects a case type (from a landing page inquiry); opts.inquiry is marked handled once the case is open.
function newCase(clientId='',keep=null,opts={}){$('#modal').oncancel=null;const pre=clients.find(c=>c.client_id===clientId),categories=[...new Set(['עצמאי','חברה בע״מ','שכיר','עמותה',...cases.map(c=>c.category)])].filter(Boolean);
 const now=new Date(),start=new Date(Date.UTC(now.getFullYear(),now.getMonth()-1,1)),end=new Date(Date.UTC(now.getFullYear(),now.getMonth(),0));
 dialog('בקשת מסמכים חדשה',`<form id="case-form"><div class="form-grid"><label class="wide">תיק *<input id="client-pick" list="client-options" placeholder="הקלדת שם הלקוח או ח״פ" autocomplete="off" required value="${esc(pre?clientLabel(pre):'')}"><button type="button" class="text-button" id="inline-client">＋ תיק חדש</button></label><datalist id="client-options">${clients.map(c=>`<option value="${esc(clientLabel(c))}">`).join('')}</datalist>
<label class="wide">רשימת מסמכים *<select id="template">${templates.map(t=>`<option value="${esc(t.template_id)}">${esc(t.name)}</option>`).join('')}<option value="">אחר: בחירת מסמכים ידנית</option>${isAdmin()?addOption('רשימת מסמכים חדשה'):''}</select></label>
<label>תקופה מתאריך *<input type="date" name="period_start" required value="${iso(start)}"></label><label>עד תאריך *<input type="date" name="period_end" required value="${iso(end)}"></label>
<label>תאריך יעד להעברת החומרים *<input type="date" name="due_date" required></label>
${isAdmin()?`<label>אחראי על הבקשה<select name="owner_id">${staff.filter(p=>p.active!==0).map(p=>`<option value="${esc(p.staff_id)}" ${p.staff_id===me.staff_id?'selected':''}>${esc(p.name)}</option>`).join('')}${addOption('איש צוות חדש')}</select></label>`:`<label>אחראי על הבקשה<input value="${esc(me.name)}" disabled></label>`}</div>
<h3>המסמכים שיבקשו מהלקוח</h3><p class="muted">מסמכי החובה מסומנים. מסמכים "לפי הצורך" מסמנים רק כשהם רלוונטיים ללקוח הזה.</p><div id="items"></div>
${isAdmin()?'<label class="save-type" id="save-type-row" hidden><input type="checkbox" id="save-type" checked> לשמור את המסמכים שהוספתי גם ברשימת המסמכים, לבקשות הבאות</label>':''}
<details id="more"><summary>אפשרויות נוספות: שם הבקשה וקטגוריה</summary><div class="form-grid"><label class="wide">שם הבקשה<input name="name" id="case-name" placeholder=""><small class="muted">ריק = שם אוטומטי לפי רשימת המסמכים והתקופה.</small></label><label>קטגוריה<input name="category" list="category-options" placeholder="לדוגמה: עצמאי, חברה בע״מ"></label><datalist id="category-options">${categories.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div></details>
<p id="form-error" class="error" role="alert"></p><button class="primary">יצירת הבקשה ושליחה ללקוח</button></form>`);
 const form=$('#case-form');
 // What was typed survives a detour to add a client, a case type or a staff member.
 const snapshot=()=>({fields:Object.fromEntries(new FormData(form)),client:$('#client-pick').value,template:$('#template').value,items:rowsState(),more:$('#more').open});
 // Cancelling the add form brings the case form back as it was. Saving brings it back with the new entry chosen.
 const detour=(open,patch)=>{const k=snapshot(),m=$('#modal'),cancel=()=>{m.oncancel=null;newCase('',k,opts);};open(id=>newCase('',{...k,...patch(id)},opts));
  $('#close-modal').onclick=cancel;m.oncancel=e=>{e.preventDefault();cancel();};};
 if(keep){for(const [n,v] of Object.entries(keep.fields||{}))if(form.elements[n]&&n!=='owner_id')form.elements[n].value=v;$('#client-pick').value=keep.client||'';if([...$('#template').options].some(o=>o.value===keep.template))$('#template').value=keep.template;}
 else if(opts.template&&templates.some(t=>t.template_id===opts.template))$('#template').value=opts.template;
 const regular=x=>x?.regular_template_id&&templates.some(t=>t.template_id===x.regular_template_id)?x.regular_template_id:null;
 if(!keep&&!opts.template&&regular(pre))$('#template').value=regular(pre);
 const chosen=()=>templates.find(t=>t.template_id===$('#template').value);
 const autoName=()=>{const t=chosen(),p=periodLabel($('[name=period_start]').value,$('[name=period_end]').value);return [t?.name||'איסוף מסמכים',p].filter(Boolean).join(' · ');};
 const refreshName=()=>{$('#case-name').placeholder=autoName();};
 let datesTouched=!!keep;
 const yearly=t=>/שנתי|החזר מס|הצהרת הון/.test(t?.name||'');
 const setPeriod=()=>{if(datesTouched)return;const y=now.getFullYear()-1,t=chosen();form.elements.period_start.value=yearly(t)?`${y}-01-01`:iso(start);form.elements.period_end.value=yearly(t)?`${y}-12-31`:iso(end);};
 const syncSave=()=>{const row=$('#save-type-row');if(row)row.hidden=!(chosen()&&rowsState().some(r=>r.added));};
 const showItems=()=>{const t=chosen();setPeriod();$('#items').innerHTML=rowsEditor((t?.items||[]).map(i=>({...i,included:!!i.required})),true);bindRows(syncSave);refreshName();};
 showItems();if(keep&&!keep.freshTemplate){$('#items').innerHTML=rowsEditor(keep.items||[],true);bindRows(syncSave);$('#more').open=!!keep.more;}
 if(keep&&form.elements.owner_id)form.elements.owner_id.value=keep.owner||keep.fields?.owner_id||me.staff_id;
 onAdd($('#template'),()=>detour(done=>templateForm({},done),id=>({template:id,freshTemplate:true})));
 $('#client-pick').addEventListener('change',()=>{const r=regular(clients.find(x=>clientLabel(x)===$('#client-pick').value.trim()));if(r&&$('#template').value!==r){$('#template').value=r;showItems();}});
 const tpl=$('#template');tpl.addEventListener('change',()=>{if(tpl.isConnected&&tpl.value!==ADD)showItems();});
 if(form.elements.owner_id)onAdd(form.elements.owner_id,()=>detour(done=>staffForm({},done),id=>({owner:id})));
 document.querySelectorAll('[name=period_start],[name=period_end]').forEach(i=>i.oninput=()=>{datesTouched=true;refreshName();});
 $('#inline-client').onclick=()=>detour(done=>clientForm(null,done),id=>{const c=clients.find(x=>x.client_id===id);return {client:c?clientLabel(c):''};});
 bindForm('#case-form',async b=>{const client=clients.find(c=>clientLabel(c)===$('#client-pick').value.trim());if(!client)throw new Error('יש לבחור תיק מהרשימה, או ליצור תיק חדש.');if(b.period_start>b.period_end)throw new Error('תאריך הסיום של התקופה לפני תאריך ההתחלה.');
  b.requirements=selectedItems();if(!b.requirements.length)throw new Error('יש לסמן לפחות מסמך אחד.');if(!b.requirements.some(r=>r.required))throw new Error('לפחות מסמך אחד צריך להיות חובה.');
  const t=chosen(),added=rowsState().filter(r=>r.added);b.client_id=client.client_id;b.name=b.name.trim()||autoName();b.type=t?.name||'אחר';
  const r=await call('/api/cases',b);
  // Documents added here join the case type when the admin leaves the box ticked. The case is already open either way.
  if(t&&isAdmin()&&$('#save-type')?.checked&&added.length){try{await call('/api/templates',{template_id:t.template_id,name:t.name,items:[...t.items.map(i=>({document_id:i.document_id,required:!!i.required,max_files:Number(i.max_files)||1})),...added.map(a=>({...(a.document_id?{document_id:a.document_id}:{name:a.name}),required:a.required,max_files:a.max_files}))]});toast('המסמכים החדשים נשמרו גם ברשימת המסמכים');}catch(e){toast('הבקשה נפתחה, אבל המסמכים לא נשמרו ברשימת המסמכים: '+e.message);}}
  if(opts.inquiry)await call('/api/inquiries/'+opts.inquiry,{status:'handled',client_id:client.client_id}).catch(()=>{});
  $('#modal').close();await load();await showCase(r.case_id);sendDialog(r.case_id,true).catch(e=>toast(e.message));});}

// Sending: the office picks a channel (each card shows the phone or email it goes to), checks or edits the message,
// and opens WhatsApp or the email draft through a real link, which browsers do not block. The contact is recorded on that click.
async function sendDialog(caseId,fresh=false,prefer=''){
 const c=cases.find(x=>x.case_id===caseId)||await call('/api/cases/'+caseId);
 let text='',link='';try{const r=await call('/api/cases/'+caseId+'/reminder',{});text=r.text;link=r.link;}catch{}
 // A case with nothing missing still gets a plain message with its link.
 if(!link){link=(await call('/api/cases/'+caseId+'/link')).link;text=`שלום ${c.contact_name||c.client_name},\nהקישור האישי לבקשת המסמכים ${c.name}:\n${link}`+(String(c.phone||'').replace(/\D/g,'').length>=4?'\nלכניסה: 4 הספרות האחרונות של הנייד שלך.':'');}
 const local=location.hostname==='localhost'||location.hostname==='127.0.0.1',shown=local?location.origin+'/client.html#'+link.split('#')[1]:link;if(local)text=text.split(link).join(shown);
 const wa=/^\d{11,15}$/.test(c.whatsapp||'')?c.whatsapp:'',mail=c.email||'';
 const cards=[['whatsapp','WhatsApp',wa?c.phone:'',wa?'':'אין ללקוח נייד תקין'],['email','דוא״ל',mail,mail?'':'אין ללקוח כתובת דוא״ל'],['copy','העתקת ההודעה','להדבקה בכל מקום','']];
 dialog(fresh?'הבקשה נפתחה. שולחים ללקוח את הקישור':'שליחה ללקוח',`<p class="muted">בוחרים איך לשלוח. ההודעה נפתחת מוכנה, והשליחה עצמה נעשית מתוך WhatsApp או מתיבת הדוא״ל.</p>
<div class="channel-cards" role="radiogroup" aria-label="איך לשלוח">${cards.map(([k,label,to,why])=>`<button type="button" role="radio" aria-checked="false" data-channel="${k}" ${why?'disabled':''}><strong>${label}</strong><small>${why?esc(why):`<bdi dir="ltr">${esc(to)}</bdi>`}</small></button>`).join('')}</div>
<div id="send-step" hidden><label>ההודעה ללקוח<textarea id="send-text" rows="8">${esc(text)}</textarea></label><div class="actions"><a class="primary button-link" id="send-go" rel="noopener noreferrer"></a></div></div>
<details><summary>הקישור האישי לבקשה</summary><p class="link-box">${esc(shown)}</p><a href="${esc(shown)}" target="_blank" rel="noopener noreferrer">צפייה בעמוד של הלקוח ↗</a><p class="muted">הקישור הגיע למישהו אחר? אפשר לבטל אותו וליצור קישור חדש. הקישור הישן יפסיק לעבוד מיד.</p><button type="button" id="revoke-link">ביטול הקישור ויצירת קישור חדש</button></details>`);
 let channel='';const go=$('#send-go'),area=$('#send-text');
 const target=()=>channel==='whatsapp'?(()=>{const u=new URL('https://wa.me/'+wa);u.searchParams.set('text',area.value);return u.href;})():channel==='email'?`mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent('השלמת מסמכים — '+c.name)}&body=${encodeURIComponent(area.value)}`:'#';
 const choose=k=>{channel=k;document.querySelectorAll('[data-channel]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.channel===k)));$('#send-step').hidden=false;
  // <bdi> keeps a phone number or an address in its own direction inside the Hebrew label.
  go.innerHTML=k==='whatsapp'?`פתיחת WhatsApp ל־<bdi dir="ltr">${esc(c.phone)}</bdi>`:k==='email'?`פתיחת הדוא״ל ל־<bdi dir="ltr">${esc(mail)}</bdi>`:'העתקת ההודעה';
  if(k==='whatsapp')go.target='_blank';else go.removeAttribute('target');go.href=target();};
 area.oninput=()=>{if(channel)go.href=target();};
 document.querySelectorAll('[data-channel]').forEach(b=>b.onclick=()=>choose(b.dataset.channel));
 go.onclick=async e=>{if(channel==='copy'){e.preventDefault();try{await navigator.clipboard.writeText(area.value);}catch{toast('לא ניתן להעתיק. אפשר לסמן את ההודעה ולהעתיק ידנית.');return;}toast('ההודעה הועתקה');}
  else toast(channel==='whatsapp'?'WhatsApp נפתח. שולחים את ההודעה משם.':'טיוטת הדוא״ל נפתחה. שולחים אותה משם.');
  recordContact(caseId,channel);};
 const first=[prefer,'whatsapp','email','copy'].find(k=>k&&!document.querySelector(`[data-channel="${k}"]`)?.disabled);if(first)choose(first);
 $('#revoke-link').onclick=async()=>{if(!confirm('לבטל את הקישור הנוכחי? הלקוח יצטרך לקבל את הקישור החדש.'))return;try{await call('/api/cases/'+caseId+'/revoke-link',{});toast('נוצר קישור חדש. הקישור הישן בוטל.');await sendDialog(caseId,false,channel);}catch(e){toast(e.message);}};}
function linkDialog(link,caseId,fresh=false){return sendDialog(caseId,fresh);}

const openLink=id=>sendDialog(id).catch(e=>toast(e.message));

const events={case_created:'הבקשה נפתחה',upload_stored:'מסמך נשמר',upload_stored_late:'מסמך נשמר באיחור',upload_failed:'שמירת מסמך נכשלה',client_completed:'הלקוח סיים לשלוח',approved:'מסמך אושר',correction:'התבקש תיקון',reminder_prepared:'הוכנה תזכורת',case_status:'סטטוס הבקשה השתנה',link_revoked:'הקישור האישי הוחלף',owner_changed:'האחראי על הבקשה הוחלף',client_unavailable:'הלקוח ציין שאין לו מסמך',client_unavailable_undone:'הלקוח ביטל את "אין לי"',contact:'פנייה ללקוח'};
// The client said they do not have this document. The office approves the absence or asks for it anyway.
const noFile=r=>r.status==='missing'&&r.unavailable_note!=null;
// A document waiting for a decision comes first. Approved documents fold away so the page shows what is left to do.
const REVIEW_ORDER={"uploaded":0,"correction":1,"missing":2,"approved":3};
const reviewOrder=r=>noFile(r)?0:REVIEW_ORDER[r.status];
const reqCard=(r,locked)=>`<section class="panel card requirement-card"><div class="card-head"><div><h3>${esc(r.name)}</h3><small>${r.required?'חובה':'לפי הצורך'}${r.max_files>1?' · עד '+r.max_files+' קבצים':''}</small></div>${noFile(r)?'<span class="badge amber">אין ללקוח</span>':badge(r.status)}</div>${noFile(r)?`<p class="review-note"><strong>הלקוח ציין שאין לו את המסמך</strong>${r.unavailable_note?': '+esc(r.unavailable_note):'.'}</p>`:''}${r.correction_message?`<p class="review-note"><strong>הערה מהמשרד:</strong> ${esc(r.correction_message)}</p>`:''}<ul class="file-list">${r.uploads.map(u=>`<li><div>${u.drive_file_id?`<a target="_blank" rel="noopener noreferrer" href="https://drive.google.com/file/d/${encodeURIComponent(u.drive_file_id)}/view">${esc(u.filename)} ↗</a>`:esc(u.filename)}<small>גרסה ${u.version} · ${date(u.created_at)} · ${status[u.state]}</small>${u.client_note?`<p class="client-note"><strong>הערת הלקוח:</strong> ${esc(u.client_note)}</p>`:''}</div>${u.state==='pending'?`<button data-reconcile="${esc(u.submission_id)}">בדיקת שמירה</button>`:''}</li>`).join('')||'<li class="muted">טרם התקבל קובץ</li>'}</ul>${(r.uploads.some(u=>u.state==='stored')||noFile(r))&&!locked?`<div class="actions"><button class="approve-requirement" data-approve="${esc(r.requirement_id)}" ${r.status==='approved'?'disabled':''}>${noFile(r)?'אישור בלי המסמך ✓':'אישור המסמך ✓'}</button><button data-correct="${esc(r.requirement_id)}">${noFile(r)?'לבקש בכל זאת':'נדרש תיקון'}</button></div>`:''}</section>`;
// "Next" is the next case waiting for review in this person's list, earliest due date first.
const reviewQueue=id=>cases.filter(x=>x.status==='client_completed'&&x.case_id!==id).sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')||String(a.created_at).localeCompare(String(b.created_at))||a.case_id.localeCompare(b.case_id));
const nextInQueue=id=>reviewQueue(id)[0];
async function showCase(id){const c=await call('/api/cases/'+id),locked=['closed','archived'].includes(c.status),sorted=[...c.requirements].sort((x,y)=>reviewOrder(x)-reviewOrder(y)||x.position-y.position),open=sorted.filter(r=>r.status!=='approved'),done=sorted.filter(r=>r.status==='approved');
 // Same rule as the server: sent, stored, and nothing still saving.
 const reviewable=c.requirements.filter(r=>r.status==='uploaded'&&r.uploads.some(u=>u.state==='stored')&&!r.uploads.some(u=>u.state==='pending'));
 // "Next" is the next case waiting for review in this person's list, earliest due date first.
 const queue=reviewQueue(id),next=!reviewable.length&&queue[0];
 app.innerHTML=`<div class="back-links"><button class="back-button" id="back">→ חזרה לדשבורד</button><button class="back-button" id="to-file">→ לתיק של ${esc(c.client_name)}</button></div><div class="page-heading"><div><span class="eyebrow">${esc(c.business_number||'')}</span><h1>${esc(c.client_name)}</h1><p>${esc(c.name)} ${badge(c.status)}</p></div><div class="actions">${next?`<button class="primary" id="next-case">לבקשה הבאה שמחכה לבדיקה (${queue.length})</button>`:''}<button id="case-link">${locked?'הקישור האישי':'שליחה ללקוח'}</button>${locked?'<button class="primary" data-state="reopen">פתיחת הבקשה מחדש</button>':'<button class="primary" data-state="closed">סגירת הבקשה</button>'}</div></div>
<div class="case-stats"><div><span>${c.progress_kind==='approved'?'מסמכים שאושרו':'מסמכי חובה שהתקבלו'}</span><strong class="green-number">${Number(c.progress_done)||0}/${Number(c.progress_total)||0}</strong></div><div><span>מחכים לבדיקה</span><strong>${reviewable.length}</strong></div><div><span>ימים ליעד</span><strong class="${Number(c.days_left)<=Number(settings.urgent_days??2)?'urgent-number':''}">${Number.isFinite(Number(c.days_left))?Number(c.days_left):'—'}</strong></div></div><div class="detail-grid"><div>${c.status==='ready_for_work'&&!locked?'<section class="panel card done-state" role="status"><h2>כל המסמכים אושרו</h2><p>איסוף המסמכים הסתיים. אפשר לסגור את הבקשה.</p><button class="primary" data-state="closed">סגירת הבקשה</button></section>':''}${reviewable.length>=2&&!locked?`<section class="panel card review-all"><p><strong>${reviewable.length} מסמכים מחכים לבדיקה שלך.</strong><small>אפשר לפתוח כל אחד ולאשר, או לאשר את כולם יחד.</small></p><button class="primary" id="approve-all">אישור כל ${reviewable.length} המסמכים</button></section>`:''}${open.map(r=>reqCard(r,locked)).join('')}${done.length?`<details class="approved-docs"><summary>מסמכים שאושרו (${done.length})</summary>${done.map(r=>reqCard(r,locked)).join('')}</details>`:''}</div>
<aside><section class="panel card case-meta"><h3>פרטי הבקשה</h3><dl class="meta-grid"><div><dt>תקופת דיווח</dt><dd><bdi dir="ltr">${esc(c.reporting_period)}</bdi></dd></div><div><dt>תאריך יעד</dt><dd>${date(c.due_date)} ${deadlineLabel(c)}</dd></div><div><dt>אחראי</dt><dd>${esc(ownerName(c)||'—')}</dd></div><div><dt>קטגוריה</dt><dd>${esc(c.category||'—')}</dd></div><div><dt>דוא״ל</dt><dd>${esc(c.email||'—')}</dd></div><div><dt>טלפון</dt><dd>${esc(c.phone||'—')}</dd></div><div><dt>פנייה ללקוח</dt><dd>${contactLine(c)||'—'}</dd></div></dl><p class="muted">סגירת הבקשה נועלת אותה להעלאות, והקישור של הלקוח מפסיק להציג את המסמכים. אפשר לפתוח אותה מחדש בכל רגע.</p>${isAdmin()?`<label>העברה לאחראי אחר<select id="owner-pick"><option value="">בחירה…</option>${staff.filter(p=>p.active!==0&&p.staff_id!==c.owner_id).map(p=>`<option value="${esc(p.staff_id)}">${esc(p.name)}</option>`).join('')}</select></label>`:''}${locked?'':'<div class="actions"><button data-state="archived">העברה לארכיון</button></div>'}</section><section class="panel activity"><h3>מה קרה בבקשה</h3>${c.events.map(e=>`<div class="event"><span><strong>${esc(events[e.action]||e.action)}</strong><small>${esc([e.detail,e.actor_name?'· '+e.actor_name:e.actor_type==='client'?'· הלקוח':''].filter(Boolean).join(' '))}</small></span><time>${date(e.created_at)}</time></div>`).join('')}</section></aside></div>`;
 $('#back').onclick=()=>{view='cases';load().catch(e=>toast(e.message));};$('#to-file').onclick=()=>{view='clients';render();showClient(c.client_id);};$('#case-link').onclick=()=>openLink(id);
 document.querySelectorAll('[data-whatsapp]').forEach(b=>b.onclick=()=>sendWhatsapp(b.dataset.whatsapp));
 const review=async(r,status,message='')=>{await call('/api/cases/'+id+'/review',{requirement_id:r,status,message});cases=await call('/api/cases');await showCase(id);};
 if($('#next-case'))$('#next-case').onclick=async()=>{try{cases=await call('/api/cases');const fresh=nextInQueue(id);if(!fresh){toast('אין עוד בקשות שמחכות לבדיקה.');await showCase(id);return;}await showCase(fresh.case_id);}catch(e){toast(e.message);}};
 if($('#approve-all'))$('#approve-all').onclick=async e=>{if(!confirm(`לאשר את כל ${reviewable.length} המסמכים שמחכים לבדיקה?`))return;e.target.disabled=true;try{const r=await call('/api/cases/'+id+'/review-all',{requirement_ids:reviewable.map(x=>x.requirement_id)});toast(`אושרו ${r.approved_count} מסמכים`);cases=await call('/api/cases');await showCase(id);}catch(err){toast(err.message);e.target.disabled=false;}};
 document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>review(b.dataset.approve,'approved').catch(e=>toast(e.message)));
 document.querySelectorAll('[data-correct]').forEach(b=>b.onclick=()=>{dialog('מה לכתוב ללקוח?',`<form id="correction"><label>הסבר ללקוח *<textarea name="message" required maxlength="1000" placeholder="לדוגמה: חסר עמוד 2 בתדפיס"></textarea></label><button class="primary">שליחת הבקשה ללקוח</button></form>`);bindForm('#correction',async data=>{await review(b.dataset.correct,'correction',data.message);$('#modal').close();});});
 const confirmText={closed:'לסגור את הבקשה? הלקוח לא יוכל להעלות מסמכים עד שהבקשה תיפתח מחדש.',archived:'להעביר את הבקשה לארכיון? היא תינעל להעלאות.'};
 document.querySelectorAll('[data-state]').forEach(b=>b.onclick=async()=>{if(confirmText[b.dataset.state]&&!confirm(confirmText[b.dataset.state]))return;try{await call('/api/cases/'+id+'/status',{status:b.dataset.state});await showCase(id);}catch(e){toast(e.message);}});
 if($('#owner-pick'))$('#owner-pick').onchange=async e=>{const p=staff.find(x=>x.staff_id===e.target.value);if(!p)return;if(!confirm(`להעביר את הבקשה ל${p.name}?`)){e.target.value='';return;}try{await call('/api/cases/'+id+'/owner',{staff_id:p.staff_id});toast('האחראי הוחלף');await showCase(id);}catch(err){toast(err.message);}};
 document.querySelectorAll('[data-reconcile]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await call('/api/cases/'+id+'/reconcile',{submission_id:b.dataset.reconcile});await showCase(id);}catch(e){toast(e.message);b.disabled=false;}});}

// The document library is secondary: documents are added inside templates. This page only renames or retires them.
function renderDocuments(){app.innerHTML=`<button class="back-button" id="back">→ חזרה לרשימות המסמכים</button><div class="page-heading"><div><span class="eyebrow">הגדרות המשרד</span><h1>שמות המסמכים</h1><p>כל המסמכים שמופיעים ברשימות המסמכים. מסמך חדש נוסף לכאן לבד כשמוסיפים אותו לרשימה. כאן רק משנים שם או הנחיות ללקוח.</p></div><button class="primary" id="new-document">＋ מסמך</button></div><section class="panel card">${catalog.map(c=>`<div class="catalog-item"><div><strong>${esc(c.name)}</strong><small>${esc(c.description)} ${c.active?'':'· לא פעיל'}</small></div><button data-edit-document="${esc(c.document_id)}">עריכה</button></div>`).join('')}</section>`;
 const editDocument=(c={})=>{dialog(c.document_id?'עריכת מסמך':'מסמך חדש',`<form id="document-form">${field('name','שם המסמך','text',c.name||'',true)}${field('description','הנחיות ללקוח','text',c.description||'')}<label>פעיל בספרייה<select name="active"><option value="true" ${c.active!==0?'selected':''}>כן</option><option value="false" ${c.active===0?'selected':''}>לא</option></select></label><button class="primary">שמירה</button></form>`);bindForm('#document-form',async b=>{await call('/api/catalog',{...b,active:b.active==='true',document_id:c.document_id});$('#modal').close();await load();});};
 $('#back').onclick=()=>{view='templates';render();};
 $('#new-document').onclick=()=>editDocument();document.querySelectorAll('[data-edit-document]').forEach(b=>b.onclick=()=>editDocument(catalog.find(c=>c.document_id===b.dataset.editDocument)));}

function renderTemplates(){app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">הגדרות המשרד</span><h1>רשימות מסמכים</h1><p>לכל סוג עבודה רשימה מוכנה של המסמכים שמבקשים מהלקוח. בבקשה חדשה מסמכי החובה מסומנים מראש, ומסמכים "לפי הצורך" מסמנים רק כשצריך. שינוי כאן חל על בקשות חדשות בלבד.</p></div><div class="actions"><button id="library">שמות המסמכים</button><button class="primary" id="new-template">＋ רשימת מסמכים חדשה</button></div></div>${templates.length?`<section class="panel list-rows">${templates.map(t=>`<div class="list-row"><div class="list-main"><strong>${esc(t.name)}</strong><small>${t.items.filter(i=>i.required).length} חובה · ${t.items.filter(i=>!i.required).length} לפי הצורך</small></div><ul class="doc-chips">${t.items.map(i=>`<li class="${i.required?'req':''}" title="${i.required?'חובה':'לפי הצורך'}${i.max_files>1?' · עד '+i.max_files+' קבצים':''}">${esc(i.name)}</li>`).join('')}</ul><button data-edit-template="${esc(t.template_id)}">עריכה</button></div>`).join('')}</section>`:'<section class="panel card"><p class="muted">עדיין אין רשימות מסמכים.</p></section>'}`;
 $('#library').onclick=()=>{view='documents';render();};
 $('#new-template').onclick=()=>templateForm();document.querySelectorAll('[data-edit-template]').forEach(b=>b.onclick=()=>templateForm(templates.find(t=>t.template_id===b.dataset.editTemplate)));}

function renderSettings(){const s=settings;app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">הגדרות המשרד</span><h1>הגדרות</h1><p>הפרטים שמופיעים ללקוחות ובתזכורות.</p></div></div><div class="detail-grid"><section class="panel card"><form id="settings-form"><h2>פרטי המשרד</h2><div class="form-grid">${field('office_name','שם המשרד','text',s.office_name||'',true)}${field('manager_name','מנהל/ת המשרד','text',s.manager_name||'')}${field('phone','טלפון','tel',s.phone||'')}${field('email','דוא״ל','email',s.email||'')}${field('address','כתובת','text',s.address||'')}</div><h2>התרעות על תאריך יעד</h2><div class="form-grid">${field('warning_days','התרעה צהובה, ימים לפני היעד','number',s.warning_days??7,true)}${field('urgent_days','התרעה אדומה, ימים לפני היעד','number',s.urgent_days??2,true)}</div><h2>נוסח תזכורת בוואטסאפ</h2><label class="wide">נוסח ההודעה<textarea name="whatsapp_template" rows="7" maxlength="1000" placeholder="ריק = הנוסח הרגיל">${esc(s.whatsapp_template||'')}</textarea></label><p class="muted">אפשר לשלב: {client} שם הלקוח, {request} שם הבקשה, {period} תקופה, {due} תאריך יעד, {missing} רשימת המסמכים החסרים, {link} הקישור האישי, {office} שם המשרד.</p><button class="primary">שמירת ההגדרות</button></form></section>
<aside><section class="panel card"><h3>לוגו המשרד</h3><div id="logo-preview"></div><label>קובץ לוגו<input type="file" id="logo-file" accept=".png,.jpg,.jpeg,image/png,image/jpeg"></label><p class="muted">PNG או JPG, עד 200KB. הלוגו נשמר מיד ולא משנה את הטופס.</p><div class="actions"><button type="button" class="primary" id="logo-upload">העלאת לוגו</button><button type="button" id="logo-remove">הסרת הלוגו</button></div></section><section class="panel card"><h3>ייצוא נתונים</h3><p class="muted">קובץ CSV שנפתח באקסל, לגיבוי או להעברה לתוכנת הנהלת חשבונות.</p><div class="actions"><button type="button" data-export="clients">ייצוא תיקים</button><button type="button" data-export="cases">ייצוא בקשות</button></div></section></aside></div>`;
 // Logo changes only redraw the preview, so unsaved form fields stay as typed.
 const preview=()=>{$('#logo-preview').innerHTML=settings.logo_version?`<img src="${esc(window.PORTAL_CONFIG.api)}/api/logo?v=${Number(settings.logo_version)}" alt="לוגו המשרד">`:'<p class="muted">עדיין לא הועלה לוגו.</p>';$('#logo-remove').hidden=!settings.logo_version;};preview();
 bindForm('#settings-form',async b=>{settings=await call('/api/settings',{...b,warning_days:Number(b.warning_days),urgent_days:Number(b.urgent_days)});applyBranding(settings);toast('ההגדרות נשמרו');view='cases';await load();});
 const logo=async data=>{const fresh=await call('/api/settings/logo',{data});settings={...settings,logo_version:fresh.logo_version};applyBranding(fresh);preview();};
 $('#logo-upload').onclick=async()=>{const f=$('#logo-file').files[0];if(!f){toast('יש לבחור קובץ לוגו.');return;}if(f.size>200*1024){toast('קובץ הלוגו גדול מ־200KB.');return;}try{await logo(await new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=fail;r.readAsDataURL(f);}));$('#logo-file').value='';toast('הלוגו עודכן');}catch(e){toast(e.message);}};
 $('#logo-remove').onclick=async()=>{try{await logo('');toast('הלוגו הוסר');}catch(e){toast(e.message);}};
 document.querySelectorAll('[data-export]').forEach(b=>b.onclick=async()=>{try{const r=await call('/api/csv/export',{entity:b.dataset.export}),url=URL.createObjectURL(new Blob([r.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=b.dataset.export+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}});}

// The admin adds staff, sets roles, and sees who has been in the app lately.
const seen=t=>{if(!t)return 'עדיין לא נכנס/ה';const m=Math.round((Date.now()-Date.parse(t))/60000);return m<10?'פעיל/ה עכשיו':m<60?`לפני ${m} דקות`:date(t);};
// Every list can add a new entry in place. after(id) returns to the screen that asked, with the new entry chosen.
function templateForm(t={},after){dialog(t.template_id?'עריכת רשימת מסמכים':'רשימת מסמכים חדשה',`<form id="template-form">${field('name','שם הרשימה','text',t.name||'',true)}<h3>המסמכים שמבקשים מהלקוח</h3>${rowsEditor(t.items||[])}<button class="primary">שמירה</button></form>`);bindRows();
 bindForm('#template-form',async b=>{const items=selectedItems();if(!items.length)throw new Error('יש להוסיף לפחות מסמך אחד.');const r=await call('/api/templates',{...b,template_id:t.template_id,items});$('#modal').close();await load();if(after)after(r.template_id);});}
function staffForm(p={},after){dialog(p.staff_id?'עריכת איש צוות':'איש צוות חדש',`<form id="staff-form"><div class="form-grid">${field('name','שם','text',p.name||'',true)}${field('email','דוא״ל לכניסה','email',p.email||'',true)}<label>תפקיד<select name="role"><option value="manager" ${p.role!=='admin'?'selected':''}>${roles.manager}: רואה רק את הבקשות שלו</option><option value="admin" ${p.role==='admin'?'selected':''}>${roles.admin}: רואה הכול ומנהל הגדרות</option></select></label>${p.staff_id?`<label>מצב<select name="active"><option value="true" ${p.active?'selected':''}>פעיל/ה</option><option value="false" ${p.active?'':'selected'}>לא פעיל/ה (לא יכול/ה להיכנס)</option></select></label>`:''}<label class="wide">${p.staff_id?'סיסמה חדשה (לא חובה)':'סיסמה ראשונה'}<input name="password" type="password" minlength="8" autocomplete="new-password" ${p.staff_id?'':'required'}><small class="muted">8 תווים לפחות. מוסרים אותה לאיש הצוות, והוא יכול להחליף אותה ב"החשבון שלי".</small></label></div><p id="form-error" class="error" role="alert"></p><button class="primary">שמירה</button></form>`);
  bindForm('#staff-form',async b=>{const r=await call('/api/staff',{...b,staff_id:p.staff_id,active:b.active!=='false',password:b.password||undefined});$('#modal').close();toast('נשמר');if(after){staff=await call('/api/staff');after(r.staff_id);}else if(p.staff_id===me.staff_id)await load();else await render();});}
// A select whose last option is "＋ …". Picking it opens the add form and puts the select back on its previous value.
const ADD='__add__';
const addOption=label=>`<option value="${ADD}">＋ ${esc(label)}</option>`;
function onAdd(select,open){let last=select.value;select.addEventListener('change',()=>{if(select.value!==ADD){last=select.value;return;}select.value=last;open();});}
async function renderStaff(){staff=await call('/api/staff');
 app.innerHTML=`<div class="page-heading"><div><span class="eyebrow">הגדרות המשרד</span><h1>צוות</h1><p>מי עובד במערכת ומה מותר לו. מנהל/ת תיקים רואה רק את הבקשות שלו. מנהל/ת משרד רואה הכול.</p></div><button class="primary" id="new-staff">＋ איש צוות</button></div>
<section class="panel table-wrap"><table><thead><tr><th>שם</th><th>דוא״ל</th><th>תפקיד</th><th>בקשות פתוחות</th><th>כניסה אחרונה</th><th></th></tr></thead><tbody>${staff.map(p=>`<tr><td><strong>${esc(p.name)}</strong>${p.active?'':'<small>לא פעיל/ה</small>'}${p.staff_id===me.staff_id?'<small>זה את/ה</small>':''}</td><td>${esc(p.email)}</td><td>${esc(roles[p.role])}</td><td>${p.open_cases}</td><td>${esc(seen(p.last_seen_at))}</td><td><button data-edit-staff="${esc(p.staff_id)}">עריכה</button></td></tr>`).join('')}</tbody></table></section>`;
 $('#new-staff').onclick=()=>staffForm();
 document.querySelectorAll('[data-edit-staff]').forEach(b=>b.onclick=()=>staffForm(staff.find(p=>p.staff_id===b.dataset.editStaff)));}


function account(){dialog('החשבון שלי',`<dl class="meta-grid"><div><dt>שם</dt><dd>${esc(me.name)}</dd></div><div><dt>דוא״ל</dt><dd>${esc(me.email)}</dd></div><div><dt>תפקיד</dt><dd>${esc(roles[me.role])}</dd></div></dl><form id="password-form"><h3>החלפת סיסמה</h3><label>הסיסמה הנוכחית<input name="current" type="password" autocomplete="current-password" required></label><label>סיסמה חדשה<input name="password" type="password" minlength="8" autocomplete="new-password" required><small class="muted">8 תווים לפחות. המכשירים האחרים שלך ינותקו.</small></label><p id="form-error" class="error" role="alert"></p><button class="primary">החלפת סיסמה</button></form>`);
 bindForm('#password-form',async b=>{await call('/api/me/password',b);$('#modal').close();toast('הסיסמה הוחלפה');});}
$('#me').onclick=account;
$('#logout').onclick=async()=>{try{await call('/api/logout',{});}finally{token='';sessionStorage.removeItem('office_session');$('#logout').hidden=true;$('#me').hidden=true;login();}};
// The menu always shows fresh data, so work done a moment ago (a review, a contact) is already in the list.
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{if(!token)return;view=b.dataset.view;load().catch(e=>toast(e.message));});
api('/api/branding').then(applyBranding).catch(()=>{});
if(token)load().catch(()=>{token='';sessionStorage.removeItem('office_session');login();});else login();

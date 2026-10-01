import {$,esc,status,clientStatus,badge as officeBadge,date,toast,api,progress} from './common.mjs';
const badge=s=>officeBadge(s,clientStatus);
const token=location.hash.slice(1),app=$('#app');
const call=(path,data)=>api(path,{caseToken:token,...(data!==undefined?{method:'POST',data}:{})});
const MAX_BYTES=4*1024*1024,ACCEPT='.pdf,.png,.jpg,.jpeg';
let current,openRow=null;
// Files the client chose but has not sent yet, per document. Kept outside the page so a refresh of the list never loses them.
const drafts=new Map();
const draftOf=rid=>drafts.get(rid)||{files:[],note:''};
async function load(){current=await call('/api/portal');render(current);}
// The office name and logo come from the office settings.
api('/api/branding').then(b=>{if(b.office_name)$('#office-name').textContent=b.office_name;if(b.logo_version)$('.brand-mark').innerHTML=`<img src="${esc(window.PORTAL_CONFIG.api)}/api/logo?v=${Number(b.logo_version)}" alt="">`;}).catch(()=>{});
// Leaving with chosen but unsent files asks first. Browsers cannot restore chosen files after a reload.
addEventListener('beforeunload',e=>{if([...drafts.values()].some(d=>d.files.length)){e.preventDefault();e.returnValue='';}});

// How many more files a document takes. A correction replaces with exactly one file.
function room(r){const stored=r.uploads.filter(u=>u.state==='stored').length;return r.status==='correction'?1:Math.max(0,r.max_files-stored);}
function canAdd(r,locked){return !locked&&r.status!=='approved'&&!r.uploads.some(u=>u.state==='pending')&&room(r)>0;}
function capacity(r){const stored=r.uploads.filter(u=>u.state==='stored').length;
 if(r.status==='correction')return 'נדרש קובץ מתוקן אחד';
 return r.max_files>1?`נשלחו ${stored} מתוך ${r.max_files} קבצים`:stored?'הקובץ נשלח':'קובץ אחד';}

// One row per document: name, status, and two actions. "＋" opens the panel to choose files and add a note;
// after choosing, the row lists the files and its send button becomes active.
function row(r,locked){const id=r.requirement_id,d=draftOf(id),open=openRow===id&&canAdd(r,locked),pending=r.uploads.some(u=>u.state==='pending');
 return `<section class="doc-row" id="req-${esc(id)}" data-requirement="${esc(id)}" data-status="${esc(r.status)}">
<div class="doc-main"><div><h3>${esc(r.name)}</h3><small>${r.required?'מסמך חובה':'רשות'} · ${capacity(r)}</small></div>${badge(r.status)}</div>
${r.correction_message?`<p class="review-note"><strong>הערה מהמשרד:</strong> ${esc(r.correction_message)}</p>`:''}
${r.uploads.length?`<ul class="file-list">${r.uploads.map(u=>`<li><div>${esc(u.filename)}<small>${date(u.created_at)} · ${status[u.state]}</small></div></li>`).join('')}</ul>`:''}
${pending?'<p class="pending-note">ממתינים לאישור שמירת הקובץ. אין צורך להעלות שוב. אפשר לרענן בעוד רגע.</p>':''}
${d.files.length?`<div class="draft"><p class="draft-title">מוכן לשליחה:</p><ul class="draft-files">${d.files.map((f,i)=>`<li><span>${esc(f.name)}</span><button type="button" class="text-button" data-remove-file="${esc(id)}" data-index="${i}" aria-label="הסרת ${esc(f.name)}">הסרה</button></li>`).join('')}</ul>${d.note?`<p class="draft-note">הערה למשרד: ${esc(d.note)}</p>`:''}</div>`:''}
${canAdd(r,locked)?`<div class="doc-actions"><button type="button" class="add-files" data-open="${esc(id)}" aria-expanded="${open}" aria-controls="panel-${esc(id)}">${d.files.length?'שינוי או הוספה':r.status==='correction'?'＋ הוספת הקובץ המתוקן':'＋ הוספת קבצים'}</button><button type="button" class="primary send" data-send="${esc(id)}" ${d.files.length?'':'disabled aria-disabled="true"'}>${r.status==='correction'?'שליחת התיקון למשרד':'שליחה למשרד'}</button></div>`:''}
${open?`<div class="doc-panel" id="panel-${esc(id)}" role="group" aria-label="הוספת קבצים ל${esc(r.name)}">
<label class="upload-zone">בחירת ${room(r)>1?'קבצים':'קובץ'}<input type="file" accept="${ACCEPT}" ${room(r)>1?'multiple':''} data-files="${esc(id)}"><small>PDF, JPG או PNG · עד 4MB לקובץ · אפשר עוד ${room(r)-d.files.length>0?room(r)-d.files.length:0}</small></label>
<label>הערה למשרד (לא חובה)<textarea data-note="${esc(id)}" maxlength="500" rows="2" placeholder="לדוגמה: התדפיס כולל גם את חודש יולי">${esc(d.note)}</textarea></label>
<button type="button" data-close="${esc(id)}">סיום</button></div>`:''}
<p class="upload-status" role="status" id="status-${esc(id)}"></p></section>`;}

function render(c){const locked=['closed','archived'].includes(c.status),missing=c.requirements.filter(r=>r.status==='correction'||r.required&&!['uploaded','approved'].includes(r.status));
 app.innerHTML=`<section class="welcome"><span class="eyebrow">שלום ${esc(c.client_name)}</span><div class="card-head"><h1>${esc(c.name)}</h1>${badge(c.status)}</div><dl class="meta-grid"><div><dt>תקופת הדיווח</dt><dd>${esc(c.reporting_period)}</dd></div><div><dt>תאריך יעד להעברת החומרים</dt><dd>${date(c.due_date)}</dd></div></dl><p>אפשר להעלות בהדרגה ולחזור לקישור הזה בכל זמן.</p>${progress(c)}</section>
${!locked&&missing.length?`<section class="panel card still-needed"><h2>עוד חסר: ${missing.length}</h2><ul>${missing.map(r=>`<li><a href="#req-${esc(r.requirement_id)}" data-jump="${esc(r.requirement_id)}">${esc(r.name)}</a>${r.status==='correction'?' · נדרש תיקון':''}</li>`).join('')}</ul></section>`:''}
${c.status==='client_completed'?'<section class="success done-state" role="status"><h2>כל המסמכים נשלחו למשרד</h2><p>המשרד יבדוק אותם ויעדכן אם צריך תיקון. אין צורך לעשות דבר נוסף כרגע.</p></section>':c.status==='ready_for_work'?'<p class="success">כל המסמכים נבדקו ואושרו. התיק מוכן לטיפול.</p>':''}
${locked?'<p class="pending-note">התיק סגור. לצורך שינוי אפשר לפנות למשרד.</p>':''}
<div class="doc-rows">${c.requirements.map(r=>row(r,locked)).join('')}</div>
${locked||!missing.length?'':`<div class="sticky-finish"><p>נותרו ${missing.length} מסמכי חובה או תיקונים לשליחה.<br><span class="muted">כשכל מסמכי החובה יישלחו, התיק יעבור אוטומטית לבדיקת המשרד.</span></p></div>`}
<p class="client-bottom"><button id="refresh">רענון מצב המסמכים</button><br>הקישור אישי לתיק הזה. אין צורך להזין שוב פרטים.</p>`;
 bind(c);}

function setStatus(rid,text){const p=$('#status-'+CSS.escape(rid));if(p)p.textContent=text;}
function rerender(focus){render(current);if(focus)document.querySelector(focus)?.focus();}

function bind(c){
 $('#refresh').onclick=()=>load().catch(e=>toast(e.message));
 // The page hash is the case token, so jumps scroll instead of changing the URL.
 document.querySelectorAll('[data-jump]').forEach(a=>a.onclick=e=>{e.preventDefault();document.getElementById('req-'+a.dataset.jump)?.scrollIntoView({behavior:'smooth',block:'start'});});
 document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{const id=b.dataset.open;openRow=openRow===id?null:id;rerender(openRow?`[data-files="${CSS.escape(id)}"]`:`[data-open="${CSS.escape(id)}"]`);});
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{const id=b.dataset.close;openRow=null;rerender(`[data-send="${CSS.escape(id)}"]:not([disabled]),[data-open="${CSS.escape(id)}"]`);});
 document.querySelectorAll('[data-note]').forEach(t=>t.oninput=()=>{const id=t.dataset.note;drafts.set(id,{...draftOf(id),note:t.value});});
 document.querySelectorAll('[data-files]').forEach(input=>input.onchange=()=>{const id=input.dataset.files,r=c.requirements.find(x=>x.requirement_id===id),d=draftOf(id);
  const picked=[...input.files],known=new Set(d.files.map(f=>f.name+':'+f.size)),fresh=picked.filter(f=>!known.has(f.name+':'+f.size));
  const tooBig=fresh.find(f=>f.size>MAX_BYTES);if(tooBig){setStatus(id,`הקובץ ${tooBig.name} גדול מ־4MB.`);input.value='';return;}
  const files=[...d.files,...fresh];if(files.length>room(r)){setStatus(id,room(r)===1?'אפשר לשלוח כאן קובץ אחד.':`אפשר לשלוח כאן עוד ${room(r)} קבצים.`);input.value='';return;}
  drafts.set(id,{...d,files});openRow=null;rerender(`[data-send="${CSS.escape(id)}"]`);});
 document.querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=()=>{const id=b.dataset.removeFile,d=draftOf(id);d.files.splice(Number(b.dataset.index),1);drafts.set(id,d);rerender(`[data-open="${CSS.escape(id)}"]`);});
 document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>send(c,b.dataset.send,b));
}

// Sends the chosen files one by one. A file already sent leaves the draft at once, so a failure halfway only keeps the rest.
// The note travels with the first file only, so the office sees it once.
async function send(c,id,button){const r=c.requirements.find(x=>x.requirement_id===id),d=draftOf(id);if(!d.files.length)return;
 button.disabled=true;let first=true;
 try{while(d.files.length){const file=d.files[0],note=first?d.note.trim():'';setStatus(id,'שומר את '+file.name+'…');
   const storageKey='upload:'+[id,file.name,file.size,file.lastModified,note].join(':');let sid=sessionStorage.getItem(storageKey);if(!sid){sid=crypto.randomUUID();sessionStorage.setItem(storageKey,sid);}
   const data=new FormData();data.set('file',file);data.set('requirement_id',id);data.set('submission_id',sid);if(note)data.set('client_note',note);
   const result=await call('/api/portal/uploads',data);sessionStorage.removeItem(storageKey);d.files.shift();first=false;
   if(result.status!=='stored'){toast('הקובץ ממתין לאישור שמירה. אין להעלות אותו שוב.');break;}}
  if(!d.files.length)drafts.delete(id);else drafts.set(id,{...d,note:''});
  await load();setStatus(id,'נשלח למשרד ✓');if(current.status==='client_completed')window.scrollTo({top:0,behavior:'smooth'});}
 catch(error){drafts.set(id,d);if(r)render(current);setStatus(id,error.message);}}

if(!/^[a-f0-9]{64}$/.test(token))app.innerHTML='<section class="panel card"><h1>נדרש קישור אישי</h1><p>פתחו את הקישור שקיבלתם מהמשרד כדי לראות את מסמכי התיק.</p></section>';else load().catch(e=>{app.innerHTML=`<section class="panel card"><h1>לא ניתן לפתוח את התיק</h1><p>${esc(e.message)}</p><button id="retry">ניסיון נוסף</button></section>`;$('#retry').onclick=()=>location.reload();});

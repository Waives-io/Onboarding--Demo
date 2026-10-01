import {$,esc,status,clientStatus,badge as officeBadge,date,toast,api,progress} from './common.mjs';
const badge=s=>officeBadge(s,clientStatus);
const token=location.hash.slice(1),app=$('#app');
// The last 4 digits of the client's mobile open the link. Kept for this tab only, so a shared computer forgets them.
const PIN_KEY='pin:'+token;
const pin=()=>{try{return sessionStorage.getItem(PIN_KEY)||'';}catch{return '';}};
const call=(path,data)=>api(path,{caseToken:token,pin:pin(),...(data!==undefined?{method:'POST',data}:{})});
const MAX_BYTES=4*1024*1024,ACCEPT='.pdf,.png,.jpg,.jpeg';
let current,openRow=null,openMissing=null;
// Files the client chose but has not sent yet, per document. Kept outside the page so a refresh of the list never loses them.
const drafts=new Map();
const draftOf=rid=>drafts.get(rid)||{files:[],note:''};
async function load(){try{current=await call('/api/portal');}catch(e){if(['pin_required','wrong_pin'].includes(e.code)){pinForm(e.code==='wrong_pin'?e.message:'');return;}throw e;}render(current);}
function pinForm(error=''){app.innerHTML=`<section class="panel card pin-card"><span class="eyebrow">כניסה לבקשת המסמכים</span><h1>רק לוודא שזה את/ה</h1><p>מקישים את <strong>4 הספרות האחרונות</strong> של מספר הנייד שמסרתם למשרד.</p><form id="pin-form" novalidate><label>4 ספרות *<input id="pin" name="pin" inputmode="numeric" autocomplete="off" maxlength="4" dir="ltr" placeholder="••••" aria-describedby="pin-error" required></label><p id="pin-error" class="error" role="alert" aria-live="polite">${esc(error)}</p><button class="primary">כניסה</button></form></section>`;
 const input=$('#pin');input.focus();input.oninput=()=>{input.value=input.value.replace(/\D/g,'').slice(0,4);$('#pin-error').textContent='';};
 $('#pin-form').onsubmit=async e=>{e.preventDefault();if(!/^\d{4}$/.test(input.value)){$('#pin-error').textContent='צריך 4 ספרות.';input.focus();return;}
  const b=e.submitter;b.disabled=true;try{sessionStorage.setItem(PIN_KEY,input.value);}catch{}
  try{await load();}catch(err){$('#pin-error').textContent=err.message;}finally{if(b.isConnected)b.disabled=false;}};}
// The office name and logo come from the office settings.
api('/api/branding').then(b=>{if(b.office_name)$('#office-name').textContent=b.office_name;if(b.logo_version)$('.brand-mark').innerHTML=`<img src="${esc(window.PORTAL_CONFIG.api)}/api/logo?v=${Number(b.logo_version)}" alt="">`;}).catch(()=>{});
// Leaving with chosen but unsent files asks first. Browsers cannot restore chosen files after a reload.
addEventListener('beforeunload',e=>{if([...drafts.values()].some(d=>d.files.length)){e.preventDefault();e.returnValue='';}});

// How many more files a document takes. A correction replaces with exactly one file.
function room(r){const stored=r.uploads.filter(u=>u.state==='stored').length;return r.status==='correction'?1:Math.max(0,r.max_files-stored);}
// The client says they do not have a document. The office then approves the absence or asks again.
const noFile=r=>r.status==='missing'&&r.unavailable_note!=null;
function canAdd(r,locked){return !locked&&r.status!=='approved'&&!r.uploads.some(u=>u.state==='pending')&&room(r)>0;}
function capacity(r){const stored=r.uploads.filter(u=>u.state==='stored').length;
 if(r.status==='correction')return 'נדרש קובץ מתוקן אחד';
 return r.max_files>1?`נשלחו ${stored} מתוך ${r.max_files} קבצים`:stored?'הקובץ נשלח':'קובץ אחד';}

// One row per document: name, status, and two actions. "＋" opens the panel to choose files and add a note;
// after choosing, the row lists the files and its send button becomes active.
function row(r,locked){const id=r.requirement_id,d=draftOf(id),open=openRow===id&&canAdd(r,locked),pending=r.uploads.some(u=>u.state==='pending');
 return `<section class="doc-row" id="req-${esc(id)}" data-requirement="${esc(id)}" data-status="${esc(r.status)}">
<div class="doc-main"><div><h3>${esc(r.name)}</h3><small>${r.required?'מסמך חובה':'לפי הצורך'} · ${capacity(r)}</small></div>${noFile(r)?'<span class="badge amber">סימנת: אין לי</span>':badge(r.status)}</div>
${noFile(r)?`<div class="missing-answer"><p>סימנת שאין לך את המסמך${r.unavailable_note?': '+esc(r.unavailable_note):'.'} המשרד יעדכן אם בכל זאת צריך אותו.</p>${locked?'':`<button type="button" class="text-button" data-undo-missing="${esc(id)}">ביטול: יש לי את המסמך</button>`}</div>`:''}
${r.correction_message?`<p class="review-note"><strong>הערה מהמשרד:</strong> ${esc(r.correction_message)}</p>`:''}
${r.uploads.length?`<ul class="file-list">${r.uploads.map(u=>`<li><div>${esc(u.filename)}<small>${date(u.created_at)} · ${status[u.state]}</small></div></li>`).join('')}</ul>`:''}
${pending?'<p class="pending-note">ממתינים לאישור שמירת הקובץ. אין צורך להעלות שוב. אפשר לרענן בעוד רגע.</p>':''}
${d.files.length?`<div class="draft"><p class="draft-title">מוכן לשליחה:</p><ul class="draft-files">${d.files.map((f,i)=>`<li><span>${esc(f.name)}</span><button type="button" class="text-button" data-remove-file="${esc(id)}" data-index="${i}" aria-label="הסרת ${esc(f.name)}">הסרה</button></li>`).join('')}</ul>${d.note?`<p class="draft-note">הערה למשרד: ${esc(d.note)}</p>`:''}</div>`:''}
${canAdd(r,locked)?`<div class="doc-actions"><button type="button" class="add-files" data-open="${esc(id)}" aria-expanded="${open}" aria-controls="panel-${esc(id)}">${d.files.length?'שינוי או הוספה':r.status==='correction'?'＋ הוספת הקובץ המתוקן':'＋ הוספת קבצים'}</button><button type="button" class="primary send" data-send="${esc(id)}" ${d.files.length?'':'disabled aria-disabled="true"'}>${r.status==='correction'?'שליחת התיקון למשרד':'שליחה למשרד'}</button></div>`:''}
${open?`<div class="doc-panel" id="panel-${esc(id)}" role="group" aria-label="הוספת קבצים ל${esc(r.name)}">
<label class="upload-zone">בחירת ${room(r)>1?'קבצים':'קובץ'}<input type="file" accept="${ACCEPT}" ${room(r)>1?'multiple':''} data-files="${esc(id)}"><small>PDF, JPG או PNG · עד 4MB לקובץ · אפשר עוד ${room(r)-d.files.length>0?room(r)-d.files.length:0}</small></label>
<label>הערה למשרד (לא חובה)<textarea data-note="${esc(id)}" maxlength="500" rows="2" placeholder="לדוגמה: התדפיס כולל גם את חודש יולי">${esc(d.note)}</textarea></label>
<button type="button" data-close="${esc(id)}">סיום</button></div>`:''}
${!locked&&r.required&&r.status==='missing'&&!noFile(r)&&!pending&&!d.files.length?(openMissing===id?`<div class="doc-panel" role="group" aria-label="אין לי את ${esc(r.name)}"><label>מה המצב? (לא חובה)<textarea data-missing-note="${esc(id)}" maxlength="500" rows="2" placeholder="לדוגמה: לא עבדתי השנה כשכיר"></textarea></label><div class="doc-actions"><button type="button" class="primary" data-missing-send="${esc(id)}">שליחה למשרד</button><button type="button" data-missing-cancel="${esc(id)}">ביטול</button></div></div>`:`<button type="button" class="text-button missing-link" data-missing="${esc(id)}">אין לי את המסמך הזה</button>`):''}
<p class="upload-status" role="status" id="status-${esc(id)}"></p></section>`;}

function render(c){if(c.closed){app.innerHTML=`<section class="panel card"><span class="eyebrow">שלום ${esc(c.contact_name||c.client_name)}</span><h1>${esc(c.name)}</h1><p>הבקשה סגורה, ולכן המסמכים לא מוצגים כאן. לשאלות אפשר לפנות למשרד.</p></section>`;return;}
 const locked=['closed','archived'].includes(c.status),missing=c.requirements.filter(r=>r.status==='correction'||r.required&&!['uploaded','approved'].includes(r.status)&&!noFile(r));
 app.innerHTML=`<section class="welcome"><span class="eyebrow">שלום ${esc(c.contact_name||c.client_name)}</span><div class="card-head"><h1>${esc(c.name)}</h1>${badge(c.status)}</div><dl class="meta-grid"><div><dt>תקופת הדיווח</dt><dd><bdi dir="ltr">${esc(c.reporting_period)}</bdi></dd></div><div><dt>תאריך יעד להעברת החומרים</dt><dd>${date(c.due_date)}</dd></div></dl><p>אפשר להעלות בהדרגה ולחזור לקישור הזה בכל זמן. מסמך שאין לך? מסמנים "אין לי את המסמך הזה".</p>${progress(c)}</section>
${!locked&&missing.length?`<section class="panel card still-needed"><h2>עוד חסר: ${missing.length}</h2><ul>${missing.map(r=>`<li><a href="#req-${esc(r.requirement_id)}" data-jump="${esc(r.requirement_id)}">${esc(r.name)}</a>${r.status==='correction'?' · נדרש תיקון':''}</li>`).join('')}</ul></section>`:''}
${c.status==='client_completed'?`<section class="success done-state client-complete" role="status"><div class="completion-illustration" aria-hidden="true"><div class="completion-folder"><i></i><i></i></div><span class="completion-tick">✓</span></div><span class="badge green">נשלח למשרד</span><h2>כל המסמכים נשלחו למשרד</h2><p>המשרד יבדוק אותם ויעדכן אם צריך תיקון. אין צורך לעשות דבר נוסף כרגע.</p><div class="completion-summary">${progress(c)}</div></section>`:c.status==='ready_for_work'?'<p class="success">כל המסמכים נבדקו ואושרו. הבקשה הושלמה. תודה!</p>':''}
${locked?'<p class="pending-note">הבקשה סגורה. לצורך שינוי אפשר לפנות למשרד.</p>':''}
<div class="doc-rows">${c.requirements.map(r=>row(r,locked)).join('')}</div>
${locked||!missing.length?'':`<div class="sticky-finish"><p>נותרו ${missing.length} מסמכי חובה או תיקונים לשליחה.<br><span class="muted">כשכל מסמכי החובה יישלחו או יסומנו "אין לי", הבקשה תעבור אוטומטית לבדיקת המשרד.</span></p></div>`}
<p class="client-bottom"><button id="refresh">רענון מצב המסמכים</button><br>הקישור אישי לבקשה הזו. אין צורך להזין שוב פרטים.</p>`;
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
 document.querySelectorAll('[data-missing]').forEach(b=>b.onclick=()=>{openMissing=b.dataset.missing;rerender(`[data-missing-note="${CSS.escape(openMissing)}"]`);});
 document.querySelectorAll('[data-missing-cancel]').forEach(b=>b.onclick=()=>{const id=b.dataset.missingCancel;openMissing=null;rerender(`[data-missing="${CSS.escape(id)}"]`);});
 document.querySelectorAll('[data-missing-send]').forEach(b=>b.onclick=()=>answerMissing(b.dataset.missingSend,{note:$(`[data-missing-note="${CSS.escape(b.dataset.missingSend)}"]`).value},b));
 document.querySelectorAll('[data-undo-missing]').forEach(b=>b.onclick=()=>answerMissing(b.dataset.undoMissing,{undo:true},b));
}
async function answerMissing(id,data,button){button.disabled=true;setStatus(id,'שולח…');
 try{current=await call('/api/portal/unavailable',{requirement_id:id,...data});openMissing=null;render(current);setStatus(id,data.undo?'בוטל. אפשר להעלות את המסמך.':'נשלח למשרד ✓');if(current.status==='client_completed')window.scrollTo({top:0,behavior:'smooth'});}
 catch(e){button.disabled=false;setStatus(id,e.message);}}

// Sends the chosen files one by one. A file already sent leaves the draft at once, so a failure halfway only keeps the rest.
// The note travels with the first file only, so the office sees it once.
async function send(c,id,button){const r=c.requirements.find(x=>x.requirement_id===id),d=draftOf(id);if(!d.files.length)return;
 button.disabled=true;let waiting=false;
 try{while(d.files.length){const file=d.files[0],note=d.note.trim();setStatus(id,'שומר את '+file.name+'…');
   const storageKey='upload:'+[id,file.name,file.size,file.lastModified,note].join(':');let sid=sessionStorage.getItem(storageKey);if(!sid){sid=crypto.randomUUID();sessionStorage.setItem(storageKey,sid);}
   const data=new FormData();data.set('file',file);data.set('requirement_id',id);data.set('submission_id',sid);if(note)data.set('client_note',note);
   const result=await call('/api/portal/uploads',data);
   if(result.status!=='stored'){waiting=true;toast('הקובץ ממתין לאישור שמירה. אין צורך להעלות אותו שוב.');break;}
   sessionStorage.removeItem(storageKey);d.files.shift();d.note='';}
  if(!d.files.length)drafts.delete(id);else drafts.set(id,d);
  await load();setStatus(id,waiting?'ממתינים לאישור שמירה.':'נשלח למשרד ✓');if(current.status==='client_completed')window.scrollTo({top:0,behavior:'smooth'});}
 catch(error){drafts.set(id,d);if(r)render(current);setStatus(id,error.message);}}

if(!/^[a-f0-9]{64}$/.test(token))app.innerHTML='<section class="panel card"><h1>נדרש קישור אישי</h1><p>פתחו את הקישור שקיבלתם מהמשרד כדי לראות את מסמכי הבקשה.</p></section>';else load().catch(e=>{app.innerHTML=`<section class="panel card"><h1>לא ניתן לפתוח את הבקשה</h1><p>${esc(e.message)}</p><button id="retry">ניסיון נוסף</button></section>`;$('#retry').onclick=()=>location.reload();});

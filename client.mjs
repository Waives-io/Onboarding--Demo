import {$,esc,status,clientStatus,date,api} from './common.mjs';
const token=location.hash.slice(1),app=$('#app');
// The last 4 digits of the client's mobile open the link. Kept for this tab only, so a shared computer forgets them.
const PIN_KEY='pin:'+token;
const pin=()=>{try{return sessionStorage.getItem(PIN_KEY)||'';}catch{return '';}};
const call=(path,data)=>api(path,{caseToken:token,pin:pin(),...(data!==undefined?{method:'POST',data}:{})});
const MAX_BYTES=4*1024*1024,ACCEPT='.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
// A chosen file waits this long before it goes, so "ביטול" can still stop it.
const UNDO_MS=4000;
let current,openMissing=null,openNote=null;
// Files on their way, per document: {files, note, timer}. A file leaves the list once the office has it.
const sending=new Map();
// A short note to the office, typed before the next file of that document.
const notes=new Map();
// Files that did not go out yet (the office was still saving an earlier one, or the connection failed). One tap sends them.
const leftover=new Map();
async function load(){try{current=await call('/api/portal');}catch(e){if(['pin_required','wrong_pin'].includes(e.code)){pinForm(e.code==='wrong_pin'?e.message:'');return;}throw e;}render(current);}

// Four boxes, a number keypad, and the page opens by itself after the fourth digit.
function pinForm(error=''){app.innerHTML=`<section class="panel card pin-card"><h1>רק לוודא שזה את/ה</h1><p>מקישים את <strong>4 הספרות האחרונות</strong> של הנייד שמסרתם למשרד.</p><form id="pin-form" novalidate><div class="pin-boxes" dir="ltr" role="group" aria-label="4 הספרות האחרונות של הנייד">${[0,1,2,3].map(i=>`<input class="pin-box" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="${i?'off':'one-time-code'}" aria-label="ספרה ${i+1}">`).join('')}</div><p id="pin-error" class="error" role="alert" aria-live="polite">${esc(error)}</p></form></section>`;
 const boxes=[...document.querySelectorAll('.pin-box')],value=()=>boxes.map(b=>b.value).join('');
 const submit=async()=>{if(!/^\d{4}$/.test(value()))return;try{sessionStorage.setItem(PIN_KEY,value());}catch{}boxes.forEach(b=>b.disabled=true);try{await load();}catch(err){$('#pin-error').textContent=err.message;boxes.forEach(b=>{b.disabled=false;b.value='';});boxes[0].focus();}};
 const fill=(from,digits)=>{digits.split('').slice(0,4-from).forEach((d,i)=>boxes[from+i].value=d);const next=boxes.find(b=>!b.value);(next||boxes[3]).focus();submit();};
 boxes.forEach((b,i)=>{b.oninput=()=>{const d=b.value.replace(/\D/g,'');$('#pin-error').textContent='';if(d.length>1){fill(i,d);return;}b.value=d;if(d&&i<3)boxes[i+1].focus();submit();};
  b.onkeydown=e=>{if(e.key==='Backspace'&&!b.value&&i>0){boxes[i-1].value='';boxes[i-1].focus();}};
  b.onpaste=e=>{const d=(e.clipboardData?.getData('text')||'').replace(/\D/g,'');if(d){e.preventDefault();fill(0,d);}};});
 $('#pin-form').onsubmit=e=>{e.preventDefault();submit();};boxes[0].focus();}

// The office's name and logo head the page: the client knows their accountant, not the system.
api('/api/branding').then(b=>{if(b.office_name){$('#office-name').textContent=b.office_name;document.title=b.office_name+' · המסמכים שלי';}if(b.logo_version)$('.brand-mark').innerHTML=`<img src="${esc(window.PORTAL_CONFIG.api)}/api/logo?v=${Number(b.logo_version)}" alt="">`;}).catch(()=>{});
addEventListener('beforeunload',e=>{if(sending.size){e.preventDefault();e.returnValue='';}});

// How many more files a document takes. A correction replaces with exactly one file.
function room(r){const stored=r.uploads.filter(u=>u.state==='stored').length;return r.status==='correction'?1:Math.max(0,r.max_files-stored);}
const noFile=r=>r.status==='missing'&&r.unavailable_note!=null;
const pendingSave=r=>r.uploads.some(u=>u.state==='pending');
// Still to send: missing documents the client has not answered, and documents the office sent back.
const toSend=r=>r.status==='correction'||(r.status==='missing'&&!noFile(r));
function canAdd(r,locked){return !locked&&r.status!=='approved'&&!pendingSave(r)&&room(r)>0&&!sending.has(r.requirement_id);}

// The two ways in: the phone camera, or a file. Choosing sends at once (after a short undo window).
const pickers=(r,label)=>{const id=esc(r.requirement_id),many=room(r)>1&&r.status!=='correction';return `<div class="pick-buttons"><label class="pick primary-pick">${esc(label||'צילום')}<input type="file" accept="image/*" capture="environment" data-files="${id}" hidden></label><label class="pick">בחירת קובץ<input type="file" accept="${ACCEPT}" ${many?'multiple':''} data-files="${id}" hidden></label></div>`;};
const noteLine=r=>{const id=r.requirement_id;return openNote===id?`<label class="note-field">הערה למשרד, תישלח עם הקובץ<textarea data-note="${esc(id)}" maxlength="500" rows="2" placeholder="לדוגמה: התדפיס כולל גם את חודש יולי">${esc(notes.get(id)||'')}</textarea></label>`:`<button type="button" class="text-button small" data-open-note="${esc(id)}">${notes.get(id)?'הערה למשרד ✓':'＋ הערה למשרד'}</button>`;};

function todoRow(r,locked){const id=r.requirement_id,s=sending.get(id),fix=r.status==='correction';
 return `<li class="doc-item todo${fix?' fix':''}" id="req-${esc(id)}">
<div class="doc-line"><strong>${esc(r.name)}</strong></div>
${fix&&r.correction_message?`<p class="fix-note"><strong>הערה מהמשרד:</strong> ${esc(r.correction_message)}</p>`:''}
${!s&&leftover.get(id)?.length&&!pendingSave(r)?`<p class="sending-line" role="status">עוד ${leftover.get(id).length===1?'קובץ אחד לא נשלח':leftover.get(id).length+' קבצים לא נשלחו'}: ${esc(leftover.get(id).map(f=>f.name).join(', '))} <button type="button" class="text-button" data-resume="${esc(id)}">שליחה</button></p>`:''}${s?`<p class="sending-line" role="status">${s.timer?'נשלח':'שולח'}: ${esc(s.files.map(f=>f.name).join(', '))}${s.timer?` <button type="button" class="text-button" data-cancel="${esc(id)}">ביטול</button>`:'…'}</p>`
 :pendingSave(r)?'<p class="sending-line">הקובץ נשמר אצל המשרד. אין צורך לשלוח שוב.</p>'
 :canAdd(r,locked)?pickers(r,fix?'צילום הקובץ המתוקן':'צילום')+noteLine(r):''}
${!locked&&!fix&&r.required&&!s&&!pendingSave(r)?(openMissing===id?`<form class="missing-form" data-missing-form="${esc(id)}" novalidate><label>למה אין לך את המסמך?<textarea data-missing-note="${esc(id)}" maxlength="500" rows="2" required placeholder="לדוגמה: לא עבדתי השנה כשכיר"></textarea></label><p class="error" id="missing-error-${esc(id)}" aria-live="polite"></p><div class="doc-actions"><button class="primary">שליחת ההסבר למשרד</button><button type="button" data-missing-cancel="${esc(id)}">ביטול</button></div></form>`:`<button type="button" class="text-button small" data-missing="${esc(id)}">אין לי את המסמך הזה</button>`):''}
<p class="upload-status" role="status" id="status-${esc(id)}"></p></li>`;}

function doneRow(r,locked){const id=r.requirement_id,files=r.uploads.filter(u=>u.state==='stored');
 return `<li class="doc-item done" id="req-${esc(id)}"><div class="doc-line"><strong><span aria-hidden="true">✓</span> ${esc(r.name)}</strong><small>${noFile(r)?'סימנת שאין לך':esc(clientStatus[r.status]||status[r.status])}</small></div>
${noFile(r)?`<p class="muted">${esc(r.unavailable_note||'')}</p>${locked?'':`<button type="button" class="text-button small" data-undo-missing="${esc(id)}">ביטול: יש לי את המסמך</button>`}`:`<p class="muted files">${files.map(u=>esc(u.filename)).join(' · ')}</p>`}
${leftover.get(id)?.length&&!pendingSave(r)?`<p class="sending-line" role="status">עוד ${leftover.get(id).length===1?'קובץ אחד לא נשלח':leftover.get(id).length+' קבצים לא נשלחו'}: ${esc(leftover.get(id).map(f=>f.name).join(', '))} <button type="button" class="text-button" data-resume="${esc(id)}">שליחה</button></p>`:''}${!noFile(r)&&canAdd(r,locked)?`<details class="more-files"><summary>＋ עוד קובץ</summary>${pickers(r)}</details>`:''}
<p class="upload-status" role="status" id="status-${esc(id)}"></p></li>`;}

function render(c){if(c.closed){app.innerHTML=`<section class="panel card"><h1>${esc(c.name)}</h1><p>התיק הושלם, ולכן המסמכים לא מוצגים כאן. לשאלות אפשר לפנות למשרד.</p></section>`;return;}
 const locked=['closed','archived'].includes(c.status),reqs=c.requirements;
 // Required and optional apart. Each document keeps its place: sending turns it green right there, it never jumps away.
 const must=reqs.filter(r=>r.required),extra=reqs.filter(r=>!r.required),row=r=>toSend(r)?todoRow(r,locked):doneRow(r,locked);
 const finished=c.status==='client_completed'||c.status==='ready_for_work',extraLeft=extra.some(toSend);
 const group=(title,list,hint)=>list.length?`<section class="doc-group"><h2>${title} <span class="count">נשלחו ${list.length-list.filter(toSend).length} מתוך ${list.length}</span></h2>${hint?`<p class="muted group-hint">${hint}</p>`:''}<ul class="doc-list">${list.map(row).join('')}</ul></section>`:'';
 app.innerHTML=`<section class="client-head"><span class="eyebrow">שלום ${esc(c.contact_name||c.client_name)}</span><h1>${esc(c.name)}</h1>${c.due_date&&!finished?`<p class="muted">הגשת מסמכים עד ${date(c.due_date)}</p>`:''}<p class="muted come-back">אפשר לחזור לדף הזה בכל זמן מהכפתור "להעלאת המסמכים" במייל ששלחנו לך.</p></section>
${finished?`<section class="success done-state" role="status"><span class="completion-tick" aria-hidden="true">✓</span><h2>${c.status==='ready_for_work'?'המשרד אישר את כל מסמכי החובה. תודה!':'קיבלנו את כל מסמכי החובה. תודה!'}</h2>${c.status==='ready_for_work'?'':'<p>המשרד יעבור עליהם ויחזור אליך אם משהו חסר.</p>'}${extraLeft?'<p>אפשר עדיין לשלוח מסמכים מהרשימה "לפי הצורך", אם הם רלוונטיים לך.</p>':''}</section>`:''}
${group('מסמכי חובה',must)}
${group('מסמכים לפי הצורך',extra,'רק אם זה רלוונטי לך. אפשר לשלוח גם אחרי שהמשרד אישר את מסמכי החובה.')}`;
 bind(c);}

function setStatus(rid,text){const p=$('#status-'+CSS.escape(rid));if(p)p.textContent=text;}
function rerender(focus){render(current);if(focus)document.querySelector(focus)?.focus();}

function bind(c){
 document.querySelectorAll('[data-files]').forEach(input=>input.onchange=()=>{const id=input.dataset.files,r=c.requirements.find(x=>x.requirement_id===id),picked=[...input.files];input.value='';if(!picked.length)return;
  const tooBig=picked.find(f=>f.size>MAX_BYTES);if(tooBig){setStatus(id,`הקובץ ${tooBig.name} גדול מ־4MB. אפשר לצלם שוב או לבחור קובץ קטן יותר.`);return;}
  if(picked.length>room(r)){setStatus(id,room(r)===1?'אפשר לשלוח כאן קובץ אחד.':`אפשר לשלוח כאן עוד ${room(r)} קבצים.`);return;}
  const s={files:picked,note:(notes.get(id)||'').trim(),timer:null};s.timer=setTimeout(()=>{s.timer=null;send(id);},UNDO_MS);sending.set(id,s);openNote=null;rerender(`[data-cancel="${CSS.escape(id)}"]`);});
 document.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>{const id=b.dataset.cancel,s=sending.get(id);if(s?.timer){clearTimeout(s.timer);sending.delete(id);rerender();setStatus(id,'בוטל. הקובץ לא נשלח.');}});
 document.querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>{const id=b.dataset.resume,files=leftover.get(id)||[];leftover.delete(id);if(files.length){sending.set(id,{files,note:(notes.get(id)||'').trim(),timer:null});send(id);}});
 document.querySelectorAll('[data-open-note]').forEach(b=>b.onclick=()=>{openNote=b.dataset.openNote;rerender(`[data-note="${CSS.escape(openNote)}"]`);});
 document.querySelectorAll('[data-note]').forEach(t=>t.oninput=()=>notes.set(t.dataset.note,t.value));
 document.querySelectorAll('[data-missing]').forEach(b=>b.onclick=()=>{openMissing=b.dataset.missing;rerender(`[data-missing-note="${CSS.escape(openMissing)}"]`);});
 document.querySelectorAll('[data-missing-cancel]').forEach(b=>b.onclick=()=>{const id=b.dataset.missingCancel;openMissing=null;rerender(`[data-missing="${CSS.escape(id)}"]`);});
 document.querySelectorAll('[data-missing-form]').forEach(f=>f.onsubmit=e=>{e.preventDefault();const id=f.dataset.missingForm,t=f.querySelector('textarea'),err=$('#missing-error-'+CSS.escape(id));
  if(t.value.trim().length<2){err.textContent='כתבו בכמה מילים למה אין לכם את המסמך, כדי שהמשרד יוכל להחליט מה לעשות.';t.focus();return;}err.textContent='';answerMissing(id,{note:t.value},e.submitter);});
 document.querySelectorAll('[data-undo-missing]').forEach(b=>b.onclick=()=>answerMissing(b.dataset.undoMissing,{undo:true},b));
}
async function answerMissing(id,data,button){button.disabled=true;setStatus(id,'שולח…');
 try{current=await call('/api/portal/unavailable',{requirement_id:id,...data});openMissing=null;render(current);setStatus(id,data.undo?'בוטל. אפשר לשלוח את המסמך.':'ההסבר נשלח למשרד ✓');if(current.status==='client_completed')window.scrollTo({top:0,behavior:'smooth'});}
 catch(e){button.disabled=false;setStatus(id,e.message);}}

// Sends the chosen files one by one. A retry of the same file reuses its submission id, so it is never stored twice.
// The note travels with the first file only, so the office sees it once.
async function send(id){const s=sending.get(id);if(!s)return;rerender();let waiting=false,failed='';
 try{while(s.files.length){const file=s.files[0],note=s.note;
   const storageKey='upload:'+[id,file.name,file.size,file.lastModified,note].join(':');let sid=sessionStorage.getItem(storageKey);if(!sid){sid=crypto.randomUUID();sessionStorage.setItem(storageKey,sid);}
   const data=new FormData();data.set('file',file);data.set('requirement_id',id);data.set('submission_id',sid);if(note)data.set('client_note',note);
   const result=await call('/api/portal/uploads',data);
   if(result.status!=='stored'){waiting=true;s.files.shift();break;}
   sessionStorage.removeItem(storageKey);s.files.shift();s.note='';notes.delete(id);}}
 catch(e){failed=e.message;}
 sending.delete(id);if(s.files.length)leftover.set(id,s.files);
 try{current=await call('/api/portal');}catch{}
 render(current);setStatus(id,failed?failed+' אפשר לנסות שוב.':waiting?'הקובץ נשמר אצל המשרד. אין צורך לשלוח אותו שוב.':'נשלח למשרד ✓');
 if(!failed&&current.status==='client_completed')window.scrollTo({top:0,behavior:'smooth'});}

// A short link (#Ab3xK9Qz1a) asks the worker for the full token once, then the page opens as usual.
if(/^[A-Za-z0-9]{10}$/.test(token))api('/api/short/'+token).then(r=>{location.replace(location.pathname+'#'+r.token);location.reload();}).catch(()=>{app.innerHTML='<section class="panel card"><h1>הקישור לא פעיל</h1><p>אפשר לבקש מהמשרד קישור חדש.</p></section>';});
else if(!/^[a-f0-9]{64}$/.test(token))app.innerHTML='<section class="panel card"><h1>נדרש קישור אישי</h1><p>פתחו את הקישור שקיבלתם מהמשרד כדי לראות את מסמכי התיק.</p></section>';else load().catch(e=>{app.innerHTML=`<section class="panel card"><h1>לא ניתן לפתוח את התיק</h1><p>${esc(e.message)}</p><button id="retry">ניסיון נוסף</button></section>`;$('#retry').onclick=()=>location.reload();});

(() => {
  'use strict';
  const form=document.querySelector('#upload-form'),files=document.querySelector('#files'),button=document.querySelector('#submit'),fields=document.querySelector('#fields'),result=document.querySelector('#result'),connection=document.querySelector('#connection');
  const config=window.MATERIAL_READY_UPLOAD||{};
  let validEndpoint=false;
  try {const u=new URL(config.intakeUrl);validEndpoint=u.protocol==='https:'&&u.hostname.endsWith('.workers.dev')&&u.pathname==='/api/intake'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{}
  const enabled=config.enabled===true&&validEndpoint;
  if(enabled){button.disabled=false;connection.textContent='פיילוט מחובר. שלחו קובצי בדיקה בלבד.';connection.classList.add('connected');}
  const previous=new Date();previous.setMonth(previous.getMonth()-1);form.elements.period.value=previous.getFullYear()+'-'+String(previous.getMonth()+1).padStart(2,'0');
  let pending=null,busy=false;
  function show(title,text,kind=''){result.replaceChildren();const h=document.createElement('h2'),p=document.createElement('p');h.textContent=title;p.textContent=text;result.append(h,p);result.className='result '+kind;result.hidden=false;result.focus();}
  files.addEventListener('change',()=>{const list=document.querySelector('#file-list');list.replaceChildren();for(const f of files.files){const li=document.createElement('li');li.textContent=f.name+' · '+(f.size/1024/1024).toFixed(2)+' MB';list.append(li);}});
  function validate(){if(!form.reportValidity())return false;const chosen=Array.from(files.files);if(chosen.length!==1||!chosen[0].size||chosen[0].size>4*1024*1024||!(/\.(pdf|jpe?g|png)$/i.test(chosen[0].name))){show('יש לבדוק את הקובץ','יש לצרף קובץ PDF, JPG או PNG אחד שאינו ריק, עד 4MB.','error');return false;}return true;}
  function snapshot(){const data=new FormData();const id=crypto.randomUUID();for(const name of ['full_name','email','client_reference','period','document_type','note'])data.append(name,form.elements[name].value.trim());data.append('schema_version','1');data.append('submission_id',id);data.append('submitted_at',new Date().toISOString());data.append('requirement_complete',String(form.elements.requirement_complete.checked));data.append('test_mode','true');data.append('file_count','1');data.append('file_1',files.files[0],files.files[0].name);return {id,data,inviteCode:form.elements.invite_code.value.trim()};}
  async function send(){if(busy||!pending||!enabled)return;busy=true;button.disabled=true;fields.disabled=true;result.hidden=true;button.textContent='שולחים את החומרים…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try {const response=await fetch(config.intakeUrl,{method:'POST',body:pending.data,headers:{'X-Invite-Code':pending.inviteCode},signal:controller.signal,credentials:'omit',redirect:'error'});const raw=await response.text();let receipt;try{receipt=JSON.parse(raw);}catch{}
      if(response.ok&&receipt?.status==='stored'&&receipt.submission_id===pending.id){show('הקבצים נשמרו בהצלחה','מספר אישור: '+pending.id+'. החומר ממתין לבדיקת המשרד.');button.textContent='החומרים נשלחו';pending=null;}
      else if(response.ok){show('הבקשה התקבלה לעיבוד','עדיין אין אישור שהקובץ נשמר. מספר הבקשה: '+pending.id+'. בדקו עם המשרד לפני שליחה נוספת.','warning');button.textContent='ממתינים לאישור המשרד';}
      else if(response.status===403&&receipt?.error==='invalid_invite'){show('קוד הגישה שגוי','בדקו את הקוד ונסו שוב. לא נשלח קובץ.','error');pending=null;fields.disabled=false;button.disabled=false;button.textContent='שליחת החומרים';form.elements.invite_code.focus();}
      else if([400,413,415].includes(response.status)){show('יש לבדוק את הטופס','אחד הפרטים או הקובץ לא התקבלו. בדקו את השדות ונסו שוב.','error');pending=null;fields.disabled=false;button.disabled=false;button.textContent='שליחת החומרים';}
      else {show('לא ניתן לאשר שהשליחה הושלמה','מספר הבקשה: '+pending.id+'. בדקו עם המשרד לפני שליחה נוספת.','warning');button.textContent='נדרשת בדיקת קליטה';}
    }catch{show('לא ניתן לוודא שהשליחה הושלמה','ייתכן שהבקשה כבר הגיעה למשרד. מספר הבקשה: '+pending.id+'. בדקו עם המשרד לפני שליחה נוספת.','warning');button.textContent='נדרשת בדיקת קליטה';}
    finally{clearTimeout(timer);busy=false;}
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(!enabled){show('הטופס עדיין לא מחובר','לא נשלחו קבצים. אנחנו משלימים את חיבור Make.','warning');return;}if(busy||pending||!validate())return;pending=snapshot();send();});
})();

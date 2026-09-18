(() => {
  'use strict';
  const form=document.querySelector('#upload-form'),files=document.querySelector('#files'),button=document.querySelector('#submit'),fields=document.querySelector('#fields'),result=document.querySelector('#result'),connection=document.querySelector('#connection');
  const config=window.MATERIAL_READY_UPLOAD||{};
  let validEndpoint=false;
  try {const u=new URL(config.webhookUrl);validEndpoint=u.protocol==='https:'&&/^hook(?:\.[a-z0-9-]+)?\.make\.com$/.test(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.length>1;}catch{}
  const enabled=config.enabled===true&&validEndpoint;
  if(enabled){button.disabled=false;connection.textContent='פיילוט מחובר ל־Make. שלחו מסמכי בדיקה בלבד.';connection.classList.add('connected');}
  const previous=new Date();previous.setMonth(previous.getMonth()-1);form.elements.period.value=previous.getFullYear()+'-'+String(previous.getMonth()+1).padStart(2,'0');
  let pending=null,busy=false;
  function show(title,text,kind=''){result.replaceChildren();const h=document.createElement('h2'),p=document.createElement('p');h.textContent=title;p.textContent=text;result.append(h,p);result.className='result '+kind;result.hidden=false;result.focus();}
  files.addEventListener('change',()=>{const list=document.querySelector('#file-list');list.replaceChildren();for(const f of files.files){const li=document.createElement('li');li.textContent=f.name+' · '+(f.size/1024/1024).toFixed(2)+' MB';list.append(li);}});
  function validate(){if(!form.reportValidity())return false;const chosen=Array.from(files.files);if(chosen.length>5||chosen.some(f=>!f.size||!(/\.(pdf|jpe?g|png)$/i.test(f.name)))||chosen.reduce((s,f)=>s+f.size,0)>4*1024*1024){show('יש לבדוק את הקבצים','אפשר לצרף עד 5 קובצי PDF, JPG או PNG שאינם ריקים, בגודל כולל של עד 4MB.','error');return false;}return true;}
  function snapshot(){const data=new FormData();const id=crypto.randomUUID();for(const name of ['full_name','email','client_reference','period','document_type','note'])data.append(name,form.elements[name].value.trim());data.append('schema_version','1');data.append('submission_id',id);data.append('submitted_at',new Date().toISOString());data.append('requirement_complete',String(form.elements.requirement_complete.checked));data.append('test_mode','true');data.append('file_count',String(files.files.length));Array.from(files.files).forEach((file,i)=>data.append('file_'+(i+1),file,file.name));return {id,data};}
  function retry(){const retryButton=document.createElement('button');retryButton.type='button';retryButton.textContent='בדיקה ושליחה חוזרת של אותה בקשה';retryButton.onclick=()=>send();result.append(retryButton);}
  async function send(){if(busy||!pending||!enabled)return;busy=true;button.disabled=true;fields.disabled=true;result.hidden=true;button.textContent='שולחים את החומרים…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try {const response=await fetch(config.webhookUrl,{method:'POST',body:pending.data,signal:controller.signal,credentials:'omit',redirect:'error'});const raw=await response.text();let receipt;try{receipt=JSON.parse(raw);}catch{}
      if(response.ok&&receipt?.status==='stored'&&receipt.submission_id===pending.id){show('הקבצים נשמרו בהצלחה','מספר אישור: '+pending.id+'. החומר ממתין לבדיקת המשרד.');button.textContent='החומרים נשלחו';pending=null;}
      else if(response.ok){show('הבקשה התקבלה לעיבוד','עדיין אין אישור שהקבצים נשמרו. מספר הבקשה: '+pending.id+'. אין צורך לשלוח שוב לפני בדיקת המשרד.','warning');button.textContent='ממתינים לאישור המשרד';}
      else {show('לא התקבל אישור שמירה','מספר הבקשה: '+pending.id+'. המשרד יכול לבדוק אותה לפני ניסיון נוסף. קוד תשובה: '+response.status+'.','error');retry();button.textContent='לא התקבל אישור';}
    }catch{show('לא ניתן לוודא שהשליחה הושלמה','ייתכן שהבקשה כבר הגיעה למשרד. מספר הבקשה: '+pending.id+'. בדקו עם המשרד לפני ניסיון נוסף; ניסיון חוזר ישתמש באותו מזהה.','warning');retry();button.textContent='נדרשת בדיקת קליטה';}
    finally{clearTimeout(timer);busy=false;}
  }
  form.addEventListener('submit',event=>{event.preventDefault();if(!enabled){show('הטופס עדיין לא מחובר','לא נשלחו קבצים. אנחנו משלימים את חיבור Make.','warning');return;}if(busy||pending||!validate())return;pending=snapshot();send();});
})();

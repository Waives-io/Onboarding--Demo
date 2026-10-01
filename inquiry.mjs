import {$,esc,api} from './common.mjs';
// The public landing page. A visitor leaves their details and what they need; the office opens a case from it.
api('/api/branding').then(b=>{if(b.office_name)$('#office-name').textContent=b.office_name;if(b.logo_version)$('.brand-mark').innerHTML=`<img src="${esc(window.PORTAL_CONFIG.api)}/api/logo?v=${Number(b.logo_version)}" alt="">`;}).catch(()=>{});
const form=$('#inquiry');
// Israeli mobile: spaces, dashes and brackets are ignored; +972, 00972 and 972 become 0.
const mobile=v=>{const d=String(v).replace(/[\s\-()]/g,'').replace(/^(\+972|00972|972)/,'0');return /^05\d{8}$/.test(d)?d.slice(0,3)+'-'+d.slice(3):null;};
const TYPOS={'gmial.com':'gmail.com','gmal.com':'gmail.com','gamil.com':'gmail.com','gmail.co':'gmail.com','gmail.co.il':'gmail.com','walla.com':'walla.co.il','wala.co.il':'walla.co.il','hotmial.com':'hotmail.com','hotmail.co':'hotmail.com','yahho.com':'yahoo.com'};
const checks={
 contact_name:v=>v.trim()?'':'צריך למלא שם מלא.',
 phone:v=>!v.trim()?'צריך למלא מספר נייד.':mobile(v)?'':'מספר נייד צריך להכיל 10 ספרות ולהתחיל ב־05.',
 email:v=>{const e=v.trim().toLowerCase();return !e?'צריך למלא דוא״ל.':/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?'':'כתובת הדוא״ל לא נראית תקינה. לדוגמה: name@gmail.com';},
 need:()=>form.querySelector('[name=need]:checked')?'':'צריך לבחור במה צריך עזרה.',
 consent:()=>form.elements.consent.checked?'':'כדי שנחזור אליך צריך לסמן את האישור.'};
const show=(name,msg)=>{const el=$('#err-'+name);if(el)el.textContent=msg;const input=form.elements[name];if(input&&input.setAttribute)input.setAttribute('aria-invalid',msg?'true':'false');return !msg;};
// Validate when leaving a field. Once a field shows an error, check it on every keystroke so the error clears as soon as it is fixed.
const touched=new Set();
for(const name of ['contact_name','phone','email']){const input=form.elements[name];
 input.addEventListener('blur',()=>{touched.add(name);show(name,checks[name](input.value));if(name==='email')typo();});
 input.addEventListener('input',()=>{if(touched.has(name))show(name,checks[name](input.value));});}
form.querySelectorAll('[name=need]').forEach(r=>r.addEventListener('change',()=>show('need','')));
form.elements.consent.addEventListener('change',()=>show('consent',checks.consent()));
// A likely typo in the email domain is offered as a tap-to-fix hint. It is never changed by itself.
function typo(){const input=form.elements.email,e=input.value.trim().toLowerCase(),[user,domain]=e.split('@'),fix=TYPOS[domain];
 if(!fix||checks.email(e))return;const el=$('#err-email');el.innerHTML=`התכוונת ל־<button type="button" class="hint-fix" dir="ltr">${esc(user+'@'+fix)}</button>?`;
 el.querySelector('button').onclick=()=>{input.value=user+'@'+fix;el.textContent='';input.focus();};}
const params=new URLSearchParams(location.search);
form.onsubmit=async e=>{e.preventDefault();$('#form-error').textContent='';
 const results=Object.keys(checks).map(n=>[n,show(n,checks[n](form.elements[n]?.value??''))]);
 const first=results.find(([,ok])=>!ok);
 if(first){const target=first[0]==='need'?form.querySelector('[name=need]'):form.elements[first[0]];target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});return;}
 const f=form.elements,b=$('#submit');b.disabled=true;b.textContent='שולח…';
 const data={contact_name:f.contact_name.value.trim(),name:f.business.value.trim()||f.contact_name.value.trim(),business_number:f.business_number.value.trim(),phone:mobile(f.phone.value),email:f.email.value.trim().toLowerCase(),
  need:form.querySelector('[name=need]:checked').value,note:f.note.value.trim(),consent:true,website:f.website.value,source:(params.get('source')||'דף נחיתה').slice(0,60),timestamp:new Date().toISOString()};
 try{await api('/api/inquiries',{method:'POST',data});
  $('#app').innerHTML=`<section class="welcome done-state" role="status"><span class="badge green">הפרטים נשלחו</span><h1>תודה, ${esc(data.contact_name)}!</h1><p>הפנייה הגיעה למשרד.</p><h2>מה קורה עכשיו</h2><ol class="landing-steps"><li>המשרד בודק את הפנייה ומכין את רשימת המסמכים שצריך.</li><li>יגיע אליך קישור אישי ב־WhatsApp או בדוא״ל.</li><li>בכניסה לקישור מקישים את 4 הספרות האחרונות של הנייד <bdi dir="ltr">${esc(data.phone)}</bdi>, ומעלים את המסמכים.</li></ol></section>`;
  window.scrollTo({top:0,behavior:'smooth'});}
 catch(err){$('#form-error').textContent=err.message+' הפרטים שמילאת נשמרו בטופס, אפשר לנסות שוב.';b.disabled=false;b.textContent='שליחת הפרטים למשרד';}};

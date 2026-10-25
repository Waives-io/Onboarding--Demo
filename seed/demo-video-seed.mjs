// Demo mode data for the product video: one fictional office and 7 cases in mixed statuses.
// Runs against a fresh local worker (DEMO_MODE, demo bridge). Every name, number and file is made up.
// Usage: node seed/demo-video-seed.mjs http://127.0.0.1:8787 <office code from the local vars>
import {readFile} from 'node:fs/promises';
const [api='http://127.0.0.1:8787',code]=process.argv.slice(2);
if(!code)throw new Error('office code missing');
// Only ever a worker on this machine, never a deployed one.
if(!['127.0.0.1','localhost'].includes(new URL(api).hostname))throw new Error('demo seed runs only against a local worker');
const health=await (await fetch(api+'/api/demo-check')).json().catch(()=>({}));
if(!health.demo)throw new Error('the worker is not in demo mode with the local bridge');
const pdf=await readFile(new URL('../test/fixtures/bank.pdf',import.meta.url));
let token='';
async function call(path,data,headers={}){const r=await fetch(api+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data instanceof FormData||data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data instanceof FormData||data===undefined?data:JSON.stringify(data)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(path+' '+r.status+' '+JSON.stringify(j));return j;}
const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};

token=(await call('/api/setup',{code,name:'אורית כהן',email:'orit@cohen-cpa.example.com',password:'demo-video-only-1'})).token;
await call('/api/settings',{office_name:'משרד כהן רואי חשבון',manager_name:'אורית כהן',phone:'03-0000000',email:'office@cohen-cpa.example.com',address:'',warning_days:7,urgent_days:2,due_days:14});
// The tax refund case type the video opens: three documents, all required, asked per year.
await call('/api/templates',{template_id:'ct-refund',name:'החזר מס',period_kind:'year',items:[{name:'טופס 106',required:true,max_files:1},{name:'אישור הפקדות לפנסיה',required:true,max_files:1},{name:'אישור ניהול חשבון',required:true,max_files:1}]});

const year={period_start:'2025-01-01',period_end:'2025-12-31'},month=m=>({period_start:`2026-${m}-01`,period_end:`2026-${m}-${m==='09'?30:31}`});
const cases=[
 {client:{name:'נגריית עץ הזית בע״מ',business_number:'514839201',contact_name:'משה אלון',email:'office@olive-wood.example.com',phone:'050-0000101'},type:'ct-annual-company',label:'דוח שנתי – חברה בע״מ 2025',period:year,due:-5,upload:1},
 {client:{name:'מסעדת הגפן',business_number:'515002331',contact_name:'שירה גפן',email:'hagefen@example.com',phone:'050-0000102'},type:'ct-vat-period',label:'דיווח תקופתי למע״מ ⁦09/2026⁩',period:month('09'),due:3,upload:'all'},
 {client:{name:'רונית כהן – עיצוב פנים',business_number:'032145678',email:'ronit.design@example.com',phone:'050-0000103'},type:'ct-annual-selfemployed',label:'דוח שנתי – עצמאי 2025',period:year,due:9,upload:'all',correction:'הקובץ חתוך. אפשר לשלוח שוב את כל העמודים?'},
 {client:{name:'סטודיו תנועה – מיכל ברק',business_number:'039988776',email:'studio.move@example.com',phone:'050-0000104'},type:'ct-vat-period',label:'דיווח תקופתי למע״מ ⁦08/2026⁩',period:month('08'),due:-12,upload:'all',approve:true},
 {client:{name:'ד״ר אבי לוי – מרפאת שיניים',business_number:'028877665',email:'clinic.levi@example.com',phone:'050-0000105'},type:'ct-annual-selfemployed',label:'דוח שנתי – עצמאי 2025',period:year,due:12,upload:0},
 {client:{name:'אלקטרו-גל שירותי חשמל',business_number:'516677889',contact_name:'גל שמש',email:'electro-gal@example.com',phone:'050-0000106'},type:'ct-annual-company',label:'דוח שנתי – חברה בע״מ 2025',period:year,due:2,upload:2},
 {client:{name:'יוסי מזרחי',business_number:'000000018',email:'yossi.m@example.com',phone:'050-0000107'},type:'ct-refund',label:'החזר מס 2025',period:year,due:6,upload:0},
];
for(const c of cases){
 const {client_id}=await call('/api/clients',{...c.client,regular_template_id:c.type});
 const {case_id,link}=await call('/api/cases',{client_id,name:c.label,type:c.label.replace(/ [\d⁦].*$/,''),template_id:c.type,...c.period,due_date:day(c.due)});
 const portal={'X-Case-Token':link.split('#')[1],'X-Case-Pin':c.client.phone.slice(-4)};
 const view=await call('/api/portal',undefined,portal),req=view.requirements.filter(r=>r.required);
 const send=c.upload==='all'?req:req.slice(0,c.upload);
 for(const r of send){const f=new FormData();f.set('requirement_id',r.requirement_id);f.set('submission_id',crypto.randomUUID());f.set('file',new Blob([pdf],{type:'application/pdf'}),r.name+'.pdf');await call('/api/portal/uploads',f,portal);}
 if(c.correction)await call(`/api/cases/${case_id}/review`,{requirement_id:send[0].requirement_id,status:'correction',message:c.correction});
 if(c.approve)for(const r of send)await call(`/api/cases/${case_id}/review`,{requirement_id:r.requirement_id,status:'approved'});
 console.log('seeded',c.client.name);
}

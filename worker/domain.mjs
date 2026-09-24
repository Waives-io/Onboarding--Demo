export class HttpError extends Error { constructor(status, code) { super(code); this.status = status; } }
export function requireThat(condition, code = 'invalid_fields', status = 400) { if (!condition) throw new HttpError(status, code); }
export function clean(value, max = 200, required = false) {
 requireThat(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
 const result = value.trim(); requireThat(!required || result.length > 0); return result;
}
export async function hash(value) {
 const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2,'0')).join('');
}
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join(''); }
// A random case UUID and a secret HMAC key make a reproducible, unguessable per-case capability.
// Only its SHA-256 hash is persisted. Rotating PORTAL_LINK_KEY invalidates links; do not rotate routinely.
export async function caseToken(caseId, secret) {
 requireThat(typeof secret === 'string' && secret.length >= 32, 'not_configured', 503);
 const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(caseId))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function validateFile(file) {
 requireThat(file instanceof File && file.size >= 8 && file.size <= 4*1024*1024, 'invalid_file');
 const ext = file.name.split('.').pop().toLowerCase();
 const mime = {pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'}[ext];
 requireThat(mime && (!file.type || file.type === mime), 'invalid_file_type');
 const bytes = new Uint8Array(await file.arrayBuffer());
 const valid = ext === 'pdf' ? String.fromCharCode(...bytes.slice(0,5)) === '%PDF-' : ext === 'png' ? [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n) : bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
 requireThat(valid, 'invalid_file_signature');
 const filename = file.name.normalize('NFKC').replace(/[\\/<>:"|?*\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,'_').slice(-160);
 return {filename,mime,size:file.size,contentHash:await hash(bytes)};
}
export function deriveStatus(requirements, completed, current = 'collecting') {
 if (['closed','archived'].includes(current)) return current;
 if (requirements.some(r=>r.status === 'correction')) return 'action_required';
 // Optional requirements can remain missing. Once uploaded they must also be reviewed.
 if (requirements.length && requirements.every(r=>r.status==='approved' || (!r.required && r.status==='missing'))) return 'ready_for_work';
 if (completed && requirements.every(r=>!r.required || ['uploaded','approved'].includes(r.status))) return 'client_completed';
 return 'collecting';
}
export function parseCSV(text) {
 requireThat(typeof text==='string' && text.length<=1000000,'invalid_csv');
 const rows=[]; let row=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){ const c=text[i]; if(c==='"'){if(quote && text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(c===','&&!quote){row.push(cell);cell='';}else if(c==='\n'&&!quote){row.push(cell.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c; }
 requireThat(!quote,'invalid_csv'); row.push(cell.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);
 requireThat(rows.length>=2 && rows.length<=501,'invalid_csv'); const headers=rows.shift().map(x=>x.replace(/^\uFEFF/,''));
 requireThat(new Set(headers).size===headers.length,'invalid_csv');
 return rows.map(values=>{requireThat(values.length===headers.length,'invalid_csv');return Object.fromEntries(headers.map((h,i)=>[h,values[i]]));});
}
export function toCSV(rows, keys) { return '\uFEFF'+[keys,...rows.map(r=>keys.map(k=>r[k]??''))].map(row=>row.map(v=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n'); }

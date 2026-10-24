// Demo mode stand-in for the Make bridge. Answers like Make would, but nothing leaves this machine:
// no Google Drive, no Google Sheets, no email, no WhatsApp. Start it, then run the worker with
// LOCAL_BRIDGE_URL=http://127.0.0.1:8790 (the worker accepts a local bridge only on http://127.0.0.1 or localhost).
import {createServer} from 'node:http';
const port=Number(process.argv[2]||8790),id=()=>'demo'+crypto.randomUUID().replace(/-/g,'').slice(0,20);
createServer(async(req,res)=>{
 let form;try{form=await new Request('http://x',{method:'POST',headers:req.headers,body:req,duplex:'half'}).formData();}catch{res.writeHead(400).end();return;}
 const action=form.get('action'),send=body=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(body));
 if(action==='upload_document'||action==='upload_document_revision')return send({status:'stored',submission_id:form.get('submission_id'),drive_file_id:id(),drive_folder_id:form.get('requirement_folder_id')||id(),sheet_updated:true});
 if(action==='send_email')return send({status:'sent',send_id:form.get('send_id')});
 send({status:'not_found',submission_id:form.get('submission_id')});
}).listen(port,'127.0.0.1',()=>console.log('demo bridge on http://127.0.0.1:'+port));

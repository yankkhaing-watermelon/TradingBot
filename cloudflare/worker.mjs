const MAX=900000;
const encoder=new TextEncoder();
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const configured=e=>Boolean(e.GMAIL_CLIENT_ID&&e.GMAIL_CLIENT_SECRET&&e.GMAIL_REFRESH_TOKEN);
function string(v,n){if(typeof v!=='string'||!v.trim()||v.length>30000)throw Error('Invalid '+n);return v.trim();}
function lines(v,n){if(v==null)return [];if(typeof v==='string')return v.trim()?[string(v,n)]:[];if(!Array.isArray(v)||v.length>200)throw Error('Invalid '+n);return v.map(x=>string(x,n));}
function stamp(v,n){string(v,n);if(!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Timezone timestamp required: '+n);return v;}
export function validate(raw){
 if(encoder.encode(raw).length>MAX)throw Error('Cloudflare import limit is 900 KB');
 const r=JSON.parse(raw);if(!r||r.schema_version!=='1.0'||r.market!=='BURSA')throw Error('Expected BURSA schema 1.0');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(r.report_date)||!Number.isFinite(Date.parse(r.report_date))||new Date(r.report_date).toISOString().slice(0,10)!==r.report_date)throw Error('Invalid report date');
 for(const k of ['generated_at','coverage_start','coverage_end'])stamp(r[k],k);
 if(Date.parse(r.coverage_start)>Date.parse(r.coverage_end))throw Error('Invalid coverage interval');
 if(!Array.isArray(r.items)||r.items.length>500)throw Error('Expected up to 500 items');
 const ids=new Set();const items=r.items.map(i=>{
  const id=string(i.id,'id');if(ids.has(id))throw Error('Duplicate ID in report');ids.add(id);
  if(!Array.isArray(i.stock_codes)||i.stock_codes.some(c=>typeof c!=='string'||!/^\d{4,6}$/.test(c)))throw Error('Stock codes must be 4–6 digit strings');
  if(!Array.isArray(i.sources)||!i.sources.length||i.sources.length>50)throw Error('Sources required');
  const sources=i.sources.map(s=>{const url=new URL(s.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid source URL');return {url:url.href,title:string(s.title,'source title'),published_at:s.published_at==null?null:string(s.published_at,'publication date')};});
  return {id,stock_codes:[...new Set(i.stock_codes)].sort(),company_names:lines(i.company_names,'company_names'),category:string(i.category,'category'),headline:string(i.headline,'headline'),...Object.fromEntries(['facts','analysis','catalysts','risks','bull_case','bear_case'].map(k=>[k,lines(i[k],k)])),sources,verification_status:string(i.verification_status,'verification_status')};
 });
 return {schema_version:'1.0',market:'BURSA',report_date:r.report_date,generated_at:r.generated_at,coverage_start:r.coverage_start,coverage_end:r.coverage_end,summary:lines(r.summary,'summary'),coverage_gaps:lines(r.coverage_gaps,'coverage_gaps'),items};
}
export async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function ingest(db,raw,origin='upload'){
 const data=validate(raw),payload=JSON.stringify(data),digest=await hash(payload);
 if(encoder.encode(payload).length>MAX)throw Error('Normalized report exceeds 900 KB');
 const result=await db.prepare('INSERT OR IGNORE INTO reports(hash,report_date,generated_at,origin,payload) VALUES(?,?,?,?,?)').bind(digest,data.report_date,new Date(data.generated_at).toISOString(),origin,payload).run();
 const added=result.meta.changes?data.items.length:0,status=result.meta.changes?'imported':'duplicate';
 // One report row is the atomic unit. Failed history logging cannot partially store research.
 await db.prepare('INSERT INTO imports(origin,report_hash,status,added,repeated) VALUES(?,?,?,?,?)').bind(origin,digest,status,added,status==='duplicate'?data.items.length:0).run();
 return {status,added,repeated:status==='duplicate'?data.items.length:0,report_hash:digest};
}
async function snapshot(db,offset){
 const {results:rows}=await db.prepare('SELECT * FROM reports ORDER BY report_date DESC,generated_at DESC,hash DESC LIMIT 21 OFFSET ?').bind(offset).all();
 const more=rows.length>20;const reports=rows.slice(0,20).map(r=>{const {payload,...rest}=r;return {...rest,data:JSON.parse(payload)};});
 const items=new Map();for(const r of reports)for(const i of r.data.items){const key=await hash(JSON.stringify(i));if(items.has(key))items.get(key).report_count++;else items.set(key,{...i,key,report_date:r.report_date,report_count:1});}
 const {results:history}=await db.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 100').all();
 return {reports,items:[...items.values()],history,offset,next_offset:more?offset+20:null};
}
async function readLimited(response,limit){
 if(!response.body)return '';const reader=response.body.getReader();const chunks=[];let length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('Response exceeds size limit');}chunks.push(value);}
 const bytes=new Uint8Array(length);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
async function remote(url,token,form){const r=await fetch(url,{method:form?'POST':'GET',headers:token?{Authorization:'Bearer '+token}:undefined,body:form?new URLSearchParams(form):undefined,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Gmail request failed ('+r.status+')');return JSON.parse(await readLimited(r,2*1024*1024));}
function* parts(p){yield p;for(const c of p.parts||[])yield* parts(c);}
export async function sync(env){
 if(!configured(env))throw Error('Configure Gmail OAuth secrets first');
 const auth=await remote('https://oauth2.googleapis.com/token',null,{client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,refresh_token:env.GMAIL_REFRESH_TOKEN,grant_type:'refresh_token'});
 const token=auth.access_token,root='https://gmail.googleapis.com/gmail/v1/users/me/';
 const account=env.GMAIL_ACCOUNT||'investmalaysia2025@gmail.com';
 if((await remote(root+'profile',token)).emailAddress.toLowerCase()!==account.toLowerCase())throw Error('Gmail account mismatch');
 const listing=await remote(root+'messages?'+new URLSearchParams({q:'subject:"Bursa Research" has:attachment filename:json newer_than:30d',maxResults:'10'}),token);
 const results=[],errors=[];let scanned=0;
 for(const {id} of listing.messages||[]){
  if(await env.DB.prepare('SELECT id FROM gmail_processed WHERE id=?').bind(id).first())continue;
  scanned++;
  try{
   const m=await remote(root+'messages/'+id+'?format=full',token);let count=0;
   for(const p of parts(m.payload||{})){
    if(!p.filename?.toLowerCase().endsWith('.json'))continue;
    if(++count>2)throw Error('Maximum two research attachments per message');
    let b=p.body||{};if(b.size>MAX)throw Error('Attachment exceeds 900 KB');
    if(b.attachmentId)b=await remote(root+'messages/'+id+'/attachments/'+b.attachmentId,token);
    const decoded=atob((b.data||'').replace(/-/g,'+').replace(/_/g,'/'));
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(decoded,c=>c.charCodeAt(0)));
    results.push(await ingest(env.DB,raw,'gmail:'+id));
   }
   if(!count)throw Error('No JSON attachment found');
   await env.DB.prepare('INSERT OR IGNORE INTO gmail_processed(id) VALUES(?)').bind(id).run();
  }catch(e){errors.push({message_id:id,error:'Attachment could not be imported; retained for retry.'});}
 }
 return {scanned,results,errors,more_available:Boolean(listing.nextPageToken)};
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/')){
   const res=await env.ASSETS.fetch(request);const out=new Response(res.body,res);
   out.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");out.headers.set('X-Content-Type-Options','nosniff');out.headers.set('Cache-Control','no-cache');return out;
  }
  if(!env.APP_TOKEN||env.APP_TOKEN.length<24)return reply({error:'Set APP_TOKEN secret to at least 24 characters in Cloudflare.'},503);
  if(await hash(request.headers.get('Authorization')||'')!==await hash('Bearer '+env.APP_TOKEN))return reply({error:'Invalid app access token'},401);
  if(!env.DB)return reply({error:'Connect D1 with binding name DB and apply the SQL migration.'},503);
  try{
   if(request.method==='GET'&&url.pathname==='/api/status')return reply({gmail_configured:configured(env),version:'0.2.0-cloudflare',max_import_bytes:MAX});
   if(request.method==='GET'&&url.pathname==='/api/research'){const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)return reply({error:'Invalid offset'},400);return reply(await snapshot(env.DB,offset));}
   if(request.method==='POST'&&url.pathname==='/api/import'){
    if(!request.headers.get('Content-Type')?.includes('application/json'))return reply({error:'Use application/json'},415);
    let raw;try{raw=await readLimited(request,MAX);validate(raw);}catch(e){return reply({error:e.message},400);}
    return reply(await ingest(env.DB,raw));
   }
   if(request.method==='POST'&&url.pathname==='/api/gmail/sync')return reply(await sync(env));
   return reply({error:'Not found'},404);
  }catch(e){console.error('Research operation failed');return reply({error:'Operation failed. Check D1 migration and Gmail configuration in Cloudflare.'},502);}
 },
 async scheduled(event,env,ctx){if(configured(env)&&env.DB)ctx.waitUntil(sync(env).then(r=>console.log(JSON.stringify({scanned:r.scanned,errors:r.errors.length}))).catch(()=>console.error('Scheduled Gmail sync failed')));}
};

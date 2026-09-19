'use strict';
const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('appToken') || '';
let offset = 0;
let maxImportBytes = 5*1024*1024;
let state = {items: [], reports: [], history: []};
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function message(text, bad=false) { $('message').textContent=text; $('message').className=bad?'error':'success'; }
async function api(path, options={}) {
  const r=await fetch(path,{...options, headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...options.headers}});
  const data=await r.json(); if(!r.ok) throw Error(data.error||'Request failed'); return data;
}
function section(title, lines) { const box=el('div',undefined,'detail-section'); box.append(el('h4',title)); if(!lines?.length) box.append(el('p','Not supplied in this research item.','muted')); else {const list=el('ul'); lines.forEach(t=>list.append(el('li',t)));box.append(list);} return box; }
function showTab(tab) { if(tab==='companies')loadCompanies(); ['research','companies','history'].forEach(id=>$(id).hidden=id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab)); }
function renderFeed() {
  const query=$('search').value.toLowerCase().trim(),cat=$('category').value;
  const items=state.items.filter(i=>(!cat||i.category===cat)&&(!query||JSON.stringify(i).toLowerCase().includes(query)));
  $('feed').replaceChildren();
  if(!items.length){const empty=el('div',undefined,'panel empty');empty.append(el('h2',state.items.length?'No matching research':'Your research starts here'),el('p',state.items.length?'Try another company or category.':'Upload the JSON attachment from your Bursa Research email, or configure Gmail sync.'));$('feed').append(empty);}
  items.forEach(i=>{
    const card=el('article',undefined,'panel research-card');
    const meta=el('div',undefined,'meta');meta.append(el('span',i.category,'badge'),el('span',i.report_date),el('span',i.stock_codes.join(' · ')||'Market / sector'));
    card.append(meta,el('h2',i.headline));
    if(i.company_names.length)card.append(el('p',i.company_names.join(' / '),'muted'));
    if(i.facts[0])card.append(el('p',i.facts[0]));
    const details=el('details');details.append(el('summary','Read evidence & analysis'));
    const grid=el('div',undefined,'details-grid');
    grid.append(section('Reported facts',i.facts),section('Research interpretation',i.analysis),section('Catalysts / upside',i.catalysts),section('Risks / downside',i.risks));
    if(i.bull_case.length||i.bear_case.length)grid.append(section('Bull case',i.bull_case),section('Bear case',i.bear_case));
    details.append(grid,el('p','Verification reported by author: '+i.verification_status,'verification'));
    const sources=el('div',undefined,'sources'); sources.append(el('h4','Sources'));
    i.sources.forEach(s=>{const p=el('p');const a=el('a',s.title);a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a,el('span',' · '+(s.published_at||'Publication date unavailable'),'muted'));sources.append(p);});details.append(sources);card.append(details);$('feed').append(card);
  });
}
function render() {
  $('itemCount').textContent=state.items.length;$('reportCount').textContent=state.reports.length;
  const codes=[...new Set(state.items.flatMap(i=>i.stock_codes))].sort();$('companyCount').textContent=codes.length;
  const latest=state.reports[0];$('updated').textContent=latest?'Displayed research: '+latest.report_date+' · Generated '+latest.generated_at:'No research imported yet';
  $('export').disabled=!latest;
  const selected=$('category').value;$('category').replaceChildren(new Option('All categories',''));[...new Set(state.items.map(i=>i.category))].sort().forEach(c=>$('category').add(new Option(c,c)));$('category').value=selected;
  $('coverage').hidden=!latest;$('summary').hidden=!latest;
  if(latest){$('coverage').textContent='Coverage: '+latest.data.coverage_start+' → '+latest.data.coverage_end+'. '+(latest.data.coverage_gaps.length?'Gaps: '+latest.data.coverage_gaps.join(' '):'No coverage gaps reported by author; exchange-wide completeness is not guaranteed.');$('summary').replaceChildren(section('Latest briefing',latest.data.summary));}
  $('companyList').replaceChildren();
  if(!codes.length)$('companyList').append(el('p','Company views appear after your first import.','muted'));
  codes.forEach(code=>{const items=state.items.filter(i=>i.stock_codes.includes(code));const names=[...new Set(items.flatMap(i=>i.company_names))];const card=el('button',undefined,'panel company');card.append(el('h2',code),el('p',names.join(' / ')||'Company name unavailable'),el('span',items.length+' research items','muted'));card.onclick=()=>openCompany(code);$('companyList').append(card);});
  $('historyRows').replaceChildren();state.history.forEach(h=>{const row=el('tr');[h.created_at,h.origin,h.status,h.added,h.repeated].forEach(v=>row.append(el('td',String(v))));$('historyRows').append(row);});renderFeed();
}
async function load(){const [data,status]=await Promise.all([api('/api/research?offset='+offset),api('/api/status')]);state=data;maxImportBytes=status.max_import_bytes||5*1024*1024;$('newer').hidden=offset===0;$('older').hidden=data.next_offset==null;$('connect').hidden=true;$('desk').hidden=false;$('sync').disabled=!status.gmail_configured;$('gmailState').textContent=status.gmail_configured?'Gmail credentials configured · Account verified on each sync':'Gmail sync not configured · JSON upload is ready to use';render();}
$('login').onsubmit=async e=>{e.preventDefault();token=$('token').value;try{await load();sessionStorage.setItem('appToken',token);$('token').value='';message('Research desk connected.');}catch(e){message(e.message,true);}};
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{if(file.size>maxImportBytes)throw Error('File exceeds server limit ('+Math.round(maxImportBytes/1000)+' KB)');const result=await api('/api/import',{method:'POST',body:await file.text()});await load();message(`${result.status}: ${result.added} new, ${result.repeated} repeated items.`);}catch(e){message(e.message,true);}finally{$('file').value='';}};
$('sync').onclick=async()=>{$('sync').disabled=true;message('Reading research attachments from Gmail…');try{const r=await api('/api/gmail/sync',{method:'POST',body:'{}'});await load();message(`Scanned ${r.scanned} messages. ${r.results.reduce((n,x)=>n+x.added,0)} new items. ${r.errors.length} messages need retry.${r.more_available?' Additional matching messages exist; use manual JSON import for older history.':''}`,r.errors.length>0);}catch(e){message(e.message,true);}finally{$('sync').disabled=false;}};
$('export').onclick=()=>{const r=state.reports[0];if(!r)return;const url=URL.createObjectURL(new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='bursa-research-'+r.report_date+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('search').oninput=renderFeed;$('category').onchange=renderFeed;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('theme').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('light',document.body.classList.contains('light'));};if(localStorage.getItem('light')==='true')document.body.classList.add('light');
if(token)load().catch(e=>{sessionStorage.removeItem('appToken');message(e.message,true);});

$('older').onclick=async()=>{offset=state.next_offset;try{await load();}catch(e){message(e.message,true);}};
$('newer').onclick=async()=>{offset=Math.max(0,offset-20);try{await load();}catch(e){message(e.message,true);}};

let companyItems=[], companyLoading=false;
async function loadCompanies(){
 if(companyLoading)return;companyLoading=true;
 $('companyScope').textContent='Loading company history…';
 try{
 const all=[], seen=new Set();let page=0;
 do{const data=await api('/api/research?offset='+page);for(const i of data.items){if(!seen.has(i.id)){seen.add(i.id);all.push(i);}}page=data.next_offset;}while(page!==null&&page!==undefined);
 companyItems=all;
 const codes=[...new Set(all.flatMap(i=>i.stock_codes))].sort();$('companyList').replaceChildren();
 codes.forEach(code=>{const items=all.filter(i=>i.stock_codes.includes(code));const card=el('button',undefined,'panel company');card.append(el('h2',items[0].company_names.join(' / ')||code),el('p',code+' · '+items.length+' developments'));card.onclick=()=>openCompany(code);$('companyList').append(card);});
 $('companyScope').textContent='All archived reports loaded · latest version of each research event. Company names on shared events may include counterparties.';
 if(!codes.length)$('companyScope').textContent='Import research to build company histories.';
 }catch(e){$('companyScope').textContent='Company history incomplete: '+e.message;}finally{companyLoading=false;}
}
function openCompany(code){
 const items=(companyItems.length?companyItems:state.items).filter(i=>i.stock_codes.includes(code)).sort((a,b)=>b.report_date.localeCompare(a.report_date));
 const box=$('companyDetail');box.replaceChildren();box.hidden=false;$('companyList').hidden=true;
 const back=el('button','← All companies','quiet');back.onclick=()=>{box.hidden=true;$('companyList').hidden=false;};box.append(back,el('h2',(items[0]?.company_names.join(' / ')||'Company')+' · '+code),el('p','Evidence organised from imported research. Interpretations below are author assessments, not a new valuation or buy/sell rating.','muted'));
 const collect=k=>[...new Set(items.flatMap(i=>(i[k]||[]).map(t=>i.report_date+' — '+t)))];
 const grid=el('div',undefined,'details-grid');
 grid.append(section('Investment thesis / interpretation',collect('analysis')),section('Positive case supplied by research',collect('bull_case')),section('Risks and thesis challenges',[...collect('risks'),...collect('bear_case')]),section('Catalysts to monitor',collect('catalysts')));
 box.append(grid);
 const questions=['What do the latest financial statements show about cash flow, debt and valuation?','Have proposed transactions received approval and completed?','Have catalysts occurred, and do newer disclosures support the earlier interpretation?'];
 if(items.some(i=>/secondary|media|unconfirmed/.test(i.verification_status)))questions.unshift('Can the media-reported figures be verified against the original filing or issuer statement?');
 box.append(section('Unanswered questions / review checklist',questions),el('h2','Research timeline'));
 items.forEach(i=>{const card=el('article',undefined,'panel research-card');card.append(el('p','Report date: '+i.report_date+' · '+i.category,'muted'),el('h3',i.headline),section('Reported facts',i.facts),el('p','Evidence status: '+i.verification_status,'muted'));i.sources.forEach(s=>{const a=el('a',s.title+' · '+(s.published_at||'Date unknown'));a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';const row=el('p');row.append(a);card.append(row);});box.append(card);});
 box.scrollIntoView({behavior:'smooth',block:'start'});
}
let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});
$('install').onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('install').hidden=true;};
window.addEventListener('appinstalled',()=>{$('install').hidden=true;});
function networkState(){$('networkState').textContent=navigator.onLine?'':'Offline — connect to load or sync research. Private research is not cached on this device.';}
window.addEventListener('online',networkState);window.addEventListener('offline',networkState);networkState();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{$('networkState').textContent='App installation support unavailable; the website remains usable.';});

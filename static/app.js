'use strict';
const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('appToken') || '';
let state = {items: [], reports: [], history: []};
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function message(text, bad=false) { $('message').textContent=text; $('message').className=bad?'error':'success'; }
async function api(path, options={}) {
  const r=await fetch(path,{...options, headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...options.headers}});
  const data=await r.json(); if(!r.ok) throw Error(data.error||'Request failed'); return data;
}
function section(title, lines) { const box=el('div',undefined,'detail-section'); box.append(el('h4',title)); if(!lines?.length) box.append(el('p','Not supplied in this research item.','muted')); else {const list=el('ul'); lines.forEach(t=>list.append(el('li',t)));box.append(list);} return box; }
function showTab(tab) { ['research','companies','history'].forEach(id=>$(id).hidden=id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab)); }
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
  const latest=state.reports[0];$('updated').textContent=latest?'Latest research: '+latest.report_date+' · Generated '+latest.generated_at:'No research imported yet';
  $('export').disabled=!latest;
  const selected=$('category').value;$('category').replaceChildren(new Option('All categories',''));[...new Set(state.items.map(i=>i.category))].sort().forEach(c=>$('category').add(new Option(c,c)));$('category').value=selected;
  $('coverage').hidden=!latest;$('summary').hidden=!latest;
  if(latest){$('coverage').textContent='Coverage: '+latest.data.coverage_start+' → '+latest.data.coverage_end+'. '+(latest.data.coverage_gaps.length?'Gaps: '+latest.data.coverage_gaps.join(' '):'No coverage gaps reported by author; exchange-wide completeness is not guaranteed.');$('summary').replaceChildren(section('Latest briefing',latest.data.summary));}
  $('companyList').replaceChildren();
  if(!codes.length)$('companyList').append(el('p','Company views appear after your first import.','muted'));
  codes.forEach(code=>{const items=state.items.filter(i=>i.stock_codes.includes(code));const names=[...new Set(items.flatMap(i=>i.company_names))];const card=el('button',undefined,'panel company');card.append(el('h2',code),el('p',names.join(' / ')||'Company name unavailable'),el('span',items.length+' research items','muted'));card.onclick=()=>{$('search').value=code;$('category').value='';showTab('research');renderFeed();};$('companyList').append(card);});
  $('historyRows').replaceChildren();state.history.forEach(h=>{const row=el('tr');[h.created_at,h.origin,h.status,h.added,h.repeated].forEach(v=>row.append(el('td',String(v))));$('historyRows').append(row);});renderFeed();
}
async function load(){const [data,status]=await Promise.all([api('/api/research'),api('/api/status')]);state=data;$('connect').hidden=true;$('desk').hidden=false;$('sync').disabled=!status.gmail_configured;$('gmailState').textContent=status.gmail_configured?'Gmail credentials configured · Account verified on each sync':'Gmail sync not configured · JSON upload is ready to use';render();}
$('login').onsubmit=async e=>{e.preventDefault();token=$('token').value;try{await load();sessionStorage.setItem('appToken',token);$('token').value='';message('Research desk connected.');}catch(e){message(e.message,true);}};
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error('File exceeds 5 MB');const result=await api('/api/import',{method:'POST',body:await file.text()});await load();message(`${result.status}: ${result.added} new, ${result.repeated} repeated items.`);}catch(e){message(e.message,true);}finally{$('file').value='';}};
$('sync').onclick=async()=>{$('sync').disabled=true;message('Reading research attachments from Gmail…');try{const r=await api('/api/gmail/sync',{method:'POST',body:'{}'});await load();message(`Scanned ${r.scanned} messages. ${r.results.reduce((n,x)=>n+x.added,0)} new items. ${r.errors.length} messages need retry.${r.more_available?' More than 250 matching messages exist; use manual JSON import for older history.':''}`,r.errors.length>0);}catch(e){message(e.message,true);}finally{$('sync').disabled=false;}};
$('export').onclick=()=>{const r=state.reports[0];if(!r)return;const url=URL.createObjectURL(new Blob([JSON.stringify(r.data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='bursa-research-'+r.report_date+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('search').oninput=renderFeed;$('category').onchange=renderFeed;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('theme').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('light',document.body.classList.contains('light'));};if(localStorage.getItem('light')==='true')document.body.classList.add('light');
if(token)load().catch(e=>{sessionStorage.removeItem('appToken');message(e.message,true);});

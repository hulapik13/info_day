const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const map=L.map('map',{preferCanvas:true,tap:true}).setView([55.75,37.62],10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OSM · наличие © ГдеБенз'}).addTo(map);
const canvas=L.canvas({padding:.5});map.attributionControl.setPrefix(false);
const FORDER=['92','95','98','100','ДТ'];

let ST=[],IDX={},REPORTS={},MY=null,fetchedAt=0;
const markers={};
const state={st:new Set(),fuel:new Set(),q:''};
const SCOL={yes:'#28c76f',queue:'#ffc63d',low:'#ff8a3d',no:'#ff5a5a'};
const SLAB={yes:'🟢 есть топливо',queue:'🟡 очередь',low:'🟠 мало',no:'🔴 нет топлива'};
const SBG={yes:'rgba(40,199,111,.15)',queue:'rgba(255,198,61,.15)',low:'rgba(255,138,61,.15)',no:'rgba(255,90,90,.14)'};
function ago(ts){const s=(Date.now()-ts)/1000;if(s<90)return 'только что';if(s<3600)return Math.round(s/60)+' мин назад';if(s<86400)return Math.round(s/3600)+' ч назад';return Math.round(s/86400)+' дн назад';}
function parseT(t){return t?Date.parse(t.replace(' ','T')+'Z'):0;}
function qlabel(q){return ['нет очереди','очередь небольшая','очередь большая','очередь час+'][q]||'';}

// доступно/продаётся по видам
function limHtml(s){if(!s.lim)return '';const e=Object.entries(s.lim);if(!e.length)return '';
  return '<div style="font-size:12px;color:var(--o);margin-top:4px">⛔ лимит: '+e.map(x=>esc(x[0])+' — '+x[1]+' л').join(', ')+'</div>';}
function fuelInfo(s){
  const avail=new Set((s.fn||'').split(',').filter(Boolean));
  const sold=new Set([...avail,...(s.no||'').split(',').filter(Boolean),...Object.keys(s.pr||{})]);
  return {avail,sold};
}
function effective(s){
  const r=REPORTS[s.id];
  let gt=s.sts?s.sts*1000:fetchedAt;for(const f in (s.pr||{})){const t=parseT(s.pr[f].t);if(t>gt)gt=t;}
  if(r&&r.ts>gt){let col=r.yes&&r.yes.length?'#28c76f':(r.no&&r.no.length?'#ff5a5a':'#ffc63d');if(r.q>=2&&r.yes&&r.yes.length)col='#ffc63d';return {col,src:'friend',gt};}
  return {col:SCOL[s.s]||'#6b7686',src:'gdebenz',gt};
}
function visible(s){
  if(state.st.size&&(!s.s||!state.st.has(s.s)))return false;
  if(state.fuel.size){const {avail}=fuelInfo(s);if(![...state.fuel].some(f=>avail.has(f)))return false;}
  if(state.q){const t=(s.n+' '+s.b+' '+s.ad).toLowerCase();if(!t.includes(state.q.toLowerCase()))return false;}
  return true;
}
function refresh(){
  let shown=0,fresh=0;
  for(const s of ST){
    if(!visible(s)){if(markers[s.id]){map.removeLayer(markers[s.id]);delete markers[s.id];}continue;}
    shown++;const eff=effective(s);
    const hasFriend=REPORTS[s.id]&&Date.now()-REPORTS[s.id].ts<3600e3;if(hasFriend)fresh++;
    const rad=s.s&&s.s!=='no'?6:(s.s?5:4);
    const stale=s.sts&&(Date.now()-s.sts*1000>6*3600e3);
    const style={radius:rad,fillColor:eff.col,weight:hasFriend?2.5:1,color:hasFriend?'#2b9bf4':'#0b0d12',fillOpacity:s.s?(stale?.45:.9):.4};
    if(!markers[s.id]){markers[s.id]=L.circleMarker([s.la,s.lo],{renderer:canvas,...style}).on('click',()=>openSheet(s.id)).addTo(map);}
    else markers[s.id].setStyle(style);
  }
  $('stat').textContent=`Показано ${shown} из ${ST.length}`+(window.__fbReady?` · отметок друзей ${fresh}`:'');
}

let curPick={},curQ=null,curId=null;
function openSheet(id){
  const s=IDX[id];if(!s)return;curPick={};curQ=null;curId=id;
  const {avail,sold}=fuelInfo(s),eff=effective(s),r=REPORTS[id];
  // разбивка по топливу
  const noset=new Set((s.no||'').split(',').filter(Boolean));let pf=FORDER.filter(f=>sold.has(f)).map(f=>`<span class="fb ${avail.has(f)?'g':'r'}">${f} ${avail.has(f)?'✓':'✗'}</span>`).join('');
  if(!pf)pf='<span style="color:var(--mut);font-size:13px">по видам топлива данных нет</span>';
  // цены
  const pr=s.pr||{};let priceRows='',t0=0;
  FORDER.forEach(f=>{if(pr[f]&&pr[f].p){priceRows+=`<tr><td>${f}</td><td>${pr[f].p} ₽</td></tr>`;const t=parseT(pr[f].t);if(t>t0)t0=t;}});
  const priceBlock=priceRows?`<table class="price">${priceRows}</table>${t0?`<div class="price">цены: ${ago(t0)}</div>`:''}`:'';
  // отметка друзей
  let fr='';
  if(r){let b='';(r.yes||[]).forEach(f=>b+=`<span class="fb g">${esc(f)} ✓</span>`);(r.no||[]).forEach(f=>b+=`<span class="fb r">${esc(f)} ✗</span>`);
    fr=`<div style="border-left:3px solid #2b9bf4;padding-left:9px;margin:9px 0"><div style="font-size:11px;color:var(--mut)">ДРУЗЬЯ · ${ago(r.ts)}${r.who?' · '+esc(r.who):''}</div><div class="pf">${b}</div>${r.cars!=null?`<div style="font-size:13px;color:var(--y)">🚗 примерно ${r.cars} ${r.cars%10==1&&r.cars%100!=11?'машина':(r.cars%10>=2&&r.cars%10<=4&&(r.cars%100<10||r.cars%100>=20)?'машины':'машин')} в очереди</div>`:(r.q!=null?`<div style="font-size:12px;color:var(--y)">${qlabel(r.q)}</div>`:'')}${r.note?`<div style="font-size:11px;color:var(--mut)">«${esc(r.note)}»</div>`:''}</div>`;}
  const fbOn=window.__fbReady;
  const fset=(sold.size?[...sold].filter(f=>FORDER.includes(f)):FORDER).sort((a,b)=>FORDER.indexOf(a)-FORDER.indexOf(b));
  const form=fbOn?`<div class="frm"><div style="font-size:11px;color:var(--mut);margin-bottom:5px">СВОЯ ОТМЕТКА (видят друзья)</div>
    ${fset.map(f=>`<div class="fuelrow"><span class="fn">${esc(f)}</span><span class="mini" data-f="${esc(f)}" data-v="yes">есть</span><span class="mini" data-f="${esc(f)}" data-v="no">нет</span></div>`).join('')}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:7px 0"><span class="mini" data-q="0">оч:нет</span><span class="mini" data-q="1">неб.</span><span class="mini" data-q="2">больш.</span><span class="mini" data-q="3">час+</span></div>
    <input type="number" id="pcars" placeholder="машин в очереди (примерно)" min="0" max="500" inputmode="numeric">
    <input type="text" id="pnote" placeholder="коммент (лимит, цена)" maxlength="80">
    <input type="text" id="pwho" placeholder="имя" maxlength="20" value="${esc(localStorage.getItem('br_name')||'')}">
    <button class="primary" id="psave">Опубликовать</button></div>`:'';
  const html=`<div class="hdr">${esc(s.n)}</div><div style="color:var(--mut);font-size:12px">${s.b?esc(s.b)+' · ':''}${esc(s.ad||'')}</div>
    <span class="st" style="background:${SBG[s.s]||'#2a3140'};color:${SCOL[s.s]||'var(--mut)'}">${esc(SLAB[s.s]||'нет данных наличия')}</span>
    ${window.TOMTOM_KEY?`<div id="flowLine" style="font-size:13px;margin:6px 0;color:var(--mut)">🚦 пробки вокруг (1.5 км): <span style="opacity:.7">проверяю…</span></div>`:''}
    ${s.sts?`<div style="font-size:11px;color:${Date.now()-s.sts*1000>6*3600e3?'var(--o)':'var(--mut)'}">🕐 наличие обновлено <b>${ago(s.sts*1000)}</b>${s.stssrc?' · '+esc(s.stssrc):''}</div>`:`<div style="font-size:11px;color:var(--mut)">🕐 источник не публикует время обновления</div>`}
    ${s.q?`<div style="font-size:14px;color:var(--y);margin:6px 0">🚗 <b>${esc(s.q)}</b> <span style="color:var(--mut);font-size:11px">(${esc(s.qsrc||'')})</span></div>`:''}<div style="font-size:11px;color:var(--mut)">есть сейчас / нет сейчас:</div><div class="pf">${pf}</div>${limHtml(s)}
    ${priceBlock}${fr}
    <div style="font-size:11px;color:var(--acc)">▸ свежее: ${eff.src==='friend'?'отметка друзей':'данные ГдеБенз'}</div>
    <div style="font-size:10.5px;color:var(--mut);margin-top:6px">источники: ${(s.src||['gdebenz']).join(', ')}</div>\n    <div class="dl"><a href="https://gdebenz.ru/" target="_blank">ГдеБенз</a><a href="https://yandex.ru/maps/?ll=${s.lo},${s.la}&z=17&l=trf" target="_blank">🚗 пробки</a><a href="https://yandex.ru/maps/?rtext=~${s.la},${s.lo}&rtt=auto" target="_blank">🧭 маршрут</a><a href="#" onclick="shareAZS('${id}');return false">📤</a></div>
    ${fbOn?`<button id="revealForm" style="width:100%;margin-top:10px;padding:12px;border-radius:10px;border:1px solid var(--acc);background:transparent;color:var(--acc);font-weight:600;font-size:15px;cursor:pointer">➕ Отметить наличие</button><div id="formWrap" style="display:none">${form}</div>`:''}`;
  const sc=$('sheetc');sc.innerHTML=html;sc.scrollTop=0;
  $('sheet').classList.add('on');$('backdrop').classList.add('on');
  try{map.setView([s.la,s.lo],Math.max(map.getZoom(),14),{animate:false});map.panBy([0,-map.getSize().y*0.24],{animate:false});}catch(e){}
  if(window.TOMTOM_KEY)showArea(id,s.la,s.lo).then(segs=>{const el=$('flowLine');if(el&&curId===id)el.innerHTML='🚦 пробки вокруг (1.5 км): '+areaSummary(segs);});
  setTimeout(()=>{
    document.querySelectorAll('.mini[data-f]').forEach(el=>el.onclick=()=>{const f=el.dataset.f,v=el.dataset.v;document.querySelectorAll(`.mini[data-f="${f}"]`).forEach(x=>x.classList.remove('yes','no'));if(curPick[f]===v)delete curPick[f];else{curPick[f]=v;el.classList.add(v);}});
    document.querySelectorAll('.mini[data-q]').forEach(el=>el.onclick=()=>{document.querySelectorAll('.mini[data-q]').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');curQ=+el.dataset.q;});
    const rv=$('revealForm');if(rv)rv.onclick=()=>{$('formWrap').style.display='block';rv.style.display='none';$('formWrap').scrollIntoView({behavior:'smooth',block:'nearest'});};
    const sv=$('psave');if(sv)sv.onclick=()=>{const yes=Object.keys(curPick).filter(f=>curPick[f]==='yes'),no=Object.keys(curPick).filter(f=>curPick[f]==='no');
      if(!yes.length&&!no.length&&curQ==null){alert('Отметь топливо или очередь');return;}
      const who=($('pwho').value||'').trim();localStorage.setItem('br_name',who);
      window.__db.ref('reports').push({id:curId,ts:Date.now(),who,q:curQ==null?null:curQ,cars:(function(){const v=parseInt(($('pcars').value||'').trim(),10);return isNaN(v)?null:v;})(),note:($('pnote').value||'').trim(),yes,no}).then(()=>closeSheet()).catch(e=>alert('Ошибка: '+e.message));};
  },30);
}
function closeSheet(){$('sheet').classList.remove('on');$('backdrop').classList.remove('on');clearArea();}
window.closeSheet=closeSheet;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
window.shareAZS=function(id){const s=IDX[id];const url=`https://yandex.ru/maps/?ll=${s.lo},${s.la}&z=17&l=trf`;const rr=REPORTS[id];const cars=(rr&&rr.cars!=null)?` · ~${rr.cars} машин`:(s.q?` · ${s.q}`:'');const text=`⛽ ${s.n} — ${SLAB[s.s]||''}${s.fn?' ('+s.fn+')':''}${cars} — ${url}`;
  if(navigator.share){navigator.share({title:s.n,text});return;}window.open('https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(text),'_blank');};

window.initRealtime=function(){window.__db.ref('reports').limitToLast(4000).on('value',snap=>{const l={};snap.forEach(ch=>{const r=ch.val();if(!r||!r.id)return;if(!l[r.id]||r.ts>l[r.id].ts)l[r.id]=r;});REPORTS=l;refresh();});};

async function loadLive(){
  try{let r;try{r=await fetch('live.json?t='+Date.now());if(!r.ok)throw 0;}catch(_){r=await fetch('https://raw.githubusercontent.com/hulapik13/info_day/master/live.json?t='+Date.now());}
    const d=await r.json();ST=d.stations||[];IDX={};ST.forEach(s=>IDX[s.id]=s);fetchedAt=Date.parse(d.fetched_at)||Date.now();
    const mins=Math.round((Date.now()-fetchedAt)/60000);
    $('src').innerHTML=`наличие © <b>ГдеБенз</b> · обновлено ${mins<=1?'только что':mins+' мин назад'}`;
    for(const id in markers)if(!IDX[id]){map.removeLayer(markers[id]);delete markers[id];}
    refresh();
  }catch(e){$('warn').style.display='block';$('warn').textContent='Не удалось загрузить наличие: '+e.message;}
}
function saveState(){try{localStorage.setItem('br_filters',JSON.stringify({st:[...state.st],fuel:[...state.fuel],q:state.q}));}catch(e){}}
function restoreState(){try{const d=JSON.parse(localStorage.getItem('br_filters')||'{}');
  (d.st||[]).forEach(v=>{state.st.add(v);const c=document.querySelector('#sts .chip[data-s="'+v+'"]');if(c)c.classList.add('on');});
  (d.fuel||[]).forEach(v=>{state.fuel.add(v);const c=document.querySelector('#fuels .chip[data-f="'+v+'"]');if(c)c.classList.add('on');});
  if(d.q){state.q=d.q;$('q').value=d.q;}}catch(e){}}
$('togg').onclick=()=>$('drawer').classList.toggle('open');
$('q').oninput=e=>{state.q=e.target.value;saveState();refresh();};
$('sts').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state.st.has(c.dataset.s)?state.st.delete(c.dataset.s):state.st.add(c.dataset.s);saveState();refresh();};
$('fuels').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state.fuel.has(c.dataset.f)?state.fuel.delete(c.dataset.f):state.fuel.add(c.dataset.f);saveState();refresh();};
$('reset').onclick=()=>{state.st.clear();state.fuel.clear();state.q='';$('q').value='';document.querySelectorAll('.chip.on').forEach(c=>c.classList.remove('on'));saveState();refresh();};
$('near').onclick=()=>{if(!navigator.geolocation){alert('Геолокация недоступна');return;}navigator.geolocation.getCurrentPosition(p=>{MY=[p.coords.latitude,p.coords.longitude];L.circleMarker(MY,{radius:8,color:'#fff',fillColor:'#ffb020',fillOpacity:1}).addTo(map).bindPopup('Вы здесь');map.setView(MY,14);$('drawer').classList.remove('open');},()=>alert('Нет доступа к геопозиции'));};
$('yandex').onclick=()=>window.open('https://yandex.ru/maps/213/moscow/?l=trf','_blank');

restoreState();

// ---- пробки вокруг АЗС в радиусе 1.5 км ----
const FLOWP={};
async function fetchPoint(la,lo){
  const key=la.toFixed(4)+','+lo.toFixed(4);const c=FLOWP[key];
  if(c&&Date.now()-c.ts<240000)return c.v;
  if(!window.TOMTOM_KEY)return null;
  try{
    const r=await fetch(`https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?point=${la},${lo}&key=${window.TOMTOM_KEY}`);
    if(!r.ok)throw 0;const d=(await r.json()).flowSegmentData;
    const coords=((d.coordinates||{}).coordinate||[]).map(p=>[p.latitude,p.longitude]);
    const v={cs:d.currentSpeed,ff:d.freeFlowSpeed,tt:d.currentTravelTime,ft:d.freeFlowTravelTime,closed:d.roadClosure,ratio:d.freeFlowSpeed?d.currentSpeed/d.freeFlowSpeed:1,coords};
    FLOWP[key]={v,ts:Date.now()};return v;
  }catch(e){return null;}
}
function ringPoints(la,lo,km,n){const R=6371,out=[],lar=la*Math.PI/180,lor=lo*Math.PI/180,dr=km/R;
  for(let i=0;i<n;i++){const br=2*Math.PI*i/n;
    const lat2=Math.asin(Math.sin(lar)*Math.cos(dr)+Math.cos(lar)*Math.sin(dr)*Math.cos(br));
    const lon2=lor+Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(lar),Math.cos(dr)-Math.sin(lar)*Math.sin(lat2));
    out.push([lat2*180/Math.PI,lon2*180/Math.PI]);}
  return out;}
const focusLayer=L.layerGroup();
function clearArea(){focusLayer.clearLayers();if(map.hasLayer(focusLayer))map.removeLayer(focusLayer);}
async function showArea(id,la,lo){
  clearArea();focusLayer.addTo(map);
  L.circle([la,lo],{radius:1500,color:'#ffb020',weight:1.5,opacity:.7,fill:false,dashArray:'5 7',interactive:false}).addTo(focusLayer);
  const pts=[[la,lo],...ringPoints(la,lo,0.8,6),...ringPoints(la,lo,1.5,8)];
  const seen=new Set(),segs=[];
  await Promise.all(pts.map(async p=>{
    const f=await fetchPoint(p[0],p[1]);if(!f||!f.coords||f.coords.length<2)return;
    const k=f.coords[0][0].toFixed(4)+f.coords[0][1].toFixed(4)+f.coords[f.coords.length-1][0].toFixed(4);
    if(seen.has(k))return;seen.add(k);segs.push(f);
    if(curId!==id)return;
    const c=congColor(f);
    L.polyline(f.coords,{color:'#0b0d12',weight:8,opacity:.45,interactive:false}).addTo(focusLayer);
    L.polyline(f.coords,{color:c,weight:5,opacity:.95,lineCap:'round',interactive:false}).addTo(focusLayer);
  }));
  return segs;
}
function areaSummary(segs){
  if(!segs.length)return '<span style="opacity:.6">нет данных по дорогам вокруг</span>';
  const jam=segs.filter(f=>f.closed||f.cs<=6||f.ratio<.3).length;
  const dense=segs.filter(f=>f.ratio>=.3&&f.ratio<.55).length;
  const avg=segs.reduce((a,f)=>a+Math.min(f.ratio,1),0)/segs.length;
  const load=Math.round((1-avg)*100);
  const col=jam>=3||load>=55?'#ff3b3b':(jam>=1||load>=35?'#ff8a3d':(load>=20?'#ffc63d':'#28c76f'));
  const word=jam>=3||load>=55?'🔴 плотно, стоят':(jam>=1||load>=35?'🟠 местами заторы':(load>=20?'🟡 умеренно':'🟢 свободно'));
  return `<b style="color:${col}">${word}</b> · загрузка ~${load}%`+(jam?` · заторов: ${jam}`:'')+(dense?` · плотно: ${dense}`:'');
}

// ---- пробки ТОЧЕЧНО по АЗС (TomTom flowSegmentData) ----
const FLOW={};
async function fetchFlow(id,la,lo){
  const c=FLOW[id];if(c&&Date.now()-c.ts<240000)return c;
  if(!window.TOMTOM_KEY)return null;
  try{
    const r=await fetch(`https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?point=${la},${lo}&key=${window.TOMTOM_KEY}`);
    if(!r.ok)throw 0;const d=(await r.json()).flowSegmentData;
    const coords=((d.coordinates||{}).coordinate||[]).map(p=>[p.latitude,p.longitude]);
    const rec={cs:d.currentSpeed,ff:d.freeFlowSpeed,tt:d.currentTravelTime,ft:d.freeFlowTravelTime,closed:d.roadClosure,conf:d.confidence,ratio:d.freeFlowSpeed?d.currentSpeed/d.freeFlowSpeed:1,coords,ts:Date.now()};
    FLOW[id]=rec;return rec;
  }catch(e){return null;}
}
function congColor(f){if(!f)return null;if(f.closed)return '#7a0010';if(f.cs<=6)return '#c0002a';const r=f.ratio;return r>=.85?'#28c76f':r>=.55?'#ffc63d':r>=.3?'#ff8a3d':'#ff3b3b';}
function congText(f){if(!f)return '';if(f.closed)return '⛔ дорога перекрыта';let w;if(f.cs<=6)w='🔴 стоят';else if(f.ratio>=.85)w='🟢 свободно';else if(f.ratio>=.55)w='🟡 местами плотно';else if(f.ratio>=.3)w='🟠 плотно';else w='🔴 затор';const dl=Math.round(((f.tt||0)-(f.ft||0))/60);return `${w} · ${f.cs} км/ч (обычно ${f.ff})`+(dl>=1?` · +${dl} мин`:'');}

let trafficMode=false;const lineLayer=L.layerGroup();const lines={};let ringBusy=false;
async function refreshLines(){
  if(!trafficMode){for(const k in lines){lineLayer.removeLayer(lines[k]);delete lines[k];}$('trafficHint').style.display='none';return;}
  if(map.getZoom()<14){for(const k in lines){lineLayer.removeLayer(lines[k]);delete lines[k];}$('trafficHint').style.display='block';$('trafficHint').textContent='🚦 приблизь карту — покажу пробки на дорогах у заправок';return;}
  $('trafficHint').style.display='none';
  if(ringBusy)return;ringBusy=true;
  try{
    const b=map.getBounds();const vis=ST.filter(s=>b.contains([s.la,s.lo])).slice(0,25);
    await Promise.all(vis.map(async s=>{
      const f=await fetchFlow(s.id,s.la,s.lo);const c=congColor(f);if(!c||!f.coords||f.coords.length<2)return;
      if(lines[s.id])lineLayer.removeLayer(lines[s.id]);
      const g=L.layerGroup([
        L.polyline(f.coords,{color:'#0b0d12',weight:9,opacity:.5,lineCap:'round',lineJoin:'round',interactive:false}),
        L.polyline(f.coords,{color:c,weight:5,opacity:.95,lineCap:'round',lineJoin:'round',interactive:false})
      ]);
      lines[s.id]=g;lineLayer.addLayer(g);
    }));
  }finally{ringBusy=false;}
}
lineLayer.addTo(map);
let ringTimer=null;
map.on('moveend zoomend',()=>{clearTimeout(ringTimer);ringTimer=setTimeout(refreshLines,400);});
if(window.TOMTOM_KEY){
  $('traffic').onclick=()=>{trafficMode=!trafficMode;const b=$('traffic');
    if(trafficMode){b.style.background='var(--acc)';b.style.color='#231800';b.style.borderColor='transparent';b.style.fontWeight='600';}
    else{b.style.background='';b.style.color='';b.style.borderColor='';b.style.fontWeight='';}
    try{localStorage.setItem('br_traffic',trafficMode?'1':'0');}catch(e){}
    refreshLines();$('drawer').classList.remove('open');};
  try{if(localStorage.getItem('br_traffic')==='1'){trafficMode=true;$('traffic').style.background='var(--acc)';$('traffic').style.color='#231800';$('traffic').style.borderColor='transparent';$('traffic').style.fontWeight='600';}}catch(e){}
}else{const b=$('traffic');if(b)b.style.display='none';}

loadLive();
setInterval(loadLive,180000);
setTimeout(()=>map.invalidateSize(),200);
window.addEventListener('resize',()=>map.invalidateSize());

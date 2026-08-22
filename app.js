const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const map=L.map('map',{preferCanvas:true,tap:true});
(function(){try{const v=JSON.parse(localStorage.getItem('br_view')||'null');if(v&&v.lat)map.setView([v.lat,v.lng],v.z);else map.setView([55.75,37.62],10);}catch(e){map.setView([55.75,37.62],10);}})();
map.on('moveend zoomend',()=>{try{const c=map.getCenter();localStorage.setItem('br_view',JSON.stringify({lat:+c.lat.toFixed(5),lng:+c.lng.toFixed(5),z:map.getZoom()}));}catch(e){}});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OSM · наличие © ГдеБенз'}).addTo(map);
const canvas=L.canvas({padding:.5});map.attributionControl.setPrefix(false);
map.createPane('trafficPane');map.getPane('trafficPane').style.zIndex=350;map.getPane('trafficPane').style.pointerEvents='none';
const trafficRenderer=L.canvas({pane:'trafficPane',padding:.5});
const FORDER=['92','95','98','100','ДТ'];

let ST=[],IDX={},REPORTS={},MY=null,fetchedAt=0;
const markers={};
const state={st:new Set(),fuel:new Set(),q:''};
const FAV=new Set(JSON.parse(localStorage.getItem('br_fav')||'[]'));
function saveFav(){try{localStorage.setItem('br_fav',JSON.stringify([...FAV]));}catch(e){}}
function isFav(id){return FAV.has(id);}
window.toggleFav=function(id){if(FAV.has(id))FAV.delete(id);else FAV.add(id);saveFav();const b=document.getElementById('starBtn');if(b)b.textContent=isFav(id)?'★':'☆';refresh();};
function toast(msg,ms){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),ms||3500);}
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
  const b=map.getBounds().pad(0.25);
  let matched=0,fresh=0;
  for(const s of ST){
    const ok=visible(s);if(ok)matched++;
    const render=ok&&b.contains([s.la,s.lo]);
    if(!render){if(markers[s.id]){map.removeLayer(markers[s.id]);delete markers[s.id];}continue;}
    const eff=effective(s);
    const hasFriend=REPORTS[s.id]&&Date.now()-REPORTS[s.id].ts<3600e3;if(hasFriend)fresh++;
    const rad=s.s&&s.s!=='no'?6:(s.s?5:4);
    const stale=(s.sts&&(Date.now()-s.sts*1000>6*3600e3))||(s.rel&&s.rel.weak);
    const fav=isFav(s.id);
    const style={radius:fav?rad+1.5:rad,fillColor:eff.col,weight:(hasFriend||fav)?2.6:1,color:hasFriend?'#2b9bf4':(fav?'#ffb020':'#0b0d12'),fillOpacity:s.s?(stale?.45:.9):.4};
    if(!markers[s.id]){markers[s.id]=L.circleMarker([s.la,s.lo],{renderer:canvas,...style}).on('click',()=>openSheet(s.id)).addTo(map);}
    else markers[s.id].setStyle(style);
  }
  $('stat').textContent=`Показано ${matched} из ${ST.length}`+(window.__fbReady?` · отметок друзей ${fresh}`:'');
}
let _cull=null;
map.on('moveend',()=>{clearTimeout(_cull);_cull=setTimeout(refresh,120);});

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
  const html=`<div style="display:flex;align-items:flex-start;gap:8px;padding-right:40px"><div style="flex:1"><div class="hdr">${esc(s.n)}</div><div style="color:var(--mut);font-size:12px">${s.b?esc(s.b)+' · ':''}${esc(s.ad||'')}</div></div><button class="starbtn" id="starBtn">${isFav(id)?'★':'☆'}</button></div>
    <div style="font-size:11px;color:var(--mut);margin-top:8px">🚦 пробки на заезде (Яндекс, вживую):</div>
    <div id="yamap" style="margin:5px 0;height:240px;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#0f1218;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:12px">загрузка карты Яндекса…</div>
    <span class="st" style="background:${SBG[s.s]||'#2a3140'};color:${SCOL[s.s]||'var(--mut)'}">${esc(SLAB[s.s]||'нет данных наличия')}</span>
    ${window.TOMTOM_KEY?`<div id="flowLine" style="font-size:13px;margin:6px 0;color:var(--mut)">🚦 движение на заезд: <span style="opacity:.7">проверяю…</span></div>`:''}
    ${s.sts?`<div style="font-size:11px;color:${Date.now()-s.sts*1000>6*3600e3?'var(--o)':'var(--mut)'}">🕐 наличие обновлено <b>${ago(s.sts*1000)}</b>${s.stssrc?' · источник: <b>'+esc(s.stssrc)+'</b>':''}</div>`:`<div style="font-size:11px;color:var(--mut)">🕐 источник не публикует время обновления</div>`}
    ${s.q?`<div style="font-size:14px;color:var(--y);margin:6px 0">🚗 <b>${esc(s.q)}</b> <span style="color:var(--mut);font-size:11px">(${esc(s.qsrc||'')})</span></div>`:''}${s.rel?(function(){var RL={high:['🟢 высокая','#28c76f'],mid:['🟡 средняя','#ffc63d'],low:['🔴 низкая','#ff5a5a'],none:['нет данных','#9aa4b2']};var r=s.rel;var q=RL[r.lvl]||RL.none;var w=[];if(r.total)w.push(r.total+' источн.');if(r.tbank)w.push('T-Bank ✓');if(r.weak)w.push('мало данных');if(r.ageMin!=null)w.push(r.ageMin<=1?'только что':(r.ageMin<60?r.ageMin+' мин':Math.round(r.ageMin/60)+' ч'));return '<div style="font-size:11px;color:var(--mut);margin-top:3px">🔎 надёжность: <b style="color:'+q[1]+'">'+q[0]+'</b>'+(w.length?' · '+w.join(' · '):'')+'</div>';})():''}
    <div style="font-size:11px;color:var(--mut)">есть сейчас / нет сейчас:</div><div class="pf">${pf}</div>${limHtml(s)}
    ${priceBlock}${fr}
    <div style="font-size:11px;color:var(--acc)">▸ свежее: ${eff.src==='friend'?'отметка друзей':'данные ГдеБенз'}</div>
    <div style="font-size:10.5px;color:var(--mut);margin-top:6px">проверено по: ${(s.src||['gdebenz']).join(', ')}</div>\n    <div class="dl"><a href="https://gdebenz.ru/" target="_blank">ГдеБенз</a><a href="https://yandex.ru/maps/?ll=${s.lo},${s.la}&z=17&l=trf" target="_blank">🚗 пробки</a><a href="https://yandex.ru/maps/?rtext=~${s.la},${s.lo}&rtt=auto" target="_blank">🧭 маршрут</a><a href="#" onclick="shareAZS('${id}');return false">📤</a></div>
    ${fbOn?`<button id="revealForm" style="width:100%;margin-top:10px;padding:12px;border-radius:10px;border:1px solid var(--acc);background:transparent;color:var(--acc);font-weight:600;font-size:15px;cursor:pointer">➕ Отметить наличие</button><div id="formWrap" style="display:none">${form}</div>`:''}`;
  const sc=$('sheetc');sc.innerHTML=html;sc.scrollTop=0;
  $('sheet').classList.add('on');$('backdrop').classList.add('on');
  try{map.setView([s.la,s.lo],Math.max(map.getZoom(),14),{animate:false});map.panBy([0,-map.getSize().y*0.24],{animate:false});}catch(e){}
  const ya=$('yamap');if(ya)ya.innerHTML='<iframe src="https://yandex.ru/map-widget/v1/?ll='+s.lo+'%2C'+s.la+'&z=18&l=map%2Ctrf&pt='+s.lo+'%2C'+s.la+'%2Cpm2rdm" width="100%" height="240" style="border:0" loading="lazy" referrerpolicy="no-referrer"></iframe>';
  if(window.TOMTOM_KEY)showArea(id,s.la,s.lo).then(segs=>{const el=$('flowLine');if(el&&curId===id){const f=segs&&segs[0];el.innerHTML='🚦 движение на заезд (оценка TomTom): '+(f?`<b style="color:${congColor(f)}">${congText(f)}</b>`:'<span style="opacity:.6">нет данных</span>');}});
  setTimeout(()=>{
    document.querySelectorAll('.mini[data-f]').forEach(el=>el.onclick=()=>{const f=el.dataset.f,v=el.dataset.v;document.querySelectorAll(`.mini[data-f="${f}"]`).forEach(x=>x.classList.remove('yes','no'));if(curPick[f]===v)delete curPick[f];else{curPick[f]=v;el.classList.add(v);}});
    document.querySelectorAll('.mini[data-q]').forEach(el=>el.onclick=()=>{document.querySelectorAll('.mini[data-q]').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');curQ=+el.dataset.q;});
    const sb=document.getElementById('starBtn');if(sb)sb.onclick=()=>toggleFav(id);
    const rv=$('revealForm');if(rv)rv.onclick=()=>{$('formWrap').style.display='block';rv.style.display='none';$('formWrap').scrollIntoView({behavior:'smooth',block:'nearest'});};
    const sv=$('psave');if(sv)sv.onclick=()=>{const yes=Object.keys(curPick).filter(f=>curPick[f]==='yes'),no=Object.keys(curPick).filter(f=>curPick[f]==='no');
      if(!yes.length&&!no.length&&curQ==null){alert('Отметь топливо или очередь');return;}
      const who=($('pwho').value||'').trim();localStorage.setItem('br_name',who);
      window.__db.ref('reports').push({id:curId,ts:Date.now(),who,q:curQ==null?null:curQ,cars:(function(){const v=parseInt(($('pcars').value||'').trim(),10);return isNaN(v)?null:v;})(),note:($('pnote').value||'').trim(),yes,no}).then(()=>closeSheet()).catch(e=>alert('Ошибка: '+e.message));};
  },30);
}
function closeSheet(){$('sheet').classList.remove('on');$('backdrop').classList.remove('on');clearArea();const ya=$('yamap');if(ya)ya.innerHTML='';}
window.closeSheet=closeSheet;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
window.shareAZS=function(id){const s=IDX[id];const url=`https://yandex.ru/maps/?ll=${s.lo},${s.la}&z=17&l=trf`;const rr=REPORTS[id];const cars=(rr&&rr.cars!=null)?` · ~${rr.cars} машин`:(s.q?` · ${s.q}`:'');const text=`⛽ ${s.n} — ${SLAB[s.s]||''}${s.fn?' ('+s.fn+')':''}${cars} — ${url}`;
  if(navigator.share){navigator.share({title:s.n,text});return;}window.open('https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(text),'_blank');};

window.initRealtime=function(){window.__db.ref('reports').limitToLast(4000).on('value',snap=>{const l={};snap.forEach(ch=>{const r=ch.val();if(!r||!r.id)return;if(!l[r.id]||r.ts>l[r.id].ts)l[r.id]=r;});REPORTS=l;refresh();});};

function updateSrcLabel(){if(!fetchedAt)return;const mins=Math.round((Date.now()-fetchedAt)/60000);$('src').innerHTML='обновлено '+(mins<=1?'только что':mins+' мин назад');}
setInterval(updateSrcLabel,30000);
async function loadLive(){
  try{let r;try{r=await fetch('live.json?t='+Date.now());if(!r.ok)throw 0;}catch(_){r=await fetch('https://raw.githubusercontent.com/hulapik13/info_day/master/live.json?t='+Date.now());}
    const d=await r.json();ST=d.stations||[];IDX={};ST.forEach(s=>IDX[s.id]=s);fetchedAt=Date.parse(d.fetched_at)||Date.now();
    updateSrcLabel();
    for(const id in markers)if(!IDX[id]){map.removeLayer(markers[id]);delete markers[id];}
    refresh();checkNotify();
  }catch(e){$('warn').style.display='block';$('warn').textContent='Не удалось загрузить наличие: '+e.message;}
}
function saveState(){try{localStorage.setItem('br_filters',JSON.stringify({st:[...state.st],fuel:[...state.fuel],q:state.q}));}catch(e){}}
function restoreState(){try{const d=JSON.parse(localStorage.getItem('br_filters')||'{}');
  (d.st||[]).forEach(v=>{state.st.add(v);const c=document.querySelector('#sts .chip[data-s="'+v+'"]');if(c)c.classList.add('on');});
  (d.fuel||[]).forEach(v=>{state.fuel.add(v);const c=document.querySelector('#fuels .chip[data-f="'+v+'"]');if(c)c.classList.add('on');});
  if(d.q){state.q=d.q;$('q').value=d.q;}}catch(e){}}
$('togg').onclick=()=>$('drawer').classList.toggle('open');
$('q').oninput=e=>{state.q=e.target.value;saveState();refresh();if(trafficMode)refreshLines();};
$('sts').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state.st.has(c.dataset.s)?state.st.delete(c.dataset.s):state.st.add(c.dataset.s);saveState();refresh();if(trafficMode)refreshLines();};
$('fuels').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state.fuel.has(c.dataset.f)?state.fuel.delete(c.dataset.f):state.fuel.add(c.dataset.f);saveState();refresh();if(trafficMode)refreshLines();};
$('reset').onclick=()=>{state.st.clear();state.fuel.clear();state.q='';$('q').value='';document.querySelectorAll('.chip.on').forEach(c=>c.classList.remove('on'));saveState();refresh();if(trafficMode)refreshLines();};
$('near').onclick=()=>{if(!navigator.geolocation){alert('Геолокация недоступна');return;}navigator.geolocation.getCurrentPosition(p=>{MY=[p.coords.latitude,p.coords.longitude];L.circleMarker(MY,{radius:8,color:'#fff',fillColor:'#ffb020',fillOpacity:1}).addTo(map).bindPopup('Вы здесь');map.setView(MY,14);$('drawer').classList.remove('open');drawWatch();},()=>alert('Нет доступа к геопозиции'));};
$('yandex').onclick=()=>window.open('https://yandex.ru/maps/213/moscow/?l=trf','_blank');
document.getElementById('help').onclick=function(){document.getElementById('helpPanel').classList.add('on');document.getElementById('drawer').classList.remove('open');};
document.getElementById('clearcache').onclick=async()=>{
  try{if(window.AndroidBridge&&AndroidBridge.clearCache){AndroidBridge.clearCache();}}catch(e){}
  try{if('serviceWorker' in navigator){const rs=await navigator.serviceWorker.getRegistrations();for(const r of rs)await r.unregister();}}catch(e){}
  try{if(window.caches){const ks=await caches.keys();for(const k of ks)await caches.delete(k);}}catch(e){}
  toast('Кэш очищен, обновляю…');
  setTimeout(()=>location.replace(location.pathname),500);
};

// ---- расстояние до меня ----
const KREM=[55.75216,37.61754];
function myDist(s){const o=MY||KREM;return distM(s.la,s.lo,o[0],o[1])/1000;}
// ---- список заправок ----
function openList(){
  let rows=ST.filter(visible);
  const stord={yes:0,queue:1,low:1,no:2};
  rows.forEach(s=>s._d=myDist(s));
  rows.sort((a,b)=>{
    const fa=isFav(a.id),fb=isFav(b.id);if(fa!==fb)return fb-fa;
    const ea=stord[a.s]==null?3:stord[a.s], eb=stord[b.s]==null?3:stord[b.s];
    if(ea!==eb)return ea-eb;
    if(MY)return a._d-b._d;
    return (b.sts||0)-(a.sts||0);
  });
  const body=$('listBody');
  body.innerHTML=rows.slice(0,250).map(s=>{
    const col=SCOL[s.s]||'#6b7686';
    const dist=s._d.toFixed(1)+' км '+(MY?'от вас':'от центра');
    const sub=(s.fn?'есть: '+esc(s.fn):(s.s?SLAB[s.s]:'нет данных'))+(s.q?' · 🚗 '+esc(s.q):'')+(s.sts?' · '+ago(s.sts*1000):'');
    return '<div class="li" data-id="'+s.id+'"><span class="dot" style="background:'+col+'"></span><div class="txt"><b>'+esc(s.n)+'</b> <span class="m">'+(s.b?esc(s.b)+' · ':'')+dist+'</span><div class="m">'+sub+'</div></div><span class="fav">'+(isFav(s.id)?'★':'')+'</span></div>';
  }).join('')||'<div style="padding:30px;text-align:center;color:var(--mut)">Ничего не найдено по фильтрам</div>';
  $('listPanel').classList.add('on');
}
$('listBody').onclick=e=>{const li=e.target.closest('.li');if(!li)return;$('listPanel').classList.remove('on');openSheet(li.dataset.id);};
$('list').onclick=openList;
// ---- уведомления о бензине (зона + топливо) ----
const WATCH=Object.assign({on:false,mode:'me',lat:null,lng:null,radius:5,fuels:[]},JSON.parse(localStorage.getItem('br_watch')||'{}'));
function saveWatch(){try{localStorage.setItem('br_watch',JSON.stringify(WATCH));}catch(e){}}
function watchCenter(){if(WATCH.mode==='me')return MY;if(WATCH.lat!=null)return [WATCH.lat,WATCH.lng];return null;}
let watchCircle=null,watchPin=null,pickMode=false;
function drawWatch(){
  if(watchCircle){map.removeLayer(watchCircle);watchCircle=null;}
  if(watchPin){map.removeLayer(watchPin);watchPin=null;}
  if(!WATCH.on)return;
  const ctr=watchCenter();if(!ctr)return;
  watchCircle=L.circle(ctr,{radius:WATCH.radius*1000,color:'#2b9bf4',weight:2,opacity:.9,fillColor:'#2b9bf4',fillOpacity:.18,interactive:false}).addTo(map);
  if(WATCH.mode==='point'){
    watchPin=L.marker(ctr,{draggable:true,icon:L.divIcon({className:'',iconSize:[26,26],iconAnchor:[13,13],html:'<div style="width:22px;height:22px;border-radius:50%;border:3px solid #2b9bf4;background:rgba(43,155,244,.55);box-shadow:0 0 0 2px #12141a,0 2px 6px rgba(0,0,0,.5)"></div>'})}).addTo(map);
    watchPin.on('dragend',function(){const p=watchPin.getLatLng();WATCH.lat=p.lat;WATCH.lng=p.lng;saveWatch();drawWatch();});
  }
}
map.on('click',function(e){if(pickMode){pickMode=false;WATCH.mode='point';WATCH.lat=e.latlng.lat;WATCH.lng=e.latlng.lng;saveWatch();drawWatch();openWatch();toast('Центр уведомлений установлен');}});
let prevFuels=null;
function checkNotify(){
  if(!WATCH.on){prevFuels=null;return;}
  const want=WATCH.fuels.length?WATCH.fuels:['92','95','98','100','ДТ'];
  const ctr=watchCenter();
  const cur={};for(const s of ST)cur[s.id]=new Set((s.fn||'').split(',').filter(Boolean));
  if(prevFuels){
    for(const s of ST){
      const watched=isFav(s.id)||(ctr&&distM(s.la,s.lo,ctr[0],ctr[1])<=WATCH.radius*1000);
      if(!watched)continue;
      const now=cur[s.id],was=prevFuels[s.id]||new Set();
      const app=want.filter(f=>now.has(f)&&!was.has(f));
      if(app.length)fireNotify(s,app);
    }
  }
  prevFuels=cur;
}
function fireNotify(s,fuels){
  const msg='Появился '+fuels.join(', ')+' — '+s.n+(MY?' · '+myDist(s).toFixed(1)+' км':'');
  toast('⛽ '+msg,7000);
  try{
    if(window.AndroidBridge&&AndroidBridge.notifyAt){AndroidBridge.notifyAt('⛽ Бензин-радар',msg,String(s.id),s.la,s.lo);return;}
    if(window.Notification&&Notification.permission==='granted'){
      const n=new Notification('⛽ Бензин-радар',{body:msg,icon:'icon-192.png',tag:s.id+':'+fuels.join('')});
      n.onclick=function(){try{window.focus();location.hash='s='+s.id+'&ll='+s.la+','+s.lo+',16';openSheet(s.id);}catch(e){}};
    }
  }catch(e){}
}
function renderWatch(){
  document.getElementById('wsw').classList.toggle('on',WATCH.on);
  document.getElementById('wmode-me').classList.toggle('sel',WATCH.mode==='me');
  document.getElementById('wmode-point').classList.toggle('sel',WATCH.mode==='point');
  document.getElementById('wpointrow').style.display=WATCH.mode==='point'?'block':'none';
  document.getElementById('wcoord').textContent=(WATCH.lat!=null)?('точка: '+WATCH.lat.toFixed(4)+', '+WATCH.lng.toFixed(4)):'точка не задана — нажми кнопку и тапни карту';
  document.getElementById('wradius').value=WATCH.radius;
  document.getElementById('wradval').textContent=WATCH.radius+' км';
  document.querySelectorAll('#wfuels .wopt').forEach(function(o){o.classList.toggle('sel',WATCH.fuels.includes(o.dataset.f));});
}
function openWatch(){renderWatch();document.getElementById('watchPanel').classList.add('on');}
$('notify').onclick=openWatch;
document.getElementById('wsw').onclick=function(){WATCH.on=!WATCH.on;renderWatch();};
document.getElementById('wmode-me').onclick=function(){WATCH.mode='me';renderWatch();};
document.getElementById('wmode-point').onclick=function(){WATCH.mode='point';renderWatch();};
document.getElementById('wradius').oninput=function(e){WATCH.radius=+e.target.value;document.getElementById('wradval').textContent=WATCH.radius+' км';};
document.getElementById('wfuels').onclick=function(e){const o=e.target.closest('.wopt');if(!o)return;const f=o.dataset.f;const i=WATCH.fuels.indexOf(f);if(i>=0)WATCH.fuels.splice(i,1);else WATCH.fuels.push(f);renderWatch();};
document.getElementById('wpick').onclick=function(){pickMode=true;document.getElementById('watchPanel').classList.remove('on');toast('Тапни точку на карте',5000);};
document.getElementById('wtest').onclick=function(){
  if(window.AndroidBridge&&AndroidBridge.testNotify){AndroidBridge.testNotify();toast('Тестовое уведомление придёт через 1 минуту — можешь свернуть/закрыть приложение',6000);}
  else{toast('Тест: жди 1 минуту…',5000);setTimeout(function(){fireNotify({id:'test',n:'Лукойл (тест)',la:55.7522,lo:37.6156,fn:'95'},['95']);},60000);}
};
document.getElementById('wsave').onclick=async function(){
  if(WATCH.on){try{if(window.Notification&&Notification.permission!=='granted')await Notification.requestPermission();}catch(e){}
    if(WATCH.mode==='me'&&!MY&&navigator.geolocation)navigator.geolocation.getCurrentPosition(function(p){MY=[p.coords.latitude,p.coords.longitude];drawWatch();},function(){});}
  saveWatch();prevFuels=null;
  // синхронизация с нативным фоновым сервисом (работает при закрытом приложении)
  try{if(window.AndroidBridge&&AndroidBridge.saveWatch){
    var ctr=watchCenter()||[0,0];
    AndroidBridge.saveWatch(JSON.stringify({on:WATCH.on,lat:ctr[0]||0,lng:ctr[1]||0,radius:WATCH.radius,fuels:WATCH.fuels.join(','),favs:[...FAV].join(',')}));
    if(WATCH.on&&AndroidBridge.startWatch)AndroidBridge.startWatch();
    if(!WATCH.on&&AndroidBridge.stopWatch)AndroidBridge.stopWatch();
  }}catch(e){}
  document.getElementById('watchPanel').classList.remove('on');
  $('notify').textContent=WATCH.on?'\U0001f514 Слежу ✓':'\U0001f514 Уведомления';
  drawWatch();
  toast(WATCH.on?'Слежу за зоной — пришлю пуш, когда появится топливо':'Уведомления выключены');
};
if(WATCH.on)$('notify').textContent='\U0001f514 Слежу ✓';

// ---- поделиться видом ----
$('share').onclick=()=>{
  const p=new URLSearchParams();
  if(state.fuel.size)p.set('f',[...state.fuel].join(','));
  if(state.st.size)p.set('st',[...state.st].join(','));
  if(state.q)p.set('q',state.q);
  const c=map.getCenter();p.set('ll',c.lat.toFixed(5)+','+c.lng.toFixed(5)+','+map.getZoom());
  const url=location.origin+location.pathname+'#'+p.toString();
  if(navigator.share){navigator.share({title:'Бензин-радар',url});return;}
  if(navigator.clipboard)navigator.clipboard.writeText(url).then(()=>toast('Ссылка на этот вид скопирована')).catch(()=>{});
  window.open('https://t.me/share/url?url='+encodeURIComponent(url),'_blank');
};
// ---- применить состояние из ссылки ----
function applyHash(){
  try{
    if(!location.hash)return;
    const h=new URLSearchParams(location.hash.slice(1));
    (h.get('f')||'').split(',').forEach(v=>{if(v){state.fuel.add(v);const c=document.querySelector('#fuels .chip[data-f="'+v+'"]');if(c)c.classList.add('on');}});
    (h.get('st')||'').split(',').forEach(v=>{if(v){state.st.add(v);const c=document.querySelector('#sts .chip[data-s="'+v+'"]');if(c)c.classList.add('on');}});
    if(h.get('q')){state.q=h.get('q');$('q').value=state.q;}
    if(h.get('ll')){const a=h.get('ll').split(',').map(Number);if(a[0])map.setView([a[0],a[1]],a[2]||15);}
    const sid=h.get('s');
    if(sid){let n=0;const t=setInterval(()=>{if(IDX[sid]){clearInterval(t);openSheet(sid);}else if(++n>40)clearInterval(t);},300);}
    if(location.hash)history.replaceState(null,'',location.pathname);
  }catch(e){}
}


restoreState();
applyHash();

const RADIUS=150; // метры: только дорога у заезда на АЗС
function distM(la1,lo1,la2,lo2){return Math.hypot((la1-la2)*111320,(lo1-lo2)*111320*Math.cos(la1*Math.PI/180));}
function clipRuns(coords,la,lo,m){const runs=[];let cur=[];for(const p of coords){if(distM(p[0],p[1],la,lo)<=m)cur.push(p);else{if(cur.length>1)runs.push(cur);cur=[];}}if(cur.length>1)runs.push(cur);return runs;}
// ---- пробки вокруг АЗС (радиус RADIUS) ----
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
  L.circle([la,lo],{radius:RADIUS,color:'#ffb020',weight:1.5,opacity:.6,fill:false,dashArray:'4 6',interactive:false,renderer:trafficRenderer}).addTo(focusLayer);
  const f=await fetchPoint(la,lo);
  if(!f||!f.coords||f.coords.length<2||curId!==id)return f?[f]:[];
  const c=congColor(f);
  clipRuns(f.coords,la,lo,RADIUS).forEach(run=>{
    L.polyline(run,{color:'#0b0d12',weight:9,opacity:.5,interactive:false,renderer:trafficRenderer}).addTo(focusLayer);
    L.polyline(run,{color:c,weight:6,opacity:.97,lineCap:'round',interactive:false,renderer:trafficRenderer}).addTo(focusLayer);
  });
  return [f];
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
    const b=map.getBounds();const vis=ST.filter(s=>b.contains([s.la,s.lo])&&visible(s)).slice(0,25);
    const visIds=new Set(vis.map(s=>s.id));
    for(const k in lines){if(!visIds.has(k)){lineLayer.removeLayer(lines[k]);delete lines[k];}}
    await Promise.all(vis.map(async s=>{
      const f=await fetchFlow(s.id,s.la,s.lo);const c=congColor(f);if(!c||!f.coords||f.coords.length<2)return;
      if(lines[s.id])lineLayer.removeLayer(lines[s.id]);
      const runs=clipRuns(f.coords,s.la,s.lo,RADIUS);if(!runs.length)return;
      const g=L.layerGroup();
      runs.forEach(run=>{g.addLayer(L.polyline(run,{color:'#0b0d12',weight:9,opacity:.5,lineCap:'round',lineJoin:'round',interactive:false,renderer:trafficRenderer}));g.addLayer(L.polyline(run,{color:c,weight:5,opacity:.95,lineCap:'round',lineJoin:'round',interactive:false,renderer:trafficRenderer}));});
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
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadLive();});
window.addEventListener('focus',()=>loadLive());
drawWatch();
setTimeout(()=>map.invalidateSize(),200);
window.addEventListener('resize',()=>map.invalidateSize());

const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const map=L.map('map',{preferCanvas:true}).setView([55.75,37.62],10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap · наличие © ГдеБенз (gdebenz.ru)'}).addTo(map);
const canvas=L.canvas({padding:.5});

let ST=[];               // станции из live.json (gdebenz)
let IDX={};              // osm_id -> station
let REPORTS={};          // osm_id -> последний отчёт друзей
let MY=null, fetchedAt=0;
const markers={};        // osm_id -> circleMarker
const state={st:new Set(),fuel:new Set(),q:''};

const SCOL={yes:'#28c76f',queue:'#ffc63d',low:'#ff8a3d',no:'#ff5a5a'};
const SLAB={yes:'🟢 есть',queue:'🟡 очередь',low:'🟠 мало',no:'🔴 нет топлива'};
function ago(ts){const s=(Date.now()-ts)/1000;if(s<90)return 'только что';if(s<3600)return Math.round(s/60)+' мин назад';if(s<86400)return Math.round(s/3600)+' ч назад';return Math.round(s/86400)+' дн назад';}
function parseT(t){return t?Date.parse(t.replace(' ','T')+'Z'):0;}
function qlabel(q){return ['нет очереди','очередь небольшая','очередь большая','очередь час+'][q]||'';}

// «самое свежее по каждой АЗС»: сравниваем снимок gdebenz и отчёт друзей
function effective(s){
  const r=REPORTS[s.id];
  // время gdebenz-статуса: макс из времени цен, иначе fetchedAt
  let gt=fetchedAt;for(const f in (s.pr||{})){const t=parseT(s.pr[f].t);if(t>gt)gt=t;}
  const gStatus=s.s; // yes/queue/low/no/null
  if(r&&r.ts>gt){ // отчёт друга свежее
    let col=r.yes&&r.yes.length?'#28c76f':(r.no&&r.no.length?'#ff5a5a':'#ffc63d');
    if(r.q>=2&&r.yes&&r.yes.length)col='#ffc63d';
    return {col,src:'friend',r,gStatus,gt};
  }
  return {col:SCOL[gStatus]||'#6b7686',src:'gdebenz',r,gStatus,gt};
}
function visible(s){
  const eff=effective(s);
  if(state.st.size){ // фильтр по статусу — по gdebenz-статусу
    if(!s.s||!state.st.has(s.s))return false;
  }
  if(state.fuel.size){const fn=(s.fn||'').split(',');if(![...state.fuel].every(f=>fn.includes(f)))return false;}
  if(state.q){const t=(s.n+' '+s.b+' '+s.ad).toLowerCase();if(!t.includes(state.q.toLowerCase()))return false;}
  return true;
}
function refresh(){
  let shown=0,fresh=0,frnd=0;
  for(const s of ST){
    const vis=visible(s);
    if(!vis){if(markers[s.id]){map.removeLayer(markers[s.id]);delete markers[s.id];}continue;}
    shown++;
    const eff=effective(s);
    if(eff.src==='friend'){frnd++;}
    if(REPORTS[s.id]&&Date.now()-REPORTS[s.id].ts<3600e3)fresh++;
    const hasFriend=REPORTS[s.id]&&Date.now()-REPORTS[s.id].ts<3600e3;
    const rad=s.s&&s.s!=='no'?6:(s.s?5:4);
    if(!markers[s.id]){
      markers[s.id]=L.circleMarker([s.la,s.lo],{renderer:canvas,radius:rad,weight:hasFriend?2.5:1,
        color:hasFriend?'#2b9bf4':'#0b0d12',fillColor:eff.col,fillOpacity:s.s?.9:.5})
        .on('click',()=>openPopup(s.id)).addTo(map);
    }else{markers[s.id].setStyle({radius:rad,fillColor:eff.col,weight:hasFriend?2.5:1,color:hasFriend?'#2b9bf4':'#0b0d12',fillOpacity:s.s?.9:.5});}
  }
  $('stat').textContent=`Показано ${shown} из ${ST.length} · отметок друзей свежих ${fresh}`;
  $('livecnt').textContent=window.__fbReady?(fresh+' отметок друзей'):'слой друзей: подключается…';
}

let curPick={},curQ=null,curId=null;
function openPopup(id){
  const s=IDX[id];if(!s)return;curPick={};curQ=null;curId=id;
  const eff=effective(s),r=REPORTS[id];
  // блок gdebenz
  let live=`<div style="margin:5px 0"><span class="badge ${s.s==='yes'?'g':s.s==='no'?'r':s.s==='low'?'o':'y'}">${esc(SLAB[s.s]||'нет данных наличия')}</span></div>`;
  if(s.fn)live+=`<div style="font-size:12px;color:var(--mut)">есть: ${esc(s.fn)}</div>`;
  const pr=s.pr||{};const keys=Object.keys(pr);
  if(keys.length){
    let t0=0;live+='<table class="price">';
    keys.forEach(f=>{live+=`<tr><td>${esc(f)}</td><td>${pr[f].p} ₽</td></tr>`;const t=parseT(pr[f].t);if(t>t0)t0=t;});
    live+='</table>';if(t0)live+=`<div style="font-size:11px;color:var(--mut)">цены обновлены ${ago(t0)}</div>`;
  }
  live=`<div style="border-left:3px solid ${SCOL[s.s]||'#6b7686'};padding-left:8px;margin:6px 0">
    <div style="font-size:11px;color:var(--mut)">НАЛИЧИЕ · ГдеБенз</div>${live}</div>`;
  // блок друзей
  let fr='';
  if(r){let b='';(r.yes||[]).forEach(f=>b+=`<span class="badge g">🟢 ${esc(f)}</span>`);(r.no||[]).forEach(f=>b+=`<span class="badge r">🔴 ${esc(f)}</span>`);if(r.q!=null)b+=`<span class="badge y">${esc(qlabel(r.q))}</span>`;
    fr=`<div style="border-left:3px solid #2b9bf4;padding-left:8px;margin:6px 0"><div style="font-size:11px;color:var(--mut)">ОТМЕТКА ДРУЗЕЙ · ${ago(r.ts)}${r.who?' · '+esc(r.who):''}</div><div>${b}</div>${r.note?'<div style="font-size:11px;color:var(--mut)">«'+esc(r.note)+'»</div>':''}</div>`;}
  const winner=eff.src==='friend'?'свежее — у друзей':'свежее — у ГдеБенз';
  const fuelset=(s.fn?s.fn.split(','):['92','95','98','ДТ']).filter(x=>['92','95','98','100','ДТ','газ'].includes(x));
  const fbOn=window.__fbReady;
  const form=fbOn?`<div class="frm"><div style="font-size:11px;color:var(--mut);margin-bottom:4px">СВОЯ ОТМЕТКА</div>
     ${(fuelset.length?fuelset:['92','95','98','ДТ']).map(f=>`<div class="fuelrow"><span class="fn">${esc(f)}</span>
       <span class="mini" data-f="${esc(f)}" data-v="yes">есть</span><span class="mini" data-f="${esc(f)}" data-v="no">нет</span></div>`).join('')}
     <div style="margin:6px 0"><span class="mini" data-q="0">оч:нет</span> <span class="mini" data-q="1">неб.</span> <span class="mini" data-q="2">больш.</span> <span class="mini" data-q="3">час+</span></div>
     <input type="text" id="pnote" placeholder="коммент (лимит, цена)" maxlength="80" style="margin:4px 0">
     <input type="text" id="pwho" placeholder="имя" maxlength="20" value="${esc(localStorage.getItem('br_name')||'')}" style="margin:4px 0">
     <button class="primary" id="psave" style="width:100%;margin-top:4px">Опубликовать друзьям</button></div>`:'';
  const html=`<b>${esc(s.n)}</b><br><span style="color:var(--mut);font-size:12px">${s.b?esc(s.b)+' · ':''}${esc(s.ad||'')}</span>
    ${live}${fr}<div style="font-size:11px;color:var(--acc)">▸ ${winner}</div>
    <div style="margin:6px 0"><a href="https://gdebenz.ru/" target="_blank">ГдеБенз</a> · <a href="https://yandex.ru/maps/?ll=${s.lo},${s.la}&z=17&l=trf" target="_blank">🚗 пробки</a> · <a href="https://yandex.ru/maps/?rtext=~${s.la},${s.lo}&rtt=auto" target="_blank">🧭</a> · <a href="#" onclick="shareAZS('${id}');return false">📤</a></div>
    ${form}`;
  L.popup({maxWidth:290}).setLatLng([s.la,s.lo]).setContent(html).openOn(map);
  setTimeout(()=>{
    document.querySelectorAll('.mini[data-f]').forEach(el=>el.onclick=()=>{const f=el.dataset.f,v=el.dataset.v;
      document.querySelectorAll(`.mini[data-f="${f}"]`).forEach(x=>x.classList.remove('yes','no'));
      if(curPick[f]===v)delete curPick[f];else{curPick[f]=v;el.classList.add(v);}});
    document.querySelectorAll('.mini[data-q]').forEach(el=>el.onclick=()=>{document.querySelectorAll('.mini[data-q]').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');curQ=+el.dataset.q;});
    const sv=$('psave');if(sv)sv.onclick=()=>{
      const yes=Object.keys(curPick).filter(f=>curPick[f]==='yes'),no=Object.keys(curPick).filter(f=>curPick[f]==='no');
      if(!yes.length&&!no.length&&curQ==null){alert('Отметь топливо или очередь');return;}
      const who=($('pwho').value||'').trim();localStorage.setItem('br_name',who);
      window.__db.ref('reports').push({id:curId,ts:Date.now(),who,q:curQ==null?null:curQ,note:($('pnote').value||'').trim(),yes,no})
        .then(()=>map.closePopup()).catch(e=>alert('Ошибка: '+e.message));
    };
  },30);
}
window.shareAZS=function(id){const s=IDX[id];const url=`https://yandex.ru/maps/?ll=${s.lo},${s.la}&z=17&l=trf`;
  const st=SLAB[s.s]||'';const text=`⛽ ${s.n} — ${st}${s.fn?' ('+s.fn+')':''} — ${url}`;
  if(navigator.share){navigator.share({title:s.n,text});return;}window.open('https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(text),'_blank');};

window.initRealtime=function(){window.__db.ref('reports').limitToLast(4000).on('value',snap=>{
  const latest={};snap.forEach(ch=>{const r=ch.val();if(!r||!r.id)return;if(!latest[r.id]||r.ts>latest[r.id].ts)latest[r.id]=r;});
  REPORTS=latest;refresh();});};

// ---- загрузка живого снимка наличия ----
async function loadLive(){
  try{
    const RAW='https://raw.githubusercontent.com/hulapik13/info_day/master/live.json';let r;try{r=await fetch(RAW+'?t='+Date.now());if(!r.ok)throw 0;}catch(_){r=await fetch('live.json?t='+Date.now());}const d=await r.json();
    ST=d.stations||[];IDX={};ST.forEach(s=>IDX[s.id]=s);fetchedAt=Date.parse(d.fetched_at)||Date.now();
    const mins=Math.round((Date.now()-fetchedAt)/60000);
    $('src').textContent=`наличие © ГдеБенз · обновлено ${mins<=1?'только что':mins+' мин назад'} · парсинг ~5 мин`;
    // почистим маркеры, которых больше нет
    for(const id in markers){if(!IDX[id]){map.removeLayer(markers[id]);delete markers[id];}}
    refresh();
  }catch(e){$('warn').style.display='block';$('warn').textContent='⚠️ Не удалось загрузить снимок наличия (live.json): '+e.message;}
}

$('q').oninput=e=>{state.q=e.target.value;refresh();};
$('sts').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state.st.has(c.dataset.s)?state.st.delete(c.dataset.s):state.st.add(c.dataset.s);refresh();};
$('fuels').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state.fuel.has(c.dataset.f)?state.fuel.delete(c.dataset.f):state.fuel.add(c.dataset.f);refresh();};
$('reset').onclick=()=>{state.st.clear();state.fuel.clear();state.q='';$('q').value='';document.querySelectorAll('.chip.on').forEach(c=>c.classList.remove('on'));refresh();};
$('near').onclick=()=>{if(!navigator.geolocation){alert('Геолокация недоступна');return;}
  navigator.geolocation.getCurrentPosition(p=>{MY=[p.coords.latitude,p.coords.longitude];L.circleMarker(MY,{radius:7,color:'#fff',fillColor:'#ffb020',fillOpacity:1}).addTo(map).bindPopup('Вы здесь');map.setView(MY,13);},()=>alert('Нет доступа к геопозиции'));};
$('yandex').onclick=()=>window.open('https://yandex.ru/maps/213/moscow/?l=trf','_blank');

loadLive();
setInterval(loadLive,180000); // каждые 3 минуты перечитываем снимок

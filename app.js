const AZS = window.AZS;
const FUELS=['92','95','98','ДТ','газ'];
const KREM=[55.75216,37.61754];
const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

const map=L.map('map',{preferCanvas:true}).setView([55.75,37.62],10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
const canvas=L.canvas({padding:.5});

let REPORTS={};   // station index -> latest report {ts,who,yes[],no[],q,note}
let MY=null;
const state={fuel:new Set(),rep:false,has:false,fresh:false,q:''};
const markers=new Array(AZS.length);

function ago(ts){const s=(Date.now()-ts)/1000;if(s<90)return 'только что';if(s<3600)return Math.round(s/60)+' мин назад';if(s<86400)return Math.round(s/3600)+' ч назад';return Math.round(s/86400)+' дн назад';}
function qlabel(q){return ['нет очереди','очередь небольшая','очередь большая','очередь час+'][q]||'';}
function statusColor(i){
  const r=REPORTS[i];
  if(!r)return {c:'#6b7686',rad:4,op:.5};
  const fresh=Date.now()-r.ts<3600e3;
  let c='#ffc63d';
  if(r.yes&&r.yes.length)c='#28c76f';
  if(r.no&&r.no.length&&!(r.yes&&r.yes.length))c='#ff5a5a';
  if(r.q>=2&&r.yes&&r.yes.length)c='#ffc63d';
  return {c,rad:fresh?8:6,op:fresh?1:.7};
}
function visible(i){
  const a=AZS[i],r=REPORTS[i];
  if(state.fuel.size&&![...state.fuel].every(f=>a.f.includes(f)))return false;
  if(state.rep&&!r)return false;
  if(state.has&&!(r&&r.yes&&r.yes.length))return false;
  if(state.fresh&&!(r&&Date.now()-r.ts<3600e3))return false;
  if(state.q){const s=(a.n+' '+a.b).toLowerCase();if(!s.includes(state.q.toLowerCase()))return false;}
  return true;
}
function refresh(){
  let shown=0,rep=0,fresh=0;
  for(let i=0;i<AZS.length;i++){
    const vis=visible(i);const a=AZS[i];
    if(REPORTS[i]){rep++;if(Date.now()-REPORTS[i].ts<3600e3)fresh++;}
    if(!vis){if(markers[i]){map.removeLayer(markers[i]);markers[i]=null;}continue;}
    shown++;
    const st=statusColor(i);
    if(!markers[i]){
      markers[i]=L.circleMarker([a.la,a.lo],{renderer:canvas,radius:st.rad,color:'#0b0d12',weight:1,fillColor:st.c,fillOpacity:st.op})
        .on('click',()=>openPopup(i)).addTo(map);
    }else{markers[i].setStyle({radius:st.rad,fillColor:st.c,fillOpacity:st.op});}
  }
  $('stat').textContent=`Показано ${shown} из ${AZS.length} · с отметками ${rep} · свежих ${fresh}`;
  $('livecnt').textContent=window.__fbReady?(fresh+' свежих отметок'):'база не подключена';
}

let curPick={};
function openPopup(i){
  const a=AZS[i],r=REPORTS[i];curPick={};let curQ=r?r.q:null;
  let badges='';
  if(r){
    (r.yes||[]).forEach(f=>badges+=`<span class="badge g">🟢 ${esc(f)} есть</span>`);
    (r.no||[]).forEach(f=>badges+=`<span class="badge r">🔴 ${esc(f)} нет</span>`);
    if(r.q!=null)badges+=`<span class="badge y">${esc(qlabel(r.q))}</span>`;
    badges=`<div style="margin:5px 0">${badges}</div><div style="color:var(--mut);font-size:11px">🕐 ${ago(r.ts)}${r.who?' · '+esc(r.who):''}${r.note?' · «'+esc(r.note)+'»':''}</div>`;
  }
  const fuelset=a.f.length?a.f:FUELS;
  const fbOn=window.__fbReady;
  const form=fbOn?`<div class="frm"><div style="font-size:11px;color:var(--mut);margin-bottom:4px">ОТМЕТИТЬ СТАТУС</div>
     ${fuelset.map(f=>`<div class="fuelrow"><span class="fn">${esc(f)}</span>
       <span class="mini" data-f="${esc(f)}" data-v="yes">есть</span>
       <span class="mini" data-f="${esc(f)}" data-v="no">нет</span></div>`).join('')}
     <div style="margin:6px 0"><span class="mini" data-q="0">оч:нет</span> <span class="mini" data-q="1">неб.</span> <span class="mini" data-q="2">больш.</span> <span class="mini" data-q="3">час+</span></div>
     <input type="text" id="pnote" placeholder="коммент (лимит, цена)" maxlength="80" style="margin:4px 0">
     <input type="text" id="pwho" placeholder="имя" maxlength="20" value="${esc(localStorage.getItem('br_name')||'')}" style="margin:4px 0">
     <button class="primary" id="psave" style="width:100%;margin-top:4px">Опубликовать</button></div>`
    :`<div class="frm" style="color:var(--mut);font-size:12px">База отметок не подключена — отметить нельзя.</div>`;
  const html=`<b>${esc(a.n)}</b><br><span style="color:var(--mut);font-size:12px">${a.b?esc(a.b)+' · ':''}${a.d} км от центра · ${a.a}${a.f.length?' · '+a.f.join('/'):''}</span>
    ${badges}
    <div style="margin:6px 0"><a href="https://yandex.ru/maps/?ll=${a.lo},${a.la}&z=17&l=trf" target="_blank">🚗 пробки</a> · <a href="https://yandex.ru/maps/?rtext=~${a.la},${a.lo}&rtt=auto" target="_blank">🧭 маршрут</a> · <a href="#" onclick="shareAZS(${i});return false">📤</a></div>
    ${form}`;
  const p=L.popup({maxWidth:280}).setLatLng([a.la,a.lo]).setContent(html).openOn(map);
  setTimeout(()=>{
    document.querySelectorAll('.mini[data-f]').forEach(el=>el.onclick=()=>{
      const f=el.dataset.f,v=el.dataset.v;
      document.querySelectorAll(`.mini[data-f="${f}"]`).forEach(x=>x.classList.remove('yes','no'));
      if(curPick[f]===v)delete curPick[f];else{curPick[f]=v;el.classList.add(v);}
    });
    document.querySelectorAll('.mini[data-q]').forEach(el=>el.onclick=()=>{
      document.querySelectorAll('.mini[data-q]').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');curQ=+el.dataset.q;});
    const sv=$('psave');if(sv)sv.onclick=()=>{
      const yes=Object.keys(curPick).filter(f=>curPick[f]==='yes');
      const no=Object.keys(curPick).filter(f=>curPick[f]==='no');
      if(!yes.length&&!no.length&&curQ==null){alert('Отметь топливо или очередь');return;}
      const who=($('pwho').value||'').trim();localStorage.setItem('br_name',who);
      const rec={st:i,ts:Date.now(),who,q:curQ==null?null:curQ,note:($('pnote').value||'').trim(),yes,no};
      window.__db.ref('reports').push(rec).then(()=>map.closePopup()).catch(e=>alert('Ошибка отправки: '+e.message));
    };
  },30);
}

window.shareAZS=function(i){
  const a=AZS[i];const url=`https://yandex.ru/maps/?ll=${a.lo},${a.la}&z=17&l=trf`;
  const r=REPORTS[i];let st='';if(r){st=(r.yes&&r.yes.length?'есть '+r.yes.join('/'):(r.no&&r.no.length?'нет '+r.no.join('/'):''));if(r.q!=null)st+=(st?', ':'')+qlabel(r.q);}
  const text=`⛽ ${a.n} ${st?'— '+st:''} — ${url}`;
  if(navigator.share){navigator.share({title:a.n,text});return;}
  window.open('https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(text),'_blank');
};

// ---- realtime: слушаем всю ветку reports, берём последний по станции ----
window.initRealtime=function(){
  window.__db.ref('reports').limitToLast(3000).on('value',snap=>{
    const latest={};
    snap.forEach(ch=>{const r=ch.val();if(!r||r.st==null)return;if(!latest[r.st]||r.ts>latest[r.st].ts)latest[r.st]=r;});
    REPORTS=latest;refresh();
  });
};

// ---- контролы ----
$('q').oninput=e=>{state.q=e.target.value;refresh();};
$('fuels').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state.fuel.has(c.dataset.f)?state.fuel.delete(c.dataset.f):state.fuel.add(c.dataset.f);refresh();};
$('show').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;c.classList.toggle('on');state[c.dataset.k]=!state[c.dataset.k];refresh();};
$('reset').onclick=()=>{state.fuel.clear();state.rep=state.has=state.fresh=false;state.q='';$('q').value='';document.querySelectorAll('.chip.on').forEach(c=>c.classList.remove('on'));refresh();};
$('near').onclick=()=>{if(!navigator.geolocation){alert('Геолокация недоступна');return;}
  navigator.geolocation.getCurrentPosition(p=>{MY=[p.coords.latitude,p.coords.longitude];L.circleMarker(MY,{radius:7,color:'#fff',fillColor:'#ffb020',fillOpacity:1}).addTo(map).bindPopup('Вы здесь');map.setView(MY,13);},()=>alert('Нет доступа к геопозиции'));};
$('yandex').onclick=()=>window.open('https://yandex.ru/maps/213/moscow/?l=trf','_blank');

refresh(); // первичная отрисовка (без отметок, пока БД грузится)

import json,sys,math,datetime,time

def load(p):
    try:
        d=json.load(open(p))
        return d.get('stations',d) if isinstance(d,dict) else d
    except Exception as e:
        sys.stderr.write(f"warn: {p}: {e}\n");return []

g0=load('src_gdebenz.json')   # gdebenz.org: osm_id,name,brand,lat,lon,addr,status,fuels_now,prices_now
g1=load('src_gdebenzi.json')  # gdebenzi.ru: id,name,lat,lon,status,fuelsYes/No/Maybe,queueTxt,markts,prices,limits
ar=load('src_azsradar.json')  # азсрадар
br=load('src_benzrf.json')    # benzrf.ru: lat,lng,status,fuelTypes,limitLiters,lastReportAt (+T-Bank)

NOW=int(time.time())
def isots(s):
    try:return datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
    except:return 0

LBL={'АИ-92':'92','АИ-95':'95','АИ-98':'98','АИ-100':'100','ДТ':'ДТ','ДТ-З':'ДТ'}
PKEY={'ai92':'92','ai95':'95','ai98':'98','ai100':'100','dt':'ДТ','gas':'газ'}
AKEY={'AI-92':'92','AI-95':'95','AI-98':'98','AI-100':'100','DT':'ДТ'}
def nlbl(x):return LBL.get(x,x)

# пространственный индекс
def cell(la,lo):return (round(la,3),round(lo,3))
def build(idx_list,latk,lok):
    g={}
    for o in idx_list:
        la=o.get(latk);lo=o.get(lok)
        if la is None or lo is None:continue
        g.setdefault(cell(la,lo),[]).append(o)
    return g
G1=build(g1,'lat','lon'); AR=build(ar,'latitude','longitude'); BR=build(br,'lat','lng')
def near(g,la,lo,latk,lok,lim=70):
    best=None;bd=lim
    for dla in(-1,0,1):
        for dlo in(-1,0,1):
            for o in g.get((round(la,3)+dla*0.001,round(lo,3)+dlo*0.001),[]):
                d=math.hypot((o[latk]-la)*111320,(o[lok]-lo)*111320*math.cos(math.radians(la)))
                if d<bd:bd=d;best=o
    return best

out=[]
used1=set();usedA=set();usedB=set()
BST={'available':'yes','limited':'low','none':'no','unknown':None}
for s in g0:
    la,lo=s['lat'],s['lon']
    m1=near(G1,la,lo,'lat','lon'); a=near(AR,la,lo,'latitude','longitude')
    if m1:used1.add(id(m1))
    if a:usedA.add(id(a))
    b=near(BR,la,lo,'lat','lng')
    if b:usedB.add(id(b))
    cand=[]
    if m1 and m1.get('status'): cand.append((m1['status'], int(m1.get('markts') or 0), 'gdebenzi'))
    if a:
        am={'ok':'yes','empty':'no'}.get(a.get('status'))
        if am: cand.append((am, int(isots(a.get('status_updated_at') or '')), 'азсрадар'))
    if b:
        bm=BST.get(b.get('status'))
        if bm: cand.append((bm, int((b.get('lastReportAt') or 0)/1000), 'benzrf'))
    cand=[c for c in cand if c[1]>0]
    st=s.get('status'); sts=None; stssrc=('gdebenz' if st else None)
    if cand:
        best=max(cand,key=lambda c:c[1])
        if (not st) or (NOW-best[1] < 12*3600):
            st=best[0]; sts=best[1]; stssrc=best[2]
    # очередь в машинах
    q=None;qsrc=None
    if m1 and m1.get('queueTxt'):q=m1['queueTxt'];qsrc='gdebenzi'
    elif a and a.get('queue_size') and a['queue_size'] not in ('Нет',None):q='очередь '+a['queue_size'];qsrc='азсрадар'
    # доступное топливо
    avail=set([x for x in (s.get('fuels_now') or '').split(',') if x])
    no=set()
    if m1:
        for f in (m1.get('fuelsYes') or []):avail.add(nlbl(f))
        for f in (m1.get('fuelsNo') or []):no.add(nlbl(f))
    if a:
        for k,v in (a.get('fuel_statuses') or {}).items():
            fk=AKEY.get(k)
            if fk and v=='ok':avail.add(fk)
            if fk and v=='empty':no.add(fk)
    if b:
        for f in (b.get('fuelTypes') or []):
            fk=PKEY.get(f)
            if fk:avail.add(fk)
    no-=avail
    # цены (g0 приоритет, добираем из gdebenzi)
    pr=dict(s.get('prices_now') or {})
    if m1:
        for k,v in (m1.get('prices') or {}).items():
            fk=PKEY.get(k)
            if fk and fk not in pr and v:pr[fk]={'p':v,'t':None,'n':None}
    # лимиты
    lim=None
    if m1 and m1.get('limits'):
        lim={nlbl(k):v for k,v in m1['limits'].items()}
    if lim is None and b and b.get('limitLiters'):
        lim={'все':b['limitLiters']}
    conf=None;nrep=None
    if m1:
        if m1.get('confPct') is not None:conf=m1['confPct']
        nrep=m1.get('reports') or m1.get('metki')
    if conf is None and a and a.get('confidence_percent') is not None:conf=a['confidence_percent']
    srcs=['gdebenz']+(['gdebenzi'] if m1 else [])+(['азсрадар'] if a else [])+(['benzrf'] if b else [])
    out.append({'id':s['osm_id'],'n':s.get('name') or 'АЗС','b':s.get('brand') or '',
                'la':round(la,6),'lo':round(lo,6),'ad':s.get('addr') or '',
                's':st,'fn':','.join([f for f in ['92','95','98','100','ДТ','газ'] if f in avail]),
                'no':','.join([f for f in ['92','95','98','100','ДТ','газ'] if f in no]),
                'q':q,'qsrc':qsrc,'sts':sts,'stssrc':stssrc,'conf':conf,'nrep':nrep,'lim':lim,'pr':pr,'src':srcs})

# добавим станции из gdebenzi/азсрадар, которых нет в базе, но со свежим реальным статусом
def add_extra(lst,latk,lok,getst,getname,used,srcname):
    cnt=0
    base_idx=build(out,'la','lo')
    for o in lst:
        if id(o) in used:continue
        la=o.get(latk);lo=o.get(lok)
        if la is None or lo is None:continue
        st=getst(o)
        if not st:continue
        if near(base_idx,la,lo,'la','lo',60):continue
        out.append({'id':srcname+':'+str(o.get('id')),'n':getname(o) or 'АЗС','b':o.get('brand') or '',
                    'la':round(la,6),'lo':round(lo,6),'ad':o.get('address') or '',
                    's':st,'fn':'','no':'','q':(o.get('queueTxt') if srcname=='gdebenzi' else None),
                    'qsrc':srcname,'sts':int(o.get('markts')) if o.get('markts') else None,'stssrc':srcname,'lim':None,'pr':{},'src':[srcname]})
        base_idx.setdefault(cell(la,lo),[]).append(out[-1]);cnt+=1
    return cnt
e1=add_extra(g1,'lat','lon',lambda o:o.get('status') if (NOW-(o.get('markts') or 0)<12*3600) else None,lambda o:o.get('name'),used1,'gdebenzi')

res={'fetched_at':datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
     'sources':['gdebenz.ru','gdebenzi.ru','азсрадар.рф','benzrf.ru'],'stations':out}
json.dump(res,open('live.json','w'),ensure_ascii=False,separators=(',',':'))
withq=sum(1 for x in out if x['q']); wl=sum(1 for x in out if x['lim'])
print(f"итого станций: {len(out)} (+{e1} только из gdebenzi) | с очередью-в-машинах: {withq} | с лимитами: {wl}")

import json,sys,math,datetime,time

def load(p):
    try:
        d=json.load(open(p))
        r=d.get('stations',d) if isinstance(d,dict) else d
        if not isinstance(r,list): 
            sys.stderr.write(f"warn: {p}: не список станций, пропускаю\n");return []
        return [x for x in r if isinstance(x,dict)]
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
def bucket(x):
    if x in ('yes','available','ok'): return 'y'
    if x in ('no','none','empty'): return 'n'
    if x in ('queue','low','limited'): return 'p'
    return None
def decay(age):
    if age is None: return 0.35
    m=age/60.0
    if m<=30: return 1.0
    if m<=120: return 0.6
    if m<=360: return 0.3
    return 0.1
WK={'tbank-confirmed':3.0,'tbank':2.0,'gdebenzi':2.0,'benzrf':1.0,'азсрадар':1.0,'gdebenz':1.0}
CANON={'y':'yes','n':'no','p':'low'}

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
    # взвешенное голосование: доверие(источник) x свежесть(время)
    cands=[]
    if s.get('status'): cands.append((bucket(s['status']), None, 'gdebenz'))
    if m1 and m1.get('status'):
        mt=int(m1['markts']) if m1.get('markts') else None
        cands.append((bucket(m1['status']), (NOW-mt) if mt else None, 'gdebenzi'))
    if a:
        am={'ok':'yes','empty':'no'}.get(a.get('status'))
        if am:
            at=int(isots(a.get('status_updated_at') or '')) or None
            cands.append((bucket(am), (NOW-at) if at else None, 'азсрадар'))
    if b:
        bm=BST.get(b.get('status'))
        if bm:
            kind=b.get('statusSource') if b.get('statusSource') in ('tbank','tbank-confirmed') else 'benzrf'
            bt=int((b.get('lastReportAt') or 0)/1000) or None
            cands.append((bucket(bm), (NOW-bt) if bt else None, kind))
    cands=[c for c in cands if c[0]]
    score={}
    for bk,age,kind in cands:
        w=WK.get(kind,1.0)*decay(age)
        e=score.setdefault(bk,[0.0,kind,age if age is not None else 10**9])
        e[0]+=w
        a2=age if age is not None else 10**9
        if a2<e[2]: e[2]=a2; e[1]=kind
    st=None; sts=None; stssrc=None; weak=True; frac=0.0; totw=0.0
    if score:
        totw=sum(v[0] for v in score.values())
        best_bk=max(score,key=lambda k:score[k][0]); e=score[best_bk]
        st=CANON[best_bk]; stssrc=e[1]
        if e[2]<10**9: sts=NOW-e[2]
        frac=(e[0]/totw) if totw else 0.0
        weak=e[0]<0.7
    if stssrc in ('tbank','tbank-confirmed'): stssrc='benzrf'
    tbank=bool(b and b.get('statusSource') in ('tbank','tbank-confirmed'))
    ageMin=int((NOW-sts)/60) if sts else None
    # уровень по свежести: <=45м высокая, <=90м средняя, <=150м слабая, старше — устарело
    if ageMin is None: lvl='stale'
    elif ageMin<=45: lvl='high'
    elif ageMin<=90: lvl='mid'
    elif ageMin<=150: lvl='low'
    else: lvl='stale'
    order=['stale','low','mid','high']
    if frac and frac<0.6 and lvl in ('high','mid','low'): lvl=order[max(0,order.index(lvl)-1)]
    if not st: lvl='none'
    weak=lvl in ('stale','low','none')
    rel={'lvl':lvl,'total':len(cands),'tbank':tbank,'ageMin':ageMin,'weak':weak}
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
                'q':q,'qsrc':qsrc,'sts':sts,'stssrc':stssrc,'conf':conf,'nrep':nrep,'rel':rel,'lim':lim,'pr':pr,'src':srcs})

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
                    'qsrc':srcname,'sts':int(o.get('markts')) if o.get('markts') else None,'stssrc':srcname,'lim':None,'pr':{},'conf':None,'nrep':None,'rel':{'lvl':'low','total':1,'tbank':False,'ageMin':None,'weak':True},'src':[srcname]})
        base_idx.setdefault(cell(la,lo),[]).append(out[-1]);cnt+=1
    return cnt
e1=add_extra(g1,'lat','lon',lambda o:o.get('status') if (NOW-(o.get('markts') or 0)<12*3600) else None,lambda o:o.get('name'),used1,'gdebenzi')

res={'fetched_at':datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
     'sources':['gdebenz.ru','gdebenzi.ru','азсрадар.рф','benzrf.ru'],'stations':out}
json.dump(res,open('live.json','w'),ensure_ascii=False,separators=(',',':'))
withq=sum(1 for x in out if x['q']); wl=sum(1 for x in out if x['lim'])
print(f"итого станций: {len(out)} (+{e1} только из gdebenzi) | с очередью-в-машинах: {withq} | с лимитами: {wl}")

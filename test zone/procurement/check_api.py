import json
import ssl
import urllib.request
import urllib.error
from pathlib import Path
from probe_source import BASE, PATH, payload

def main():
    ctx=ssl.create_default_context(); ctx.set_ciphers('DEFAULT:!DHE')
    endpoint='/o/egp-portal-contractor-selection-v2/services/smart/search'
    tender=[{'pageSize':20,'pageNumber':0,'query':[{'index':'es-contractor-selection',
        'keyWord':'','keyWordNotMatch':'','matchType':'all-1','matchFields':['notifyNo','bidName'],
        'filters':[{'fieldName':'type','searchType':'in','fieldValues':['es-notify-contractor']},
                   {'fieldName':'isMedicine','searchType':'in','fieldValues':[1]},
                   {'fieldName':'caseKHKQ','searchType':'not_in','fieldValues':['1']}]}]}]
    price=payload(100)
    price[0]['query'][0]['filters'].append({'fieldName':'ngay_dang_tai_kqlcnt','searchType':'range',
        'from':'2026-09-01T00:00:00.000Z','to':'2026-09-21T23:59:59.999Z'})
    for name,path,data in [('tenders',endpoint,tender),('prices',PATH,price)]:
        try:
            req=urllib.request.Request(BASE+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0','Referer':BASE+'/web/guest/contractor-selection'})
            with urllib.request.urlopen(req,context=ctx,timeout=60) as r: obj=json.load(r)
            print(name,'type',type(obj).__name__)
            if not isinstance(obj,dict): print(obj); continue
            print('META',{k:v for k,v in obj.get('page',{}).items() if k!='content'})
            rows=obj.get('page',{}).get('content',[])
            print('ROWS',len(rows),'SAMPLE',json.dumps(rows[:1],ensure_ascii=False)[:9000])
            (Path(__file__).parent/'research'/f'{name}-sample.json').write_text(json.dumps(obj,ensure_ascii=False),encoding='utf-8')
        except Exception as exc:
            print(type(exc).__name__,str(exc))
            if isinstance(exc,urllib.error.HTTPError):print(exc.read(400))

if __name__=='__main__':main()

"""Inspect business API shapes without printing login, cookie or token values."""
import collections
import json
import sys
from urllib.parse import urlparse

def main(path):
    with open(path,encoding='utf-8-sig') as f:data=json.load(f)
    entries=data['log']['entries'];summary=collections.Counter();records=[]
    for e in entries:
        p=urlparse(e['request']['url'])
        if p.hostname!='muasamcong.mpi.gov.vn' or '/services/' not in p.path:continue
        summary[(e['request']['method'],p.path,e['response']['status'])]+=1
        if '/smart/search' not in p.path:continue
        print('SEARCH',p.path,'HTTP',e['response']['status'])
        print('HEADER NAMES',[h['name'] for h in e['request'].get('headers',[]) if h['name'].lower() in ('x-csrf-token','authorization','cookie')])
        try:
            payload=json.loads(e['request'].get('postData',{}).get('text','null'))
            print('QUERY',json.dumps(payload,ensure_ascii=False)[:6500])
            body=json.loads(e['response'].get('content',{}).get('text','null'))
            if isinstance(body,dict):
                page=body.get('page') or {};rows=page.get('content') or body.get('resultList') or []
                print('META',{k:v for k,v in page.items() if k!='content'},'ROWS',len(rows))
                if rows:
                    print('FIRST BUSINESS FIELDS',json.dumps({k:v for k,v in rows[0].items() if k not in ('createdBy','creatorUserId')},ensure_ascii=False)[:6500])
                    records.extend(rows)
        except (ValueError,TypeError) as exc:print('No parseable business JSON',type(exc).__name__)
    print('ENDPOINTS')
    for key,count in summary.items():print(count,*key)
    for field in ('type','status','statusForNotify','stepCode','isMedicine','medicines','resultStatus','bidStatus'):
        print('VALUES',field,dict(collections.Counter(str(r.get(field)) for r in records)))

if __name__=='__main__':main(sys.argv[1])

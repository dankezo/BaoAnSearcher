"""Read-only check of the public procurement API provided by the user."""
import http.cookiejar
import json
import re
import ssl
from pathlib import Path
import urllib.error
import urllib.request

BASE = 'https://muasamcong.mpi.gov.vn'
PATH = '/o/egp-portal-winning-bid-data/services/smart/search_prc'
CONTRACTOR = '/web/guest/contractor-selection?p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=index&indexSelect=-1'

def payload(size=20, page=0, medicine='0'):
    return [{'pageSize':size, 'pageNumber':page, 'query':[{
        'index':'es-smart-pricing', 'keyWord':'', 'keyWordNotMatch':'',
        'matchType':'all-1', 'matchFields':['ten_thuoc','ten_hoat_chat','ma_tbmt'],
        'filters':[{'fieldName':key,'searchType':'in','fieldValues':[val]} for key,val in
                   [('medicines',medicine),('type','HANG_HOA'),('tab','THUOC_TAN_DUOC')]]}]}]

def main():
    jar=http.cookiejar.CookieJar()
    context=ssl.create_default_context()
    context.set_ciphers('DEFAULT:!DHE')
    session=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=context))
    session.addheaders=[('User-Agent','Mozilla/5.0')]
    for path in ['/web/guest/winning-bid-data', CONTRACTOR, PATH]:
        try:
            data=json.dumps(payload()).encode() if path==PATH else None
            req=urllib.request.Request(BASE+path,data=data,headers={
                'Content-Type':'application/json','Origin':BASE,'Referer':BASE+'/web/guest/winning-bid-data'})
            with session.open(req,timeout=45) as r:
                body=r.read().decode('utf-8',errors='replace')
                print('PATH',path,'HTTP',r.status,'TYPE',r.headers.get('Content-Type'),'LENGTH',len(body))
                if 'json' in r.headers.get('Content-Type',''):
                    obj=json.loads(body)
                    print('ROOT',list(obj)); print('PAGE META',{k:v for k,v in obj.get('page',{}).items() if k!='content'})
                    print('FIRST',json.dumps(obj.get('page',{}).get('content',[])[:1],ensure_ascii=False))
                else:
                    print('TITLE',re.findall(r'<title>(.*?)</title>',body,re.S)[:1])
                    print('SCRIPTS',re.findall(r'<script[^>]+src=["\x27]([^"\x27]+)',body)[-20:])
                    out=Path(__file__).parent/'research'; out.mkdir(exist_ok=True)
                    (out/('contractor-source.html' if path==CONTRACTOR else 'pricing-source.html')).write_text(re.sub(r"Liferay.authToken\s*=\s*'[^']*'", "Liferay.authToken = '[redacted]'",body),encoding='utf-8')
        except Exception as exc:
            print(type(exc).__name__,str(exc))
            if isinstance(exc,urllib.error.HTTPError): print(exc.read(300).decode(errors='replace'))

if __name__=='__main__':main()

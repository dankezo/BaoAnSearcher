const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/collector.js', 'utf8');

async function run() {
  const controls = new Map();
  const control = key => { if (!controls.has(key)) controls.set(key, {value:'2',textContent:''}); return controls.get(key); };
  let mounted = false, nextClicks = 0, download = null, blob = null;
  const panel = {style:{},querySelector:control,remove(){mounted=false;}};
  class XHR {
    open(method,url){ this.method=method;this.url=url; }
    send(body){ this.body=body; }
    addEventListener(event,fn){this.handler=fn;}
  }
  const originalOpen=XHR.prototype.open, originalSend=XHR.prototype.send;
  const originalFetch=async()=>({status:200,clone:()=>({text:async()=>JSON.stringify({page:{content:[],currentPage:2,last:true}})})});
  const browserWindow={fetch:originalFetch};
  const document={
    getElementById(){return mounted ? panel : null;},
    createElement(tag){if(tag==='section')return panel;return {click(){download=this.download;}};},
    body:{appendChild(){mounted=true;}},
    querySelectorAll(selector){
      if(selector==='[id]')return [{__vue__:{listResultSearch:[{id:'1',notifyNo:'IB1',bidName:['Thuốc A']}],page:{currentPage:0,totalPages:3,last:false}}}];
      if(selector==='.el-pagination .btn-next')return [{getClientRects:()=>[{}],disabled:false,getAttribute:()=>null,click(){nextClicks++;}}];
      return [];
    }
  };
  class BrowserURL extends URL {
    static createObjectURL(value){blob=value;return 'blob:mock';}
    static revokeObjectURL(){}
  }
  const context={location:{hostname:'muasamcong.mpi.gov.vn',origin:'https://muasamcong.mpi.gov.vn',href:'https://muasamcong.mpi.gov.vn/web/guest/contractor-selection'},
    document,window:browserWindow,XMLHttpRequest:XHR,URL:BrowserURL,Blob,Map,WeakMap,console,alert:()=>{},setTimeout:()=>1,clearTimeout:()=>{}};
  vm.runInNewContext(source,context);
  assert.match(control('[data-info]').textContent,/1 bản ghi/);
  control('[data-start]').onclick();assert.equal(nextClicks,1);
  const xhr=new XHR();
  xhr.open('POST','/o/egp-portal-contractor-selection-v2/services/smart/search?token=private');
  xhr.send('original-request-body');assert.equal(xhr.body,'original-request-body');
  xhr.status=200;xhr.responseText=JSON.stringify({page:{content:[{id:'2',notifyNo:'IB2',bidName:['Thuốc B']}],currentPage:1,totalPages:3,last:false}});
  xhr.handler();assert.match(control('[data-info]').textContent,/2 bản ghi/);
  const foreign=new XHR();foreign.open('POST','https://example.com/o/egp-portal-contractor-selection-v2/services/smart/search');foreign.send('test');assert.equal(foreign.handler,undefined);
  control('[data-save]').onclick();assert.match(download,/msc-goi-thau/);
  const data=JSON.parse(await blob.text());assert.equal(data.records.length,2);assert.equal(JSON.stringify(data).includes('private'),false);
  control('[data-close]').onclick();assert.equal(XHR.prototype.open,originalOpen);assert.equal(XHR.prototype.send,originalSend);assert.equal(browserWindow.fetch,originalFetch);assert.equal(mounted,false);
  console.log('Collector: capture, next page, export, origin restriction, token exclusion, cleanup OK');
}
run().catch(error=>{console.error(error);process.exitCode=1;});

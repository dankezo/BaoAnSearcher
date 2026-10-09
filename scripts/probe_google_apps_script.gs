function probePublicSources() {
  const probes = [
    ['vss', 'https://quanlythuocv1.vss.gov.vn/kqdt/export?ngaycongbo=02%2F10%2F2026&loai=1', {}],
    ['msc', 'https://muasamcong.mpi.gov.vn/api/unau/portal/ebidorg/bid-no-contractor/get-detail', {method: 'post', contentType: 'application/json', payload: JSON.stringify({body:{id:'74f2085c-b318-4aae-9b8e-007e57109bba'}})}]
  ];
  probes.forEach(function(p) {
    try {
      const r = UrlFetchApp.fetch(p[1], Object.assign({muteHttpExceptions:true, followRedirects:true},p[2]));
      const text = r.getContentText();
      const report = {source:p[0], status:r.getResponseCode(), bytes:r.getContent().length};
      if (p[0] === 'vss') report.xmlRows = (text.match(/<Row[ >]/g)||[]).length;
      else if (r.getResponseCode() === 200) report.lots = (((JSON.parse(text).body||{}).bidNotification||{}).lotDTOList||[]).length;
      console.log(JSON.stringify(report));
    } catch(e) { console.log(JSON.stringify({source:p[0],error:String(e).slice(0,240)})); }
  });
}

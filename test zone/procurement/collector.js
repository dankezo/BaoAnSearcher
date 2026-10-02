/* Bookmarklet source. Reads public result data only; never reads cookies or tokens. */
(() => {
  'use strict';
  if (location.hostname !== 'muasamcong.mpi.gov.vn') {
    alert('Hãy mở trang Mua sắm công và chạy dấu trang tại đó.'); return;
  }
  if (document.getElementById('msc-drug-collector')) {
    alert('Bộ thu thập đang mở ở góc phải trang.'); return;
  }
  const records = new Map();
  let running = false, timer = null, waiting = false, pages = 0, targetPages = 20;
  let lastPage = null, lastSignature = '', timeout = null;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch;
  const urls = new WeakMap();
  const allowed = url => {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin && [
        '/o/egp-portal-contractor-selection-v2/services/smart/search',
        '/o/egp-portal-winning-bid-data/services/smart/search_prc'
      ].includes(u.pathname);
    } catch { return false; }
  };
  const panel = document.createElement('section');
  panel.id = 'msc-drug-collector';
  panel.style.cssText = 'position:fixed;right:16px;top:100px;z-index:2147483647;width:350px;background:#fff;border:2px solid #155e75;border-radius:12px;padding:18px;box-shadow:0 12px 35px #0003;font:14px/1.5 Segoe UI,sans-serif;color:#163243;text-align:left';
  panel.innerHTML = '<strong style="font-size:19px">Thu thập gói thầu thuốc</strong><p data-info>Chọn bộ lọc thuốc trên trang, rồi bấm Tìm kiếm hoặc chuyển trang.</p><label>Số trang tiếp theo <input data-limit type="number" min="1" max="10000" value="20" style="width:85px"></label><div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:12px"><button data-start>Tự chuyển trang</button><button data-stop>Dừng</button><button data-save>Lưu JSON</button><button data-close>Đóng</button></div><small>Chỉ đọc dữ liệu trang đang truy cập. Khi có yêu cầu đăng nhập/xác minh, dừng và thao tác trực tiếp trên trang. Lưu JSON trước khi đóng.</small>';
  document.body.appendChild(panel);
  const info = panel.querySelector('[data-info]');
  const say = text => { info.textContent = text; };
  function stop(message) {
    running = false; waiting = false; clearTimeout(timer); clearTimeout(timeout);
    if (message) say(message + ` Đang giữ ${records.size} bản ghi.`);
  }
  function absorb(body) {
    if (!body || typeof body !== 'object' || !body.page || !Array.isArray(body.page.content)) {
      stop('Nguồn yêu cầu xác minh hoặc không trả danh sách.'); return;
    }
    const page = body.page;
    const signature = JSON.stringify(page.content.map(r => r.id || r.notifyId));
    if (waiting && signature === lastSignature) { stop('Trang trả dữ liệu trùng; đã dừng.'); return; }
    lastSignature = signature;
    for (const row of page.content) if (row && (row.id || row.notifyId)) {
      records.set((row.tab === 'THUOC_TAN_DUOC' || row.tenThuoc ? 'prices:' : 'tenders:') + (row.id || row.notifyId), row);
    }
    lastPage = page;
    if (waiting) { pages++; waiting = false; clearTimeout(timeout); }
    say(`Đã giữ ${records.size} bản ghi; trang nguồn ${Number(page.currentPage)+1}/${page.totalPages || '?'}. Đây là dữ liệu đã xem, chưa khẳng định đủ toàn bộ.`);
    if (running) {
      if (pages >= targetPages || page.last === true) stop('Đã đến giới hạn trang đã chọn hoặc cuối kết quả hiển thị.');
      else timer = setTimeout(next, 2200);
    }
  }
  function next() {
    if (!running || waiting) return;
    const buttons = [...document.querySelectorAll('.el-pagination .btn-next')];
    const button = buttons.find(b => b.getClientRects().length && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    if (!button) { stop('Không có nút trang tiếp đang khả dụng.'); return; }
    waiting = true;
    timeout = setTimeout(() => stop('Chưa nhận được trang mới. Kiểm tra đăng nhập, xác minh hoặc thông báo của nguồn.'), 45000);
    button.click();
  }
  function onResponse(status, text) {
    if (status !== 200) { stop('Nguồn trả lỗi HTTP ' + status + '.'); return; }
    try { absorb(typeof text === 'string' ? JSON.parse(text) : text); }
    catch { stop('Phản hồi không phải JSON hợp lệ.'); }
  }
  function patchedOpen(method, url, ...rest) {
    urls.set(this, url); return originalOpen.call(this, method, url, ...rest);
  }
  function patchedSend(...args) {
    if (allowed(urls.get(this))) this.addEventListener('load', () => {
      try { onResponse(this.status, this.responseType === 'json' ? this.response : this.responseText); }
      catch { stop('Không đọc được kết quả trang.'); }
    }, {once:true});
    return originalSend.apply(this,args);
  }
  async function patchedFetch(...args) {
    const response = await originalFetch.apply(this,args);
    if (allowed(typeof args[0] === 'string' ? args[0] : args[0]?.url)) {
      response.clone().text().then(text => onResponse(response.status,text)).catch(() => stop('Không đọc được kết quả.'));
    }
    return response;
  }
  XMLHttpRequest.prototype.open = patchedOpen;
  XMLHttpRequest.prototype.send = patchedSend;
  window.fetch = patchedFetch;
  // Capture the already rendered page when the current Vue component exposes it.
  for (const element of document.querySelectorAll('[id]')) {
    const vm = element.__vue__;
    if (vm && Array.isArray(vm.listResultSearch) && vm.page) {
      const page = vm.page.page || vm.page;
      if (typeof page.currentPage !== 'undefined') {
        absorb({page:{...page,content:vm.listResultSearch}});break;
      }
    }
  }
  panel.querySelector('[data-start]').onclick = () => {
    if (running) return;
    const limit = Number(panel.querySelector('[data-limit]').value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {say('Nhập từ 1 đến 10000 trang.');return;}
    if (!lastPage) {say('Bấm Tìm kiếm trên trang nguồn trước để bộ thu thập nhận trang đầu.');return;}
    targetPages = limit;pages=0;running=true;next();
  };
  panel.querySelector('[data-stop]').onclick = () => stop('Đã dừng.');
  panel.querySelector('[data-save]').onclick = () => {
    if (!records.size) {say('Chưa có dữ liệu. Hãy bấm Tìm kiếm hoặc chuyển trang trên nguồn.');return;}
    const blob = new Blob([JSON.stringify({source_system:'MSC',exported_at:new Date().toISOString(),
      coverage:'Only captured pages; not a complete site export',records:[...records.values()]})],{type:'application/json'});
    const url = URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='msc-goi-thau-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
  panel.querySelector('[data-close]').onclick = () => {
    stop();
    if (XMLHttpRequest.prototype.open===patchedOpen) XMLHttpRequest.prototype.open=originalOpen;
    if (XMLHttpRequest.prototype.send===patchedSend) XMLHttpRequest.prototype.send=originalSend;
    if (window.fetch===patchedFetch) window.fetch=originalFetch;
    panel.remove();
  };
})();

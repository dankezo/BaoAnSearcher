# BaoAn Searcher

Web thống nhất: **tra cứu thuốc DAV**, **lọc thầu MSC**, **thuốc trúng thầu BHYT (VSS)** + **quản trị crawl**.

## Chạy trên máy (đầy đủ)

```bash
# API
pip install -r server/requirements.txt
python -m uvicorn server.main:app --host 127.0.0.1 --port 8787 --reload

# UI (terminal khác)
cd web
npm install
npm run dev
```

Mở http://127.0.0.1:5173 — Vite proxy `/api` → `8787`.

Hoặc build rồi để API phục vụ luôn:

```bash
cd web && npm run build
python -m uvicorn server.main:app --host 127.0.0.1 --port 8787
```

Mở http://127.0.0.1:8787

### Dữ liệu local (không commit)

| Miniapp | Đường dẫn |
|--------|-----------|
| DAV | `test zone/data/thuoc.sqlite3` |
| MSC | `test zone/procurement/data/procurement.sqlite3` |
| VSS | `data/vss_bhyt.sqlite3` |
| Secrets | `server/secrets.local.json` |

Import Excel BHYT: đặt file hoặc dùng nút **Import Excel mặc định** (đường dẫn Desktop HAR folder).

## Export & GitHub Pages

1. Cập nhật data local (crawl trong tab Quản trị).
2. `python scripts/export_for_pages.py 5000`
3. `cd web && npm run build` rồi copy `web/dist` → `docs/` (hoặc chạy lại build + copy).
4. Commit + push nhánh `master`.
5. GitHub → **Settings → Pages → Deploy from a branch** → `master` / `/docs`.
6. Link dạng: `https://dankezo.github.io/BaoAnSearcher/`

Pages chỉ xem data đã export; crawl chạy trên máy bạn.

## Danh mục 93

Nhúng tại [`web/public/data/dm93.json`](web/public/data/dm93.json) theo Phụ lục TT 03/2024/TT-BYT.

## Ghi chú

- Pages **không** chạy crawl / không lưu mật khẩu.
- Mật khẩu MSC lưu local ngoài git, dùng điền sẵn khi mở browser crawl.

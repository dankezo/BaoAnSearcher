# Hai mini app phân tích

Trong **Nâng cao**, mở **Phân tích tổng hợp** hoặc **Phân tích chuyên sâu**. Cả hai cũng có trong bộ chọn Đa khung. Bản tổng hợp dùng cùng bộ lọc cho MSC đơn giá, MSC gói thầu, VSS và DAV. Bản chuyên sâu phân tích thuốc/hoạt chất, doanh nghiệp theo vai trò, địa bàn và xu hướng thị trường. Dữ liệu mẫu chỉ nằm trong bộ kiểm thử, không tự thay thế dữ liệu thật.

## Nguồn và công thức

- Cloud đọc TiDB; local chạy cùng engine JavaScript trên SQLite bằng bridge Python chỉ đọc. Không tạo kho dữ liệu thô mới. `ANALYTICS_PYTHON` chọn Python chạy bridge; API local mặc định dùng chính Python đang chạy server.
- MSC và VSS được tổng hợp riêng. VSS là kết quả trúng thầu, chưa phải tiền giải ngân. Giá gói MSC không thay thế giá kế hoạch từng thuốc.
- Thời gian mặc định là từ đầu tháng của 12 tháng gần nhất đến hôm nay theo Asia/Bangkok. Có 3/6/12/24 tháng, ngày tùy chỉnh tối đa 4 năm và so cùng kỳ năm trước hoặc kỳ liền trước. Ngày nhuận được đưa về ngày cuối tháng tương ứng.
- TiDB dùng DECIMAL; SQLite dùng Decimal cho nhân/cộng tiền. Phép số lượng × giá bình quân chỉ dùng dòng đủ số lượng và thành tiền, tách theo hoạt chất, hàm lượng, dạng, nhóm, đơn vị. So giá chỉ khi có đủ tọa độ và số liệu của cả hai kỳ; Top 200 tọa độ, không suy rộng ra toàn thị trường.
- Gói liên quan được nối qua mã thầu từ dòng thuốc MSC, dùng phép kiểm tra tồn tại để không nhân dòng. Gói cùng mã được chọn bản mới nhất theo ngày, cập nhật, ID. TBMT không có chi tiết thuốc chưa được suy đoán là liên quan.
- SĐK còn hạn/sắp hết hạn dựa trên ngày đã có; ngày chưa rõ được đếm riêng. Đây không phải kết luận thay cho quyết định pháp lý. DM93 cần đủ hoạt chất/hàm lượng/dạng và đối chiếu hiệu lực; BHYT giữ ghi chú của danh mục TT20 hiện có.
- Tô cam đối thủ chỉ khi đủ hoạt chất, hàm lượng và nhóm đã được chứng minh từ SĐK Bảo An trong MSC/VSS. Danh mục Bảo An và các tọa độ này không xuất lên snapshot công khai.

## API và giới hạn tải

Các endpoint yêu cầu phiên Supabase được xác minh:

| Endpoint | Nội dung |
| --- | --- |
| `GET /api/analytics/suggest?q=...` | Gợi ý thuốc/hoạt chất, doanh nghiệp, địa bàn |
| `POST /api/analytics/overview` | Tổng hợp bốn nguồn với `AnalyticsQuery` |
| `POST /api/analytics/detail` | `{query, source, page, panel?}`; `panel=competition` cho ma trận đối thủ |
| `POST /api/analytics/ai-insight` | `{query}`; máy chủ tự tạo dữ liệu tóm tắt |

`AnalyticsQuery` gồm mode, entity, entityField (ingredient/registration/name), role (winner/manufacturer/registrant), months hoặc start/end, comparison (yoy/previous), territoryField (province/facility/region), filters. Không dùng một tên doanh nghiệp làm cả ba vai trò. Response có thời gian tạo, nguồn, kỳ đối chiếu, trạng thái hỗ trợ và lý do thiếu chỉ số. Độ đầy đủ lịch sử là **chưa xác nhận**; tháng không phát sinh dữ liệu không tự được coi là thiếu nguồn.

Một lần áp dụng bộ lọc chỉ tải một response tổng hợp. Bảng, ma trận và tin tức tải khi mở; bảng phân trang 50 dòng. Không polling. Client gộp request trùng theo khóa đã sắp xếp và tài khoản; cache 5 phút. Máy chủ gộp các request đang chạy, giữ tối đa 128 khóa. Local lưu tối đa 128 báo cáo aggregate trong data/analytics_reports; khóa gồm ngày và mtime/kích thước SQLite + WAL, nên crawl hoặc pull dữ liệu sẽ tự làm mất hiệu lực báo cáo cũ. Làm nóng báo cáo toàn thị trường ở nền sau khi kéo cloud về. Khi chưa nhập/chọn gì, màn hình chỉ hiện hướng dẫn, không gọi overview/AI; bấm Áp dụng mới tải dữ liệu (toàn thị trường được phép giữ ô trống). SQL trả tập aggregate giới hạn, không trả toàn bộ fact table. PDF chỉ tải thư viện khi người dùng xuất báo cáo, kèm bảng/trang đang mở, biểu đồ và nhận xét hiện tại.

Typeahead cloud đọc `suggest_values`, local đọc `data/rollups/suggest_values.jsonl`; tỉnh lấy từ danh mục tĩnh. Không quét fact table khi gõ. Cập nhật danh mục gợi ý bằng pipeline `scripts/build_rollups.py` và đồng bộ rollup hiện có. Khi chưa có index gợi ý, có thể nhập hoạt chất/SĐK chính xác và Áp dụng; tên công ty nên chọn chế độ/vai trò rõ ràng.

## Cấu hình và đưa lên môi trường

1. Áp dụng migration `supabase/migrations/20261007000100_analytics_presets.sql` trong đợt triển khai riêng. Bảng preset có RLS cho SELECT/INSERT/UPDATE/DELETE theo auth.uid(); không cấp quyền anon. Trước khi áp dụng, phần xem dữ liệu vẫn dùng được, nút preset báo thiếu cấu hình.
2. API cloud dùng cấu hình TiDB hiện có. API local dùng cấu hình Supabase Auth và SQLite hiện có; hỗ trợ SUPABASE_*, VITE_SUPABASE_* hoặc NEXT_PUBLIC_SUPABASE_* cho URL/anon key. Không đưa khóa bí mật vào frontend.
3. AI tự chạy sau khi tổng hợp và nằm đầu báo cáo; nhận xét theo dữ liệu hiện ngay trong lúc chờ AI. Cấu hình server GEMINI_API_KEY (ANALYTICS_GEMINI_MODEL cho phân tích, GEMINI_DAILY_MODEL cho bản tin), GROQ_API_KEY/GROQ_MODEL và OPENROUTER_API_KEY/OPENROUTER_MODEL. Chuỗi Gemini → Groq → OpenRouter bỏ qua nhà cung cấp thiếu khóa; lỗi, timeout hoặc JSON không đạt kiểm tra chuyển sang nhà cung cấp tiếp theo. Tổng thời gian phân tích tối đa 24 giây, mỗi lần thử tối đa 11 giây. Hết chuỗi trả nhận xét quy tắc có nhãn; cache AI một giờ theo tóm tắt và tin đầu vào. Chỉ gửi aggregate và tối đa 6 tin BE/BHYT/đấu thầu mới trong 30 ngày, không gửi fact thô hoặc danh mục nội bộ Bảo An.
4. Snapshot R2 dùng R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY hiện có. Đặt `ANALYTICS_SNAPSHOT_BASE_URL` ở API cloud thành URL HTTPS của thư mục `analytics/` qua custom domain/CDN. Manifest quá 48 giờ hoặc không khớp truy vấn sẽ trở về SQL.
5. Workflow daily-crawl đã có job snapshot sau khi tất cả job crawl thành công; bỏ qua nếu chưa cấu hình R2_BUCKET. Job build aggregate toàn quốc, Top 500 hoạt chất và Top 100 nhà thầu theo MSC 12 tháng. Upload theo phiên bản, kiểm tra toàn bộ object trước khi thay manifest. Chạy thủ công bằng `python scripts/tidb/publish_r2_snapshots.py --yes-remote --analytics`; bỏ `--yes-remote` để kiểm tra chế độ dry-run. Build lỗi giữ manifest cũ.

Triển khai production, áp dụng migration và xuất bản R2 không được chạy trong phiên triển khai mã này. Không có thay đổi secrets hoặc dữ liệu production; có kiểm tra truy vấn TiDB chỉ đọc.

## Kiểm chứng

- `node --test tests/analytics.test.mjs tests/api-router.test.mjs` tại root.
- Trong web: `node --test tests/analytics-ui.test.mjs tests/analytics-presets.test.mjs`, `npm run typecheck`, `npm run build`.
- `node tests/analytics-browser.mjs` trong web chạy acceptance với dữ liệu DEMO, cần Playwright/Edge trong runtime kiểm thử. Có thể đặt CODEX_NODE_PACKAGES nếu runtime ở vị trí khác. Kết quả, ảnh và PDF nằm trong outputs/analytics-verification (bị Git ignore).
- Kiểm thử bao gồm ngày nhuận, decimal lớn hơn giới hạn số nguyên JavaScript, đếm SĐK duy nhất, cache/in-flight, nguồn tách biệt, SQL tham số hóa, phân trang, phản hồi cũ, RLS hai tài khoản, fallback AI, desktop/mobile, chuyển chủ thể trực tiếp, tô cam, quay lại và PDF A4 tiếng Việt.

Các bộ dữ liệu thật cloud/local có thể khác thời điểm đồng bộ. Kiểm thử công thức dùng fixture cố định; việc đọc TiDB thật chỉ kiểm chứng kết nối/khả năng query, không khẳng định hai kho đang có dữ liệu giống nhau.

Khi chạy bộ kiểm thử hiện có, phát hiện bộ đếm chủ đề Bảng tin nhận `now` nhưng chưa truyền ngày đó vào bộ xác định trạng thái thầu. Đã sửa việc truyền tham số này; kiểm thử home-radar hiện có xác nhận hành vi đúng theo ngày đối chiếu.

## Cải thiện UX và dữ liệu 08/10/2026

- Tại bảng tra cứu, chuột phải vào hoạt chất, tên thuốc, SĐK, nhà thầu, NSX, đơn vị đăng ký, tỉnh, CSYT hoặc khu vực rồi chọn Phân tích chuyên sâu. Có thể dùng Shift+F10/ContextMenu trên ô được focus. Loại đối tượng và vai trò đi cùng truy vấn; tên gói thầu không trở thành tên thuốc.
- Gợi ý đối sánh nhiều từ không dấu, chia theo chủ thể/vai trò, và không tự chọn khi còn nhiều tên phù hợp. Danh mục local đã rebuild với nhà thầu, NSX, CSYT và trường DAV lồng nhau. Cloud cần đồng bộ suggest_values bằng pipeline hiện có khi triển khai.
- Tăng/giảm có dấu và màu; so giá tăng đỏ, giảm xanh. Cơ cấu nhóm thành bảng gọn có giá trị/tỷ trọng, nhịp gói có số hiện sẵn, Top 30 cuộn trong ô. Thuốc/hoạt chất có sản phẩm dẫn đầu theo hàm lượng/dạng/ĐVT/SĐK. Cơ cấu quy cách nằm bên phải biểu đồ đơn giá, không trộn đơn vị viên/lọ/dung dịch.
- Local: mở Dữ liệu → Tải DAV + MSC + VSS về local; hoặc bấm Tải dữ liệu production về local ngay trên báo cáo. Nút nhập dữ liệu TiDB hiện có, hiển thị số dòng từng nguồn, thời gian hoàn tất và lỗi từng phần. Nhập lại theo ID/fingerprint, giữ bản local quan sát mới hơn; DAV thiếu cờ gốc giữ trạng thái cần xác minh. Rebuild rollup/gợi ý sau nhập.
- Tin chạy theo cron hiện có lúc 06:00 Việt Nam: bổ sung thầu chung/mua sắm tập trung/thỏa thuận khung. Nếu danh sách nguồn không đọc được hoặc không có liên kết phù hợp, EXA_API_KEY → JINA_API_KEY tìm liên kết trong đúng host đã cho phép; crawler vẫn tải bài gốc qua robots/cache và bộ kiểm tra nguồn. Không dùng snippet tìm kiếm làm chứng cứ hiệu lực.
- Migration bổ sung 20261008000100_regulatory_ingest_status.sql cập nhật draft/unknown khi bài tự crawl thay đổi; giữ hiệu lực đã được chuyên viên xác minh và dữ liệu manual/seed. Chưa áp dụng migration lên production trong phiên này.
- Đo dữ liệu SQLite thật: hoạt chất Ambroxol khoảng 45 → 7 giây; toàn thị trường lần đầu khoảng 42 giây, đọc lại từ báo cáo trên đĩa 0,018 giây (đã xóa cache RAM trước khi đo). Thời gian không gồm Auth/network/browser; truy vấn lạnh còn phụ thuộc dung lượng và bộ lọc. Đọc trực tiếp TiDB production cho Ambroxol mất khoảng 12,7 giây; đây là phép đo engine, chưa phải toàn bộ website production.
- Không thêm dependency. Khóa chỉ đặt ở cấu hình server; khóa từng đưa vào chat cần thay mới. Các API khác trong danh sách chưa thêm vào chuỗi vì chưa cần cho luồng này.


## Search and layout corrections (8 October 2026)

- Search is the subject selector. The previous company/drug/territory role controls were removed. Known provinces are injected independently of loaded data; corporate labels misindexed as medicine fields are classified as companies. Company suggestions merge exact folded names and use all source-supported roles in one predicate, without duplicating facts. Different legal names remain separate.
- Bảo An real local verification: 14 MSC lines, 7 linked packages, 8 VSS lines, 46 DAV records in the default 12-month period. Hà Nội resolves to province and the full Vĩnh Phúc corporate name to company. The uncached Bảo An overview still took 19.94 seconds; cache remains important.
- The top heading contains up to eight session-persisted report tabs per account/view. New-report guidance performs no API work. Period controls form one desktop row and can scroll within the panel on mobile.
- Removed the local-data and subject yellow banners; retained a compact context and production-download link. DAV secondary counts use compact status badges. Ranking source selection is an MSC/VSS segmented toolbar.
- Group composition is a compact donut with values/shares. Unit comparison uses two donuts for current/comparison awarded-value distributions and clickable slices/legends. Backend unit aggregation covers all matched facts and both periods; it is not derived from top-200 price coordinates. Case/whitespace in unit labels is normalized, missing units remain a visible bucket.
- AI summary shows two findings plus one concrete priority; full evidence is expandable. Rule fallback targets actual leading geography/product/company and expiring registrations instead of generic advice. Analytics Gemini defaults to `gemini-3.8-flash`, with low thinking for latency; `ANALYTICS_GEMINI_MODEL`/`GEMINI_MODEL` can override it. Analytics prefers Groq for faster responses, with Gemini and OpenRouter fallbacks (`ANALYTICS_AI_PROVIDER` can change this order). Groq defaults to `openai/gpt-oss-120b` (confirmed on the configured account model inventory); `GROQ_MODEL` can override. OpenRouter remains the next fallback. AI is asynchronous; its provider attempts share a 35-second budget with an 18-second attempt cap, independent of overview rendering. No supplied chat credentials were copied into code.
- Local disk aggregate cache namespace advanced to v4 to discard reports with the former synthetic unit rows. Overview schema is v2; old cloud snapshots are rejected, and should be rebuilt when releasing the changed unit schema.
- See [analytics UX checks](analytics-ux.md). Relevant acceptance includes search transitions from stale company/manufacturer and medicine/SDK contexts, ambiguous/failed resolution, unit slice growth, tabs, metric hints and empty zero-request initialization.


## Unified analysis and canonical company geography (8 October 2026)

- Only **Phân tích tổng hợp** remains in navigation. Legacy deep-analysis links still open the same report. Empty search performs no report or AI request.
- Full report and AI results are kept per account/query in session storage. The lock icon persists a report across login on that browser/device; changing dates requires a matching snapshot. **Cập nhật báo cáo** explicitly refreshes data, and **Đánh giá lại** makes a fresh AI request even on a restored tab.
- ALL covers all historical and undated facts without inventing a prior-period comparison. Manufacturer DAV KPI counts distinct registrations. Company package totals count distinct MSC TBMT IDs; VSS remains medicine-level because it has no stable package identity.
- Company/name rankings use plain text with right-click analysis and double-click related awards. A single package workspace shows the list beside selected package details. Award rows use actual package headers and recent-first green shading; values aggregate only matching medicine lines and never multiply by package headers.
- Unit/current/prior donuts have contiguous colored sectors, rounded value labels and dated headings; selected units dim the others mildly and update the growth figure. Metric headings support hover/focus explanations.
- Production facts were pulled and identity-verified: DAV 55,005; MSC prices 554,906; MSC tenders 10,095; VSS 744,781. Local-only records are retained but excluded from canonical analytics. Future pulls stage MSC membership until all four fact sources complete; derived-index errors do not discard a successful fact baseline.
- Published and mirrored 1,725 company location profiles from official DAV source addresses. There are 1,445 office-province and 746 factory-province profiles; 120 role/location cases remain ambiguous and keep their location lists. Registered-office and factory locations are separate; hospital procurement geography never becomes a company office address.
- The registry is joined by normalized company identity when new DAV facts arrive. TiDB fallback normalization now handles Vietnamese đ → d and repeated spaces even when company fold columns are absent. Live parity checks: Hà Nội office basis 7,818 records / 7,816 distinct SĐK; the Phương Đông manufacturer phrase 169 records / 169 distinct SĐK, matching local and cloud.
- Company web research uses grounded Gemini with Groq Browser Search fallback, public HTTPS/DNS validation, bounded fetches and literal source corroboration. Different legal forms are distinguished. Fields on another company’s cited page are never merged. Existing verified fields survive a partial refresh. Images come from actual cited official pages, not generated substitutes.
- Verified Bảo An website profile includes MST, contact address, public email/phone and a real office photo. Phương Đông tax ID/address were checked against the Bắc Ninh government publication and Ministry of Health documents; unverified image/contact fields stay empty. Verified equal tax IDs collapse duplicate profile choices without silently merging report scope.
- Bulk web enrichment is **not complete**. The queue contains 4,244 registrant/bidder or locally located manufacturer names from 21,703 source name variants. A first grounded batch attempted five and verified one; four kept pending/backoff status. Manual source verification enriched ten Bảo An/Phương Đông aliases. Run `node scripts/enrich_company_profiles.mjs --yes-remote --limit 50` to continue the checkpointed queue; successful batches mirror TiDB profiles locally.
- Applied analytics preset/RLS and reviewed-news ingestion migrations to the configured Supabase project. The daily news route now includes general procurement/pooled purchasing. A live refresh completed partially: government sources work; DAV/MOH timeouts and the reference-site robots restriction remain visible. Do not treat a failed source as evidence that no important news exists.
- Canonical fact sync is complete. The original pull’s final optional scope query lost its idle TiDB connection; reconnect/error handling was repaired and suggestion/rollup rebuilding completed separately (372,731 suggestions; 6,723 VSS rollup rows).
- Verification: 71 backend Node tests, 107 web tests, 17 relevant Python tests, TypeScript, production build and browser acceptance. Browser checks include session/locked restoration, package/context actions, tooltip behavior, PDF and mobile overflow. Live checks additionally exercised production TiDB geography and local canonical identities.
- Release limit: code has not been deployed to production. Automatic approval rejected stopping/restarting the running local API; restart it manually and reload the browser for the new awards/profile endpoints.


## Local metric latency and news coverage (9 October 2026)

- Metric point detail now shows a revenue header and a scrollable unit/group, quantity, weighted-price and revenue table. Clicking pins a point; pointer movement into the panel works, and Escape/outside click/close dismiss it. Desktop and 390px browser checks passed without overflow.
- Shared lookup tables reserve approximately 112px for registration codes; aliases wrap intact. DAV/VSS manufacturer columns have more room. Analytics/package SDK columns also remain compact.
- News source repair switches only the managed legacy Government procurement homepage to `/dau-thau.html`, preserving administrator custom URLs and schedules. Editorial rules now include winning-bid medicine-price news and distinguish “thuốc” from “thuộc”; recent publication/issue evidence is selected before archive limits. Home exposes source timestamps and failed-source status.
- Authorized live refresh at 09:03 Asia/Bangkok collected 2 health and 6 procurement articles. Corrected brief against production storage contains 10 items instead of 7. DAV/MOH connectivity failures and TVPL robots HTTP403 remain visible; no restrictions bypassed.
- Function duration is aligned to the existing 200-second crawl budget plus 30-second AI budget at the actual Vercel entrypoint. These code/configuration changes are not deployed to production.
- Frontend build/typecheck and 112 frontend tests pass. Metric detail browser fixture verifies scrolling, pinning, Escape, compact SDK width and mobile layout.

- Local `GET /api/regulatory?view=brief` now invokes the same verified staff-JWT/anon-RLS handler through a bounded Node bridge, so corrected editorial logic is available locally without waiting for a production code release. Other regulatory operations keep production forwarding. The bridge excludes service-role credentials, uses stdin for the token, enforces 30-second process/15-second fetch deadlines and disables automatic database retries. 25 Node and 4 Python checks cover auth, RLS-compatible queries, routing and failures.
- Local performance evidence: original MSC price metric ~61.68s exceeded the client's 55s timeout; the indexed date candidates, legacy-date preservation, per-query memoization and sequential scan reduce the actual default metric request to ~15.85s. A 5-minute bounded cache shares in-flight duplicate loads and invalidates on main/WAL changes. Default DAV cards reuse their computed payload (~0.014s versus ~92.34s flattening).
- Common uncached analysis timings after repair: Paracetamol ~1.74s, Bảo An company ~4.17s. Exact canonical decimal totals, legacy DD/MM dates, all-time scope and canonical membership are regression-tested before/after adding date indexes. Broad whole-market overview still takes approximately 46s cold; previous profiled timing is not a clean baseline comparison and no ratio is claimed.
- The current local API process runs without `--reload`; these Python changes need a manual restart. Automatic approval previously rejected stopping/restarting that process, so no alternative stop mechanism was used. Frontend static assets have been rebuilt; production code remains undeployed.

- Final sequential real-data acceptance: Paracetamol 29.55s → 1.72s; Bảo An company 57.40s → 5.95s. Original and optimized aggregate rows for every source, plus portfolio coordinates, match exactly. Final root verification: 17 Python tests (analytics/price coverage/local news) and 5 focused news Node tests pass, in addition to the 16 analytics/awards Node tests and earlier full frontend/browser checks.


## News-only cloud release (9 October 2026)

- Market/regulatory news logic is now live on `https://app.baoanpharma.com`, deployment `dpl_5iSC6z6q8ckgVxDmgBVCsdbrdtdw`. Reconstructed and hash-verified all 364 source files from the previous production deployment, then overlaid only the regulatory/news modules, home news status, and function duration. Unreleased local analytics/lookup changes were excluded.
- Promotion completed; the production domain resolves to the new READY deployment. The existing enabled cron now targets that deployment at `0 23 * * *` (06:00 Asia/Bangkok daily), with the existing production credentials and shared Supabase article/insight storage. The brief is assembled from persisted cloud data by the shared handler; no duplicate storage was added.
- Verification: 31 focused news/provider/discovery/home tests pass; cloud build succeeded; staged and public production homepage return 200; unauthenticated regulatory and daily endpoints return 401. The public HomeDashboard chunk contains the new source status UI. The staged brief logic against production storage returned 9 recent priority items and a completed AI run, including the medicine-price article (the rolling 30-day count can change over time).
- Live authenticated cloud brief/daily execution was not verified in this release: the technical QA account does not exist, and the production cron secret is protected from export and differs from the local value. No account was created and no credential or auth setting was changed. The enabled cron schedule and deployment target were verified through project metadata.
- DAV/MOH connectivity and TVPL robots restrictions remain visible source failures. Previous sections describing undeployed code still apply to the other local analytics/lookup changes; news is the scope released here.


## Shared news and selection follow-up (9 October 2026)

- Removed the redundant related-news insight card. Advanced analysis uses the same editorial brief as Home, merging entity hits into one deduplicated list with six-item expansion and no nested scrolling panels. Home expands secondary news initially. Editorial coverage now retains 90 days (up to 30 priority items), includes prescribing/demand proposals, and keeps draft warnings. The live shared store returned 19 priority items, including all four user-reported missing headlines. Generic procurement news cannot inherit medical-recall priority from an AI assessment.
- Trend headers contain colored N1–N5 controls matching their lines, replacing duplicated dropdown/bottom controls. Group/unit selection toggles off; blank/outside click, double-click and Escape restore the total. VSS side tables show group award values, shares and record counts for the whole period or selected month.
- Tender radar list, package detail and watchlist dialogs open as wide left drawers at desktop widths; the existing mobile bottom-sheet behavior is preserved. Browser checks passed at 1440px and 390px, and analytics browser checks passed including selection, news, report export and mobile layout.
- Integration verification before the all-workspace push: 116 web tests, 73 backend Node tests, 92 Python unittest checks, typecheck and frontend build. Two old Python matching fixtures now explicitly include oral route in both catalog and tender data, matching the current complete-coordinate requirement. Configured-secret and provider-key scans found no secrets in the candidate Git files.

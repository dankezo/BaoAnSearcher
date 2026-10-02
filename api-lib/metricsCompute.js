/**
 * Server-side metrics aggregates for Turso — replaces client fetchAllPages.
 * Cards are plain JSON (no React nodes); UI attaches explore buttons.
 */

const TAG_XANH = 'TAG_XANH_LA'
const TAG_VANG = 'TAG_VANG_XAC_MINH'
const TAG_CAM = 'TAG_CAM_CMO'
const TAG_XAM = 'TAG_XAM_LICH_SU'

function fmtInt(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Math.round(Number(n)).toLocaleString('vi-VN')
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} Tỷ`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} Tr`
  return v.toLocaleString('vi-VN')
}

function fmtPct(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

function noteFull() {
  return 'Toàn bộ dữ liệu đã nạp'
}

function noteYear(year) {
  return `từ đầu năm ${year}`
}

function metricsYear() {
  return new Date().getFullYear()
}

function shortName(s, max = 18) {
  const t = String(s || '')
  return t.length > max ? `${t.slice(0, max - 2)}…` : t
}

async function q1(db, sql, args = []) {
  const rs = await db.execute({ sql, args })
  return rs.rows[0] || {}
}

async function qall(db, sql, args = []) {
  const rs = await db.execute({ sql, args })
  return rs.rows || []
}

/** ISO / SQLite-friendly date prefix from ngay_cap-like columns. */
const DATE_PREFIX = (col) => `substr(trim(COALESCE(${col}, '')), 1, 10)`

export async function computeDavMetrics(db) {
  const note = noteFull()
  const tot = await q1(db, 'SELECT COUNT(*) AS c FROM dav_drugs')
  const total = Number(tot.c || 0)

  const dens = await q1(db, `
    WITH by_ing AS (
      SELECT LOWER(TRIM(COALESCE(hoat_chat, ''))) AS ik,
             COUNT(DISTINCT COALESCE(NULLIF(TRIM(so_dang_ky), ''), id)) AS n
      FROM dav_drugs
      WHERE TRIM(COALESCE(hoat_chat, '')) != ''
      GROUP BY 1
    )
    SELECT
      COALESCE(SUM(CASE WHEN n <= 2 THEN 1 ELSE 0 END), 0) AS blue,
      COALESCE(SUM(CASE WHEN n BETWEEN 3 AND 5 THEN 1 ELSE 0 END), 0) AS mid,
      COALESCE(SUM(CASE WHEN n > 5 THEN 1 ELSE 0 END), 0) AS red
    FROM by_ing
  `)

  const tagRows = await qall(db, `
    SELECT COALESCE(NULLIF(TRIM(tag_id), ''), '') AS tid, COUNT(*) AS c
    FROM dav_drugs GROUP BY 1
  `)
  const tags = { xanh: 0, vang: 0, cam: 0, xam: 0 }
  for (const r of tagRows) {
    const n = Number(r.c || 0)
    if (r.tid === TAG_XANH) tags.xanh += n
    else if (r.tid === TAG_VANG) tags.vang += n
    else if (r.tid === TAG_CAM) tags.cam += n
    else if (r.tid === TAG_XAM) tags.xam += n
    else tags.vang += n
  }

  const forms = await q1(db, `
    WITH by_ing AS (
      SELECT LOWER(TRIM(COALESCE(hoat_chat, ''))) AS ik,
             COUNT(DISTINCT LOWER(TRIM(COALESCE(dang_bao_che, '')))) AS n
      FROM dav_drugs
      WHERE TRIM(COALESCE(hoat_chat, '')) != ''
      GROUP BY 1
    )
    SELECT
      COALESCE(SUM(CASE WHEN n <= 1 THEN 1 ELSE 0 END), 0) AS f1,
      COALESCE(SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END), 0) AS f2,
      COALESCE(SUM(CASE WHEN n = 3 THEN 1 ELSE 0 END), 0) AS f3,
      COALESCE(SUM(CASE WHEN n >= 4 THEN 1 ELSE 0 END), 0) AS f4
    FROM by_ing
  `)
  const formTotal = Number(forms.f1) + Number(forms.f2) + Number(forms.f3) + Number(forms.f4)

  const news = await q1(db, `
    SELECT
      COALESCE(SUM(CASE WHEN ${DATE_PREFIX('ngay_cap')} >= date('now', '-3 months')
        AND ${DATE_PREFIX('ngay_cap')} <= date('now') THEN 1 ELSE 0 END), 0) AS n3,
      COALESCE(SUM(CASE WHEN ${DATE_PREFIX('ngay_cap')} >= date('now', '-6 months')
        AND ${DATE_PREFIX('ngay_cap')} <= date('now') THEN 1 ELSE 0 END), 0) AS n6,
      COALESCE(SUM(CASE WHEN ${DATE_PREFIX('ngay_cap')} >= date('now', '-12 months')
        AND ${DATE_PREFIX('ngay_cap')} <= date('now') THEN 1 ELSE 0 END), 0) AS n12
    FROM dav_drugs
    WHERE length(trim(COALESCE(ngay_cap, ''))) >= 10
  `)

  const blue = Number(dens.blue || 0)
  const mid = Number(dens.mid || 0)
  const red = Number(dens.red || 0)

  return {
    section: 'dav',
    total,
    sampleSize: total,
    cards: [
      {
        key: 'density',
        scope: 'fixed',
        title: 'Ô kỹ thuật · mật độ SĐK',
        mainValue: fmtInt(blue),
        unit: 'ô 1–2 SĐK',
        subtitle: note,
        subMetrics: [
          { id: 'sdk_1_2', label: '1–2 SĐK', count: fmtInt(blue), tone: 'ok', patch: { ingredientCount: '1' } },
          { id: 'sdk_3_5', label: '3–5 SĐK', count: fmtInt(mid), tone: 'warn', patch: { ingredientCount: '3' } },
          { id: 'sdk_red', label: '>5 SĐK', count: fmtInt(red), tone: 'danger', patch: { ingredientCount: '5' } },
        ],
      },
      {
        key: 'tags',
        scope: 'fixed',
        title: 'Tag hồ sơ',
        mainValue: fmtInt(tags.xanh),
        unit: 'SĐK xanh',
        subtitle: note,
        subMetrics: [
          { id: 'tag_xanh', label: 'Xanh', count: fmtInt(tags.xanh), tone: 'ok', patch: { _tag: TAG_XANH } },
          { id: 'tag_vang', label: 'Vàng', count: fmtInt(tags.vang), tone: 'warn', patch: { _tag: TAG_VANG } },
          { id: 'tag_cam', label: 'Cam', count: fmtInt(tags.cam), tone: 'danger', patch: { _tag: TAG_CAM } },
          { id: 'tag_xam', label: 'Xám', count: fmtInt(tags.xam), tone: 'neutral', patch: { _tag: TAG_XAM } },
        ],
      },
      {
        key: 'forms',
        scope: 'fixed',
        title: 'Dạng bào chế / hoạt chất',
        mainValue: fmtInt(formTotal),
        unit: 'HC',
        subtitle: note,
        titleTip: 'Số hoạt chất có 1 / 2 / 3 / ≥4 dạng bào chế khác nhau trong danh mục',
        subMetrics: [
          { id: 'form_1', label: '1 dạng', count: fmtInt(forms.f1), tone: 'ok', patch: { dosageFormCount: '1' } },
          { id: 'form_2', label: '2 dạng', count: fmtInt(forms.f2), tone: 'warn', patch: { dosageFormCount: '2' } },
          { id: 'form_3', label: '3 dạng', count: fmtInt(forms.f3), tone: 'warn', patch: { dosageFormCount: '3' } },
          { id: 'form_4', label: '4+ dạng', count: fmtInt(forms.f4), tone: 'danger', patch: { dosageFormCount: '4' } },
        ],
      },
      {
        key: 'new_sdk',
        scope: 'fixed',
        title: 'SĐK mới cấp',
        mainValue: fmtInt(news.n12),
        unit: '12 tháng',
        subtitle: note,
        titleTip: 'Số SĐK có ngày cấp trong 3 / 6 / 12 tháng gần nhất',
        subMetrics: [
          { id: 'new_3m', label: '3 th', count: fmtInt(news.n3), tone: 'ok', patch: { _quick: 'new_3m' } },
          { id: 'new_6m', label: '6 th', count: fmtInt(news.n6), tone: 'warn', patch: { _quick: 'new_6m' } },
          { id: 'new_12m', label: '12 th', count: fmtInt(news.n12), tone: 'neutral', patch: { _quick: 'new_12m' } },
        ],
      },
    ],
  }
}

/** Open / review / closed matching bidStatus.js heuristics (ISO dates). Year-scoped like UI. */
export async function computeMscTendersMetrics(db) {
  const year = metricsYear()
  const y0 = `${year}-01-01`
  const note = noteYear(year)
  const yearWhere = `(
    (length(trim(COALESCE(published, ''))) >= 10 AND ${DATE_PREFIX('published')} >= ?)
    OR (length(trim(COALESCE(published, ''))) < 10 AND length(trim(COALESCE(close_date, ''))) >= 10
        AND ${DATE_PREFIX('close_date')} >= ?)
  )`
  const yearArgs = [y0, y0]

  const tot = await q1(db, `SELECT COUNT(*) AS c FROM msc_tenders WHERE ${yearWhere}`, yearArgs)
  const total = Number(tot.c || 0)

  const stage = await q1(db, `
    SELECT
      COALESCE(SUM(CASE
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) = 'DXT' THEN 0
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) IN ('CNTTT', 'DHTBMT') THEN 0
        WHEN TRIM(COALESCE(status_code, '')) != ''
          AND UPPER(TRIM(status_code)) NOT IN ('OPEN', 'DXT', 'CNTTT', 'DHTBMT') THEN 0
        WHEN TRIM(COALESCE(status_code, '')) = ''
          AND length(trim(COALESCE(close_date, ''))) >= 10
          AND ${DATE_PREFIX('close_date')} < date('now') THEN 0
        WHEN length(trim(COALESCE(close_date, ''))) >= 10
          AND ${DATE_PREFIX('close_date')} >= date('now')
          AND ${DATE_PREFIX('close_date')} < date('now', '+7 days') THEN 1
        ELSE 0
      END), 0) AS closing_n,
      COALESCE(SUM(CASE
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) = 'DXT' THEN 0
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) IN ('CNTTT', 'DHTBMT') THEN 0
        WHEN TRIM(COALESCE(status_code, '')) != ''
          AND UPPER(TRIM(status_code)) NOT IN ('OPEN', 'DXT', 'CNTTT', 'DHTBMT') THEN 0
        WHEN TRIM(COALESCE(status_code, '')) = ''
          AND length(trim(COALESCE(close_date, ''))) >= 10
          AND ${DATE_PREFIX('close_date')} < date('now') THEN 0
        WHEN length(trim(COALESCE(close_date, ''))) >= 10
          AND ${DATE_PREFIX('close_date')} >= date('now')
          AND ${DATE_PREFIX('close_date')} < date('now', '+7 days') THEN 0
        WHEN length(trim(COALESCE(published, ''))) >= 10
          AND julianday('now') - julianday(${DATE_PREFIX('published')}) < 3 THEN 1
        ELSE 0
      END), 0) AS new_n,
      COALESCE(SUM(CASE
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) = 'DXT' THEN 1
        WHEN TRIM(COALESCE(status_code, '')) = ''
          AND length(trim(COALESCE(close_date, ''))) >= 10
          AND ${DATE_PREFIX('close_date')} < date('now') THEN 1
        ELSE 0
      END), 0) AS review_n,
      COALESCE(SUM(CASE
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) = 'DXT' THEN 0
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) IN ('CNTTT', 'DHTBMT') THEN 0
        WHEN TRIM(COALESCE(status_code, '')) != ''
          AND UPPER(TRIM(status_code)) NOT IN ('OPEN', 'DXT', 'CNTTT', 'DHTBMT') THEN 0
        WHEN TRIM(COALESCE(status_code, '')) = ''
          AND length(trim(COALESCE(close_date, ''))) >= 10
          AND ${DATE_PREFIX('close_date')} < date('now') THEN 0
        WHEN length(trim(COALESCE(close_date, ''))) >= 10
          AND ${DATE_PREFIX('close_date')} >= date('now')
          AND ${DATE_PREFIX('close_date')} < date('now', '+7 days') THEN 0
        WHEN length(trim(COALESCE(published, ''))) >= 10
          AND julianday('now') - julianday(${DATE_PREFIX('published')}) < 3 THEN 0
        WHEN UPPER(TRIM(COALESCE(status_code, ''))) = 'OPEN' THEN 1
        WHEN TRIM(COALESCE(status_code, '')) = '' THEN 1
        ELSE 0
      END), 0) AS open_n
    FROM msc_tenders
    WHERE ${yearWhere}
  `, yearArgs)

  const openN = Number(stage.open_n || 0)
  const reviewN = Number(stage.review_n || 0)
  const newN = Number(stage.new_n || 0)
  const closingN = Number(stage.closing_n || 0)
  const highlightOpen = openN + newN + closingN
  const pipelineN = highlightOpen + reviewN || 1

  const budget = await q1(db, `
    SELECT
      COALESCE(SUM(CASE WHEN is_open = 1 THEN bp ELSE 0 END), 0) AS open_val,
      COALESCE(SUM(CASE WHEN is_open = 1 AND bp >= 5e10 THEN 1 ELSE 0 END), 0) AS big50,
      COALESCE(SUM(CASE WHEN is_open = 1 AND bp > 0 AND bp < 1e10 THEN 1 ELSE 0 END), 0) AS small10,
      COALESCE(SUM(CASE WHEN bp > 0 AND bp < 5e7 THEN 1 WHEN bp <= 0 OR bp IS NULL THEN 1 ELSE 0 END), 0) AS under50m,
      COALESCE(SUM(CASE WHEN bp >= 5e7 THEN 1 ELSE 0 END), 0) AS over50m
    FROM (
      SELECT
        CAST(COALESCE(bid_price, 0) AS REAL) AS bp,
        CASE
          WHEN UPPER(TRIM(COALESCE(status_code, ''))) = 'DXT' THEN 0
          WHEN UPPER(TRIM(COALESCE(status_code, ''))) IN ('CNTTT', 'DHTBMT') THEN 0
          WHEN TRIM(COALESCE(status_code, '')) != ''
            AND UPPER(TRIM(status_code)) NOT IN ('OPEN', 'DXT', 'CNTTT', 'DHTBMT') THEN 0
          WHEN TRIM(COALESCE(status_code, '')) = ''
            AND length(trim(COALESCE(close_date, ''))) >= 10
            AND ${DATE_PREFIX('close_date')} < date('now') THEN 0
          ELSE 1
        END AS is_open
      FROM msc_tenders
      WHERE ${yearWhere}
    )
  `, yearArgs)

  const tiers = await q1(db, `
    SELECT
      COALESCE(SUM(CASE WHEN lower(buyer) LIKE '%sở y tế%' OR lower(buyer) LIKE '%so y te%'
        OR lower(buyer) LIKE '%đấu thầu tập trung%' OR lower(buyer) LIKE '%dau thau tap trung%' THEN 1 ELSE 0 END), 0) AS so,
      COALESCE(SUM(CASE WHEN lower(buyer) LIKE '%bộ y tế%' OR lower(buyer) LIKE '%trung ương%'
        OR lower(buyer) LIKE '%trung uong%' OR lower(buyer) GLOB '*tw[^a-z]*' OR lower(buyer) LIKE '% tw %'
        OR lower(buyer) LIKE 'tw %' OR lower(buyer) LIKE '% tw' THEN 1 ELSE 0 END), 0) AS tw,
      COUNT(DISTINCT NULLIF(TRIM(buyer), '')) AS buyers
    FROM msc_tenders
    WHERE ${yearWhere}
  `, yearArgs)
  const so = Number(tiers.so || 0)
  const tw = Number(tiers.tw || 0)
  const bv = Math.max(0, total - so - tw)
  const n = total || 1
  const under50m = Number(budget.under50m || 0)
  const over50m = Number(budget.over50m || 0)
  const bondN = under50m + over50m || 1
  const freePct = Math.round((under50m / n) * 100)

  return {
    section: 'msc_tenders',
    total,
    sampleSize: total,
    cards: [
      {
        key: 'pipeline',
        scope: 'fixed',
        title: 'Nhịp thầu & cơ hội mở',
        mainValue: fmtInt(highlightOpen),
        unit: 'đang mở',
        subtitle: note,
        subMetrics: [
          { id: 'open_dxt', label: 'Đang mở', count: fmtInt(openN), tone: 'ok', patch: { _quick: 'open_dxt' } },
          { id: 'reviewing', label: 'Đang xét', count: fmtInt(reviewN), tone: 'warn', patch: { _quick: 'reviewing' } },
          { id: 'new_72h', label: 'Mới <72h', count: fmtInt(newN), tone: 'ok', patch: { _quick: 'new_72h' } },
          { id: 'closing_7d', label: 'Sắp đóng', count: fmtInt(closingN), tone: 'danger', patch: { _quick: 'closing_7d' } },
        ],
        segments: [
          { key: 'o', pct: (openN / pipelineN) * 100, color: '#22c55e', label: 'Đang mở' },
          { key: 'r', pct: (reviewN / pipelineN) * 100, color: '#eab308', label: 'Xét thầu' },
          { key: 'n', pct: (newN / pipelineN) * 100, color: '#2563eb', label: 'Mới mở' },
          { key: 'c', pct: (closingN / pipelineN) * 100, color: '#ef4444', label: 'Sắp đóng' },
        ],
      },
      {
        key: 'budget',
        scope: 'fixed',
        title: 'Ngân sách mời thầu (đang mở)',
        mainValue: fmtMoney(budget.open_val),
        unit: 'đ',
        subtitle: note,
        subMetrics: [
          { id: 'big_50t', label: 'Gói >50 Tỷ', count: fmtInt(budget.big50), tone: 'warn', patch: { _quick: 'big_50t' } },
          { id: 'small_10t', label: 'Gói <10 Tỷ', count: fmtInt(budget.small10), tone: 'ok', patch: { _quick: 'small_10t' } },
        ],
      },
      {
        key: 'bond',
        scope: 'fixed',
        title: 'Miễn bảo lãnh NH',
        mainValue: `${freePct}%`,
        unit: 'gói ≤50 Tr',
        subtitle: note,
        subMetrics: [
          { id: 'under_50m', label: '≤50 Tr', count: fmtInt(under50m), tone: 'ok', patch: { _quick: 'under_50m' } },
          { id: 'over_50m', label: '>50 Tr', count: fmtInt(over50m), tone: 'warn', patch: { _quick: 'over_50m' } },
        ],
        segments: [
          { key: 'u', pct: (under50m / bondN) * 100, color: '#22c55e' },
          { key: 'o', pct: (over50m / bondN) * 100, color: '#f59e0b' },
        ],
      },
      {
        key: 'tier',
        scope: 'fixed',
        title: 'Cấp mời thầu',
        mainValue: fmtInt(tiers.buyers),
        unit: 'CĐT',
        subtitle: note,
        subMetrics: [
          { id: 'tier_so', label: 'Sở Y tế', count: fmtInt(so), tone: 'ok', patch: { _quick: 'tier_so' } },
          { id: 'tier_tw', label: 'TW / Bộ', count: fmtInt(tw), tone: 'warn', patch: { _quick: 'tier_tw' } },
          { id: 'tier_bv', label: 'BV tự mua', count: fmtInt(bv), tone: 'neutral', patch: { _quick: 'tier_bv' } },
        ],
        segments: [
          { key: 'so', pct: (so / n) * 100, color: '#0d9488' },
          { key: 'tw', pct: (tw / n) * 100, color: '#2563eb' },
          { key: 'bv', pct: (bv / n) * 100, color: '#d97706' },
        ],
      },
    ],
  }
}

export async function computeMscPricesMetrics(db) {
  const year = metricsYear()
  const y0 = `${year}-01-01`
  const note = noteYear(year)
  const yearWhere = `length(trim(COALESCE(published, ''))) >= 10 AND ${DATE_PREFIX('published')} >= ?`
  const yearArgs = [y0]

  const tot = await q1(db, `SELECT COUNT(*) AS c FROM msc_prices WHERE ${yearWhere}`, yearArgs)
  const total = Number(tot.c || 0)

  const disc = await q1(db, `
    WITH priced AS (
      SELECT
        LOWER(TRIM(COALESCE(NULLIF(ingredient, ''), name, ''))) AS ik,
        CAST(unit_price AS REAL) AS p
      FROM msc_prices
      WHERE CAST(COALESCE(unit_price, 0) AS REAL) > 0 AND ${yearWhere}
    ),
    peaks AS (
      SELECT ik, MAX(p) AS mx, COUNT(*) AS n FROM priced GROUP BY ik HAVING COUNT(*) >= 2 AND MAX(p) > 0
    ),
    scored AS (
      SELECT ((peaks.mx - priced.p) / peaks.mx) * 100 AS disc
      FROM priced JOIN peaks ON priced.ik = peaks.ik
    )
    SELECT
      COALESCE(AVG(disc), 0) AS avg_disc,
      COALESCE(SUM(CASE WHEN disc < 5 THEN 1 ELSE 0 END), 0) AS d_low,
      COALESCE(SUM(CASE WHEN disc >= 5 AND disc <= 15 THEN 1 ELSE 0 END), 0) AS d_mid,
      COALESCE(SUM(CASE WHEN disc > 15 THEN 1 ELSE 0 END), 0) AS d_high,
      COUNT(*) AS d_n
    FROM scored
  `, yearArgs)

  const g24 = await q1(db, `
    SELECT
      AVG(CASE WHEN g = '2' THEN p END) AS avg2,
      AVG(CASE WHEN g = '4' THEN p END) AS avg4
    FROM (
      SELECT CAST(unit_price AS REAL) AS p,
        CASE
          WHEN lower(group_name) LIKE '%nhóm 2%' OR lower(group_name) LIKE '%nhom 2%'
            OR lower(group_name) GLOB '*n2*' OR trim(group_name) = '2' THEN '2'
          WHEN lower(group_name) LIKE '%nhóm 4%' OR lower(group_name) LIKE '%nhom 4%'
            OR lower(group_name) GLOB '*n4*' OR trim(group_name) = '4' THEN '4'
          ELSE NULL
        END AS g
      FROM msc_prices
      WHERE CAST(COALESCE(unit_price, 0) AS REAL) > 0 AND ${yearWhere}
    )
    WHERE g IS NOT NULL
  `, yearArgs)
  const avg2 = g24.avg2 != null ? Number(g24.avg2) : null
  const avg4 = g24.avg4 != null ? Number(g24.avg4) : null
  const margin = avg4 > 0 && avg2 != null ? ((avg2 - avg4) / avg4) * 100 : null

  const provRows = await qall(db, `
    SELECT COALESCE(NULLIF(TRIM(province), ''), 'Chưa xác định tỉnh') AS name,
           SUM(CAST(COALESCE(quantity, 0) AS REAL) * CAST(COALESCE(unit_price, 0) AS REAL)) AS value
    FROM msc_prices
    WHERE ${yearWhere}
    GROUP BY 1
    ORDER BY value DESC
  `, yearArgs)
  const value = provRows.reduce((s, r) => s + Number(r.value || 0), 0)
  const topProv = provRows[0]

  const yoyRows = await qall(db, `
    SELECT
      COALESCE(NULLIF(TRIM(province), ''), 'Chưa xác định tỉnh') AS name,
      SUM(CASE WHEN ${DATE_PREFIX('published')} >= date('now', '-365 days')
        THEN CAST(COALESCE(quantity, 0) AS REAL) * CAST(COALESCE(unit_price, 0) AS REAL) ELSE 0 END) AS cur,
      SUM(CASE WHEN ${DATE_PREFIX('published')} >= date('now', '-730 days')
        AND ${DATE_PREFIX('published')} < date('now', '-365 days')
        THEN CAST(COALESCE(quantity, 0) AS REAL) * CAST(COALESCE(unit_price, 0) AS REAL) ELSE 0 END) AS prev
    FROM msc_prices
    WHERE ${yearWhere}
    GROUP BY 1
  `, yearArgs)
  const yoy = yoyRows
    .map((r) => {
      const cur = Number(r.cur || 0)
      const prev = Number(r.prev || 0)
      const growth = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? null : 0)
      const totalCur = yoyRows.reduce((s, x) => s + Number(x.cur || 0), 0) || 1
      return { name: r.name, value: cur, prev, share: (cur / totalCur) * 100, growth }
    })
    .sort((a, b) => {
      if (a.growth == null && b.growth == null) return b.value - a.value
      if (a.growth == null) return 1
      if (b.growth == null) return -1
      if (b.growth !== a.growth) return b.growth - a.growth
      return b.value - a.value
    })
  const topGrowth = yoy.find((p) => p.growth != null) || yoy[0]

  const dLow = Number(disc.d_low || 0)
  const dMid = Number(disc.d_mid || 0)
  const dHigh = Number(disc.d_high || 0)
  const dN = Number(disc.d_n || 0)
  const avgDisc = Number(disc.avg_disc || 0)
  const discN = dLow + dMid + dHigh || 1

  return {
    section: 'msc_prices',
    total,
    sampleSize: total,
    provincesYoy: yoy,
    cards: [
      {
        key: 'discount',
        scope: 'fixed',
        title: 'Giảm giá vs đỉnh HC',
        mainValue: dN ? `${avgDisc.toFixed(1)}%` : '—',
        unit: 'TB',
        subtitle: note,
        subMetrics: [
          { id: 'disc_low', label: '<5%', count: fmtInt(dLow), tone: 'ok', patch: { _quick: 'disc_low' } },
          { id: 'disc_mid', label: '5–15%', count: fmtInt(dMid), tone: 'warn', patch: { _quick: 'disc_mid' } },
          { id: 'disc_high', label: '>15%', count: fmtInt(dHigh), tone: 'danger', patch: { _quick: 'disc_high' } },
        ],
        segments: [
          { key: 'l', pct: (dLow / discN) * 100, color: '#22c55e' },
          { key: 'm', pct: (dMid / discN) * 100, color: '#eab308' },
          { key: 'h', pct: (dHigh / discN) * 100, color: '#ef4444' },
        ],
      },
      {
        key: 'g24',
        scope: 'fixed',
        title: 'Biên giá N2 vs N4',
        mainValue: margin == null ? '—' : fmtPct(margin),
        unit: 'TB',
        subtitle: note,
        subMetrics: [
          { id: 'g2', label: 'Giá TB N2', count: avg2 != null ? fmtInt(avg2) : '—', tone: 'ok', patch: { group_name: '2' } },
          { id: 'g4', label: 'Giá TB N4', count: avg4 != null ? fmtInt(avg4) : '—', tone: 'neutral', patch: { group_name: '4' } },
        ],
      },
      {
        key: 'province_lead',
        scope: 'fixed',
        title: 'Tỉnh dẫn đầu doanh thu',
        mainValue: topProv ? shortName(topProv.name) : '—',
        unit: topProv ? fmtMoney(topProv.value) : '',
        subtitle: note,
        titleTip: 'Tỉnh có tổng thành tiền (SL × ĐG) cao nhất trên toàn bộ dữ liệu đã nạp',
        subMetrics: [
          { id: 'prov_n', label: 'Số tỉnh', count: fmtInt(provRows.length), tone: 'neutral', info: true },
          { id: 'prov_total', label: 'Tổng DT', count: fmtMoney(value), tone: 'ok', info: true },
        ],
      },
      {
        key: 'province_yoy',
        scope: 'fixed',
        title: 'Tăng trưởng YoY theo tỉnh',
        mainValue: topGrowth?.growth == null ? '—' : fmtPct(topGrowth.growth),
        unit: topGrowth ? shortName(topGrowth.name, 14) : '',
        subtitle: note,
        titleTip: '12 tháng gần nhất so cùng kỳ năm trước — xếp hạng đủ tất cả tỉnh',
        explore: true,
      },
    ],
  }
}

const VSS_LOAI = "(loai = 'Tân dược' OR loai LIKE 'Tân dược%' OR loai LIKE '%Tân dược%')"

export async function computeVssMetrics(db) {
  const year = metricsYear()
  const note = noteYear(year)
  const where = `${VSS_LOAI} AND (
    nam = ?
    OR (nam IS NULL AND length(trim(COALESCE(tungay_hd, tungay, congbo, ''))) >= 4
        AND CAST(substr(trim(COALESCE(tungay_hd, tungay, congbo)), 1, 4) AS INTEGER) = ?)
  )`
  const whereArgs = [year, year]
  const tot = await q1(db, `SELECT COUNT(*) AS c FROM vss_bids WHERE ${where}`, whereArgs)
  const total = Number(tot.c || 0)

  const lineVal = `COALESCE(CAST(thanhtien AS REAL), CAST(COALESCE(gia, 0) AS REAL) * CAST(COALESCE(soluong, 0) AS REAL))`

  const sums = await q1(db, `
    SELECT
      COALESCE(SUM(${lineVal}), 0) AS pay_all,
      COALESCE(SUM(CASE WHEN g = '1' THEN ${lineVal} ELSE 0 END), 0) AS g1,
      COALESCE(SUM(CASE WHEN g = '2' THEN ${lineVal} ELSE 0 END), 0) AS g2,
      COALESCE(SUM(CASE WHEN g = '3' THEN ${lineVal} ELSE 0 END), 0) AS g3,
      COALESCE(SUM(CASE WHEN g = '4' THEN ${lineVal} ELSE 0 END), 0) AS g4,
      COALESCE(SUM(CASE WHEN g = '5' THEN ${lineVal} ELSE 0 END), 0) AS g5,
      COUNT(DISTINCT NULLIF(TRIM(COALESCE(ma_cskcb, ten_cskcb)), '')) AS cskcb_n,
      COALESCE(SUM(CASE WHEN lower(ten_cskcb) LIKE '%trung ương%' OR lower(ten_cskcb) LIKE '%trung uong%'
        OR lower(ten_cskcb) GLOB '*tw[^a-z]*' OR lower(ten_cskcb) LIKE '% bạch mai%'
        OR lower(ten_cskcb) LIKE '%chợ rẫy%' OR lower(ten_cskcb) LIKE '%cho ray%'
        OR lower(ten_cskcb) LIKE '%việt đức%' OR lower(ten_cskcb) LIKE '%viet duc%' THEN 1 ELSE 0 END), 0) AS tw_n
    FROM (
      SELECT *,
        CASE
          WHEN lower(nhomthau) LIKE '%nhóm 1%' OR lower(nhomthau) LIKE '%nhom 1%' OR lower(nhomthau) GLOB '*n1[^0-9]*'
            OR trim(nhomthau) = '1' THEN '1'
          WHEN lower(nhomthau) LIKE '%nhóm 2%' OR lower(nhomthau) LIKE '%nhom 2%' OR lower(nhomthau) GLOB '*n2[^0-9]*'
            OR trim(nhomthau) = '2' THEN '2'
          WHEN lower(nhomthau) LIKE '%nhóm 3%' OR lower(nhomthau) LIKE '%nhom 3%' OR lower(nhomthau) GLOB '*n3[^0-9]*'
            OR trim(nhomthau) = '3' THEN '3'
          WHEN lower(nhomthau) LIKE '%nhóm 4%' OR lower(nhomthau) LIKE '%nhom 4%' OR lower(nhomthau) GLOB '*n4[^0-9]*'
            OR trim(nhomthau) = '4' THEN '4'
          WHEN lower(nhomthau) LIKE '%nhóm 5%' OR lower(nhomthau) LIKE '%nhom 5%' OR lower(nhomthau) GLOB '*n5[^0-9]*'
            OR trim(nhomthau) = '5' THEN '5'
          ELSE NULL
        END AS g
      FROM vss_bids
      WHERE ${where}
    )
  `, whereArgs)

  const payAll = Number(sums.pay_all || 0)
  const payG = {
    1: Number(sums.g1 || 0),
    2: Number(sums.g2 || 0),
    3: Number(sums.g3 || 0),
    4: Number(sums.g4 || 0),
    5: Number(sums.g5 || 0),
  }
  const highShare = ((payG[1] + payG[2]) / (payAll || 1)) * 100
  const twLike = Number(sums.tw_n || 0)
  const localLike = Math.max(0, total - twLike)
  const tierN = twLike + localLike || 1

  const provinces = await qall(db, `
    SELECT
      COALESCE(NULLIF(TRIM(ma_tinh), ''), NULLIF(TRIM(ten_tinh), ''), '_unk') AS key,
      COALESCE(NULLIF(TRIM(ma_tinh), ''), '') AS code,
      CASE
        WHEN TRIM(COALESCE(ten_tinh, '')) != '' THEN TRIM(ten_tinh)
        WHEN TRIM(COALESCE(ma_tinh, '')) != '' THEN 'Tỉnh mã ' || TRIM(ma_tinh)
        ELSE 'Chưa xác định tỉnh'
      END AS name,
      SUM(${lineVal}) AS value,
      COUNT(*) AS count,
      COUNT(DISTINCT NULLIF(TRIM(COALESCE(ma_cskcb, ten_cskcb)), '')) AS facilities,
      SUM(CASE WHEN g = '1' THEN ${lineVal} ELSE 0 END) AS g1,
      SUM(CASE WHEN g = '2' THEN ${lineVal} ELSE 0 END) AS g2,
      SUM(CASE WHEN g = '3' THEN ${lineVal} ELSE 0 END) AS g3,
      SUM(CASE WHEN g = '4' THEN ${lineVal} ELSE 0 END) AS g4,
      SUM(CASE WHEN g = '5' THEN ${lineVal} ELSE 0 END) AS g5
    FROM (
      SELECT *,
        CASE
          WHEN lower(nhomthau) LIKE '%nhóm 1%' OR lower(nhomthau) LIKE '%nhom 1%' OR trim(nhomthau) = '1' THEN '1'
          WHEN lower(nhomthau) LIKE '%nhóm 2%' OR lower(nhomthau) LIKE '%nhom 2%' OR trim(nhomthau) = '2' THEN '2'
          WHEN lower(nhomthau) LIKE '%nhóm 3%' OR lower(nhomthau) LIKE '%nhom 3%' OR trim(nhomthau) = '3' THEN '3'
          WHEN lower(nhomthau) LIKE '%nhóm 4%' OR lower(nhomthau) LIKE '%nhom 4%' OR trim(nhomthau) = '4' THEN '4'
          WHEN lower(nhomthau) LIKE '%nhóm 5%' OR lower(nhomthau) LIKE '%nhom 5%' OR trim(nhomthau) = '5' THEN '5'
          ELSE NULL
        END AS g
      FROM vss_bids WHERE ${where}
    )
    GROUP BY 1, 2, 3
    ORDER BY value DESC
  `, whereArgs)

  const totalPay = provinces.reduce((s, p) => s + Number(p.value || 0), 0) || 1
  const provinceRows = provinces.map((p) => ({
    key: p.key,
    code: p.code,
    name: p.name,
    value: Number(p.value || 0),
    count: Number(p.count || 0),
    facilities: Number(p.facilities || 0),
    groups: [Number(p.g1 || 0), Number(p.g2 || 0), Number(p.g3 || 0), Number(p.g4 || 0), Number(p.g5 || 0)],
    share: (Number(p.value || 0) / totalPay) * 100,
  }))
  const top = provinceRows[0]

  return {
    section: 'vss',
    total,
    sampleSize: total,
    provinces: provinceRows,
    cards: [
      {
        key: 'total',
        scope: 'fixed',
        title: 'Tổng giá trị trúng thầu',
        mainValue: fmtMoney(payAll),
        unit: 'đ',
        subtitle: note,
        subMetrics: [
          { id: 'rows', label: 'Dòng', count: fmtInt(total), tone: 'neutral', info: true },
          { id: 'n12', label: 'N1+N2', count: `${highShare.toFixed(0)}%`, tone: 'ok', info: true },
        ],
      },
      {
        key: 'groups',
        scope: 'fixed',
        title: 'Dòng tiền theo nhóm',
        mainValue: `${highShare.toFixed(0)}%`,
        unit: 'N1+N2',
        subtitle: note,
        subMetrics: [1, 2, 3, 4, 5].map((n) => ({
          id: `g${n}`,
          label: `N${n}`,
          count: fmtMoney(payG[n]),
          tone: n <= 2 ? 'ok' : n === 4 ? 'warn' : 'neutral',
          patch: { nhomthau: [`${n}`, `N${n}`] },
        })),
      },
      {
        key: 'cskcb',
        scope: 'fixed',
        title: 'Phủ CSKCB',
        mainValue: fmtInt(sums.cskcb_n),
        unit: 'cơ sở',
        subtitle: note,
        subMetrics: [
          { id: 'tw', label: 'TW / Hạng I', count: fmtInt(twLike), tone: 'warn', patch: { _quick: 'cskcb_tw' } },
          { id: 'local', label: 'Tỉnh–Huyện', count: fmtInt(localLike), tone: 'ok', patch: { _quick: 'cskcb_local' } },
        ],
        segments: [
          { key: 't', pct: (twLike / tierN) * 100, color: '#7c3aed' },
          { key: 'l', pct: (localLike / tierN) * 100, color: '#94a3b8' },
        ],
      },
      {
        key: 'region',
        scope: 'fixed',
        title: 'Tỉnh dẫn đầu doanh thu',
        mainValue: top ? shortName(top.name) : '—',
        unit: top ? fmtMoney(top.value) : '',
        subtitle: note,
        titleTip: 'Tỉnh có tổng thành tiền cao nhất — mở bảng để xem đủ xếp hạng tất cả tỉnh',
        subMetrics: [
          { id: 'prov_n', label: 'Số tỉnh', count: fmtInt(provinceRows.length), tone: 'neutral', info: true },
          { id: 'prov_share', label: 'Tỷ trọng', count: top ? `${top.share.toFixed(1)}%` : '—', tone: 'ok', info: true },
          { id: 'prov_total', label: 'Tổng', count: fmtMoney(totalPay), tone: 'ok', info: true },
        ],
        explore: true,
      },
    ],
  }
}

export async function computeSectionMetrics(db, section) {
  const s = String(section || 'dav').toLowerCase()
  if (s === 'dav') return computeDavMetrics(db)
  if (s === 'msc_tenders' || s === 'tenders') return computeMscTendersMetrics(db)
  if (s === 'msc_prices' || s === 'prices' || s === 'msc') return computeMscPricesMetrics(db)
  if (s === 'vss') return computeVssMetrics(db)
  throw Object.assign(new Error(`Unknown metrics section: ${section}`), { status: 400 })
}

export function metricsCacheKey(section) {
  const s = String(section || 'dav').toLowerCase()
  if (s === 'msc' || s === 'prices' || s === 'msc_prices') return 'metrics_msc_prices'
  if (s === 'tenders' || s === 'msc_tenders') return 'metrics_msc_tenders'
  if (s === 'vss') return 'metrics_vss'
  return 'metrics_dav'
}

/**
 * Metric reads for TiDB: rollup tables first, TiFlash only as fallback.
 * Fact tables are never scanned without a TiFlash hint.
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

import { provinceNameFromCode } from './vnProvinces.js'

function noteYear(year) {
  return `từ đầu năm ${year}`
}

export function emptyMetrics(section) {
  return {
    section: String(section || 'dav'),
    cards: [],
    total: null,
    cached: false,
    source: 'none',
  }
}

export function normalizeSection(section) {
  const value = String(section || 'dav').toLowerCase()
  if (value === 'prices' || value === 'msc') return 'msc_prices'
  if (value === 'tenders') return 'msc_tenders'
  return value
}

function hint(table) {
  return `/*+ READ_FROM_STORAGE(TIFLASH[${table}]) */`
}

export function vssRollupSql(year) {
  return {
    sql: `SELECT ma_tinh, nhomthau, ym, SUM(sum_thanhtien) AS sum_thanhtien, SUM(cnt) AS cnt
FROM agg_vss_monthly
WHERE loai = ? AND nam = ?
GROUP BY ma_tinh, nhomthau, ym`,
    args: ['Tân dược', year],
  }
}

export function vssFacilitySql(year) {
  return {
    sql: `SELECT ${hint('vss_bids')}
  COUNT(DISTINCT NULLIF(TRIM(ma_cskcb), '')) AS cskcb_n
FROM vss_bids
WHERE loai = ? AND nam = ?`,
    args: ['Tân dược', year],
  }
}

export function vssTiflashSql(year) {
  return {
    sql: `SELECT ${hint('vss_bids')}
  COALESCE(ma_tinh, '') AS ma_tinh,
  COALESCE(nhomthau, '') AS nhomthau,
  '' AS ym,
  SUM(COALESCE(thanhtien, 0)) AS sum_thanhtien,
  COUNT(*) AS cnt
FROM vss_bids
WHERE loai = ? AND nam = ?
GROUP BY ma_tinh, nhomthau`,
    args: ['Tân dược', year],
  }
}

export function davTiflashSql() {
  return [
    {
      sql: `SELECT ${hint('dav_drugs')} COUNT(*) AS cnt FROM dav_drugs`,
      args: [],
    },
    {
      sql: `SELECT ${hint('dav_drugs')} COALESCE(tag_id, '') AS tag_id, COUNT(*) AS cnt
FROM dav_drugs
GROUP BY tag_id`,
      args: [],
    },
    {
      sql: `SELECT SUM(CASE WHEN n <= 2 THEN 1 ELSE 0 END) AS blue,
  SUM(CASE WHEN n BETWEEN 3 AND 5 THEN 1 ELSE 0 END) AS mid,
  SUM(CASE WHEN n > 5 THEN 1 ELSE 0 END) AS red
FROM (
  SELECT ${hint('dav_drugs')} COUNT(DISTINCT COALESCE(NULLIF(TRIM(so_dang_ky), ''), id)) AS n
  FROM dav_drugs
  WHERE TRIM(COALESCE(hoat_chat, '')) <> ''
  GROUP BY LOWER(TRIM(hoat_chat))
) density`,
      args: [],
    },
    {
      sql: `SELECT SUM(CASE WHEN n <= 1 THEN 1 ELSE 0 END) AS f1,
  SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END) AS f2,
  SUM(CASE WHEN n = 3 THEN 1 ELSE 0 END) AS f3,
  SUM(CASE WHEN n >= 4 THEN 1 ELSE 0 END) AS f4
FROM (
  SELECT ${hint('dav_drugs')} COUNT(DISTINCT LOWER(TRIM(COALESCE(dang_bao_che, '')))) AS n
  FROM dav_drugs
  WHERE TRIM(COALESCE(hoat_chat, '')) <> ''
  GROUP BY LOWER(TRIM(hoat_chat))
) forms`,
      args: [],
    },
    {
      sql: `SELECT ${hint('dav_drugs')}
  SUM(ngay_cap >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH) AND ngay_cap <= CURDATE()) AS n3,
  SUM(ngay_cap >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) AND ngay_cap <= CURDATE()) AS n6,
  SUM(ngay_cap >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND ngay_cap <= CURDATE()) AS n12,
  SUM(ngay_het_han >= CURDATE() AND ngay_het_han <= DATE_ADD(CURDATE(), INTERVAL 6 MONTH)) AS expire6
FROM dav_drugs`,
      args: [],
    },
  ]
}

export function mscPricesTiflashSql(year) {
  return {
    sql: `SELECT ${hint('msc_prices')}
  COALESCE(province, '') AS province,
  COUNT(*) AS cnt,
  SUM(COALESCE(unit_price, 0)) AS pay
FROM msc_prices
WHERE published >= ?
GROUP BY province`,
    args: [`${year}-01-01`],
  }
}

export function mscTendersTiflashSql(year) {
  return {
    sql: `SELECT ${hint('msc_tenders')}
  COALESCE(status_code, '') AS status_code,
  COUNT(*) AS cnt
FROM msc_tenders
WHERE published >= ?
GROUP BY status_code`,
    args: [`${year}-01-01`],
  }
}

export function groupDigit(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/^[1-5]$/.test(text)) return text
  const match = text.match(/(?:nhóm|nhom|^n)\s*([1-5])\b/) || text.match(/\bn\s*([1-5])\b/)
  return match ? match[1] : ''
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function shapeVss(rows, year, facility = null) {
  const payG = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const provinces = new Map()
  let total = 0
  let payAll = 0
  for (const row of rows || []) {
    const pay = num(row.sum_thanhtien ?? row.pay)
    const cnt = num(row.cnt)
    total += cnt
    payAll += pay
    const digit = groupDigit(row.nhomthau)
    if (digit) payG[digit] += pay
    const code = String(row.ma_tinh || '')
    const bucket = provinces.get(code) || { code, pay: 0, cnt: 0 }
    bucket.pay += pay
    bucket.cnt += cnt
    provinces.set(code, bucket)
  }
  const provinceRows = [...provinces.values()]
    .map((row) => ({
      key: row.code || '_unk',
      code: row.code,
      name: provinceNameFromCode(row.code) || (row.code ? `Tỉnh mã ${row.code}` : 'Chưa xác định tỉnh'),
      value: row.pay,
      count: row.cnt,
      share: (row.pay / (payAll || 1)) * 100,
    }))
    .sort((a, b) => b.value - a.value)
  const top = provinceRows[0]
  const highShare = ((payG[1] + payG[2]) / (payAll || 1)) * 100
  const cskcb = facility ? num(facility.cskcb_n) : null
  const note = noteYear(year)
  return {
    section: 'vss',
    total,
    sampleSize: total,
    provinces: provinceRows,
    cached: false,
    source: 'rollup',
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
        mainValue: cskcb == null ? '—' : fmtInt(cskcb),
        unit: 'cơ sở',
        subtitle: note,
      },
      {
        key: 'region',
        scope: 'fixed',
        title: 'Tỉnh dẫn đầu doanh thu',
        mainValue: top ? top.name : '—',
        unit: top ? fmtMoney(top.value) : '',
        subtitle: note,
        subMetrics: [
          { id: 'prov_n', label: 'Số tỉnh', count: fmtInt(provinceRows.length), tone: 'neutral', info: true },
          { id: 'prov_share', label: 'Tỷ trọng', count: top ? `${top.share.toFixed(1)}%` : '—', tone: 'ok', info: true },
        ],
        explore: true,
      },
    ],
  }
}

function shapeDav(countRow, tagRows, density, forms, news) {
  const total = num(countRow?.cnt)
  const tags = { xanh: 0, vang: 0, cam: 0, xam: 0 }
  for (const row of tagRows || []) {
    const n = num(row.cnt)
    if (row.tag_id === TAG_XANH) tags.xanh += n
    else if (row.tag_id === TAG_VANG) tags.vang += n
    else if (row.tag_id === TAG_CAM) tags.cam += n
    else if (row.tag_id === TAG_XAM) tags.xam += n
    else tags.vang += n
  }
  const blue = num(density?.blue)
  const mid = num(density?.mid)
  const red = num(density?.red)
  const formTotal = num(forms?.f1) + num(forms?.f2) + num(forms?.f3) + num(forms?.f4)
  const note = 'Toàn bộ danh mục'
  return {
    section: 'dav',
    total,
    sampleSize: total,
    cached: false,
    source: 'tiflash',
    cards: [
      {
        key: 'density',
        scope: 'fixed',
        title: 'Mật độ SĐK/HC',
        mainValue: fmtInt(blue),
        unit: 'hoạt chất 1–2 SĐK',
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
        unit: 'sẵn sàng dự thầu',
        subtitle: note,
        subMetrics: [
          { id: 'tag_xanh', label: 'Sẵn sàng dự thầu', count: fmtInt(tags.xanh), tone: 'ok', patch: { _tag: TAG_XANH } },
          { id: 'tag_vang', label: 'Cần xác minh', count: fmtInt(tags.vang), tone: 'warn', patch: { _tag: TAG_VANG } },
          { id: 'tag_cam', label: 'Bẫy DM93', count: fmtInt(tags.cam), tone: 'danger', patch: { _tag: TAG_CAM } },
          { id: 'tag_xam', label: 'Đã hết hạn', count: fmtInt(tags.xam), tone: 'neutral', patch: { _tag: TAG_XAM } },
        ],
      },
      {
        key: 'forms',
        scope: 'fixed',
        title: 'Dạng bào chế / hoạt chất',
        mainValue: fmtInt(formTotal),
        unit: 'HC',
        subtitle: note,
        subMetrics: [
          { id: 'form_1', label: '1 dạng', count: fmtInt(forms?.f1), tone: 'ok', patch: { dosageFormCount: '1' } },
          { id: 'form_2', label: '2 dạng', count: fmtInt(forms?.f2), tone: 'warn', patch: { dosageFormCount: '2' } },
          { id: 'form_3', label: '3 dạng', count: fmtInt(forms?.f3), tone: 'warn', patch: { dosageFormCount: '3' } },
          { id: 'form_4', label: '4+ dạng', count: fmtInt(forms?.f4), tone: 'danger', patch: { dosageFormCount: '4' } },
        ],
      },
      {
        key: 'new',
        scope: 'fixed',
        title: 'SĐK mới cấp',
        mainValue: fmtInt(news?.n12),
        unit: 'trong 12 tháng',
        subtitle: note,
        subMetrics: [
          { id: 'new_3', label: '3 tháng', count: fmtInt(news?.n3), tone: 'ok', info: true },
          { id: 'new_6', label: '6 tháng', count: fmtInt(news?.n6), tone: 'ok', info: true },
          { id: 'new_12', label: '12 tháng', count: fmtInt(news?.n12), tone: 'neutral', info: true },
          { id: 'expire_6m', label: 'Sắp hết hạn', count: fmtInt(news?.expire6), tone: 'danger', info: true },
        ],
      },
    ],
  }
}

function shapeMscPrices(rows, year) {
  const total = (rows || []).reduce((sum, row) => sum + num(row.cnt), 0)
  const top = [...(rows || [])].sort((a, b) => num(b.cnt) - num(a.cnt))[0]
  return {
    section: 'msc_prices',
    total,
    sampleSize: total,
    cached: false,
    source: 'tiflash',
    cards: [
      {
        key: 'total',
        scope: 'fixed',
        title: 'Đơn giá trong năm',
        mainValue: fmtInt(total),
        unit: 'dòng',
        subtitle: noteYear(year),
        subMetrics: [
          { id: 'top', label: 'Tỉnh nhiều dòng', count: top?.province || '—', tone: 'neutral', info: true },
        ],
      },
    ],
  }
}

function shapeMscTenders(rows, year) {
  const total = (rows || []).reduce((sum, row) => sum + num(row.cnt), 0)
  return {
    section: 'msc_tenders',
    total,
    sampleSize: total,
    cached: false,
    source: 'tiflash',
    cards: [
      {
        key: 'total',
        scope: 'fixed',
        title: 'Gói thầu trong năm',
        mainValue: fmtInt(total),
        unit: 'gói',
        subtitle: noteYear(year),
      },
    ],
  }
}

async function rowsOf(query, spec) {
  const rs = await query(spec.sql, spec.args)
  return rs?.rows || []
}

export async function readSection(query, section, year = new Date().getFullYear()) {
  const kind = normalizeSection(section)
  try {
    if (kind === 'vss') {
      let rolled = []
      try {
        rolled = await rowsOf(query, vssRollupSql(year))
      } catch (error) {
        if (error?.status === 503) return emptyMetrics(kind)
        rolled = []
      }
      if (rolled.length) {
        let facility = null
        try {
          const fac = await rowsOf(query, vssFacilitySql(year))
          facility = fac[0] || null
        } catch {
          facility = null
        }
        const payload = shapeVss(rolled, year, facility)
        payload.source = 'rollup'
        return payload
      }
      const scanned = await rowsOf(query, vssTiflashSql(year))
      const payload = shapeVss(scanned, year, null)
      payload.source = 'tiflash'
      return payload
    }
    if (kind === 'dav') {
      const [countSql, tagSql, densitySql, formSql, newsSql] = davTiflashSql()
      const counts = await rowsOf(query, countSql)
      const tags = await rowsOf(query, tagSql)
      const density = await rowsOf(query, densitySql)
      const forms = await rowsOf(query, formSql)
      const news = await rowsOf(query, newsSql)
      return shapeDav(counts[0], tags, density[0], forms[0], news[0])
    }
    if (kind === 'msc_tenders') {
      const rows = await rowsOf(query, mscTendersTiflashSql(year))
      return shapeMscTenders(rows, year)
    }
    const rows = await rowsOf(query, mscPricesTiflashSql(year))
    return shapeMscPrices(rows, year)
  } catch {
    return emptyMetrics(kind)
  }
}

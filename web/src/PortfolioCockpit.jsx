import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { cloudPortfolio, supabaseConfigured } from './supabaseCloud'
import { LoadingOverlay, Modal, useLoadProgress } from './components'
import { fold, formatVnd, rivalUndercuts } from './portfolioRules'
import './portfolio.css'

const FILTERS = [
  ['all', 'Tất cả'],
  ['won', 'Lịch sử trúng'],
  ['new', 'SĐK mới'],
]

const base = import.meta.env.BASE_URL || '/'

const dateLabel = value => value ? new Date(value).toLocaleDateString('vi-VN') : 'Chưa có ngày'
const showYear = value => /^(?:19|20)\d{2}$/.test(String(value ?? '').trim()) ? String(value).trim() : '—'
const showDate = value => {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'
}
const quantityLabel = row => row.totalQuantity == null ? 'Chưa đủ dữ liệu' : `${Number(row.totalQuantity).toLocaleString('vi-VN')} ${row.quantityUnit || ''}`
function QuantityCell({ row }) {
  return <td className="pc-number">{row.quantityTotals?.length ? row.quantityTotals.map((total, i) => <div key={i}>{Number(total.quantity).toLocaleString('vi-VN')} {total.unit}<small>{total.source}</small></div>) : quantityLabel(row)}</td>
}

/** Full is every portfolio column. Sorted follows the DAV working set and is the default. */
const TABLE_COLUMNS = [
  { id: 'brand', label: 'Biệt dược · SĐK', sorted: 1 },
  { id: 'year', label: 'Năm cấp', sorted: 2 },
  { id: 'inn', label: 'Hoạt chất', sorted: 3 },
  { id: 'strength', label: 'Hàm lượng', sorted: 4 },
  { id: 'form', label: 'Dạng bào chế', sorted: 5 },
  { id: 'exp', label: 'Ngày hết hạn SĐK', sorted: 6 },
  { id: 'registrant', label: 'Tên công ty đăng ký', sorted: 7 },
  { id: 'group', label: 'Nhóm thầu', sorted: 8 },
  { id: 'decision', label: 'Số quyết định' },
  { id: 'sdk', label: 'SĐK DAV', sorted: 9 },
  { id: 'price', label: 'Đơn giá gần nhất', sorted: 10 },
  { id: 'qty', label: 'SL trúng theo nguồn', sorted: 11 },
  { id: 'history', label: 'Gói gần nhất / Lịch sử', sorted: 12 },
]

function columnsFor(mode) {
  if (mode === 'full') return TABLE_COLUMNS
  return TABLE_COLUMNS.filter((column) => column.sorted).sort((a, b) => a.sorted - b.sorted)
}

function PriceCell({ row, compare = false, alert = false }) {
  const delta = row.priceDeltaPct
  const comparable = delta != null && !row.own
  return <td className={alert ? 'pc-price-alert' : comparable ? delta > 0 ? 'pc-price-higher' : delta < 0 ? 'pc-price-lower' : '' : ''}>
    <span className="pc-price-line">
      <strong>{row.mscPrice == null ? '—' : `${formatVnd(row.mscPrice)} / ${row.mscUnit || '?'}`}</strong>
      {alert && (
        <button type="button" className="pc-alert" aria-label="Cần chú ý" onClick={(event) => event.stopPropagation()}>
          !
          <span className="pc-alert-pop" role="tooltip">Cần chú ý</span>
        </button>
      )}
    </span>
    {row.latestAward && <small>{row.latestAward.source} · {dateLabel(row.latestAward.date)}</small>}
    {compare && comparable && <small>{row.comparisonNote}</small>}
    {compare && !row.own && (comparable ? <small>{delta === 0 ? 'Bằng giá Bảo An' : `${delta > 0 ? 'Cao' : 'Thấp'} hơn ${Math.abs(delta).toLocaleString('vi-VN', {maximumFractionDigits: 2})}% · ${Math.abs(delta) > 5 ? '>5%' : Math.abs(delta) === 5 ? '=5%' : '<5%'}`}</small> : <small>{row.comparisonNote}</small>)}
  </td>
}

function AwardHistory({ target, knownItems, onClose, remote = false }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!target) {
      setItems(null)
      setError('')
      setLoading(false)
      return undefined
    }
    let live = true
    setError('')
    if (Array.isArray(knownItems)) {
      setItems(knownItems)
      setLoading(false)
      return () => { live = false }
    }
    setItems(null)
    setLoading(true)
    const load = remote
      ? cloudPortfolio(target.id, target.regNumber)
      : api.baoanPortfolio(target.id, target.regNumber)
    load
      .then(p => { if (live) setItems(p.items || []) })
      .catch(e => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [target, knownItems, remote])
  const progress = useLoadProgress(loading, 'Đang tải lịch sử trúng')
  return <Modal open={!!target} onClose={onClose} width={1280} title={`Lịch sử trúng · ${target?.name || ''}`} subtitle={`${target?.regNumber || ''} · ${target?.manufacturer || ''}`}>
    <LoadingOverlay show={loading || progress.percent > 0} percent={progress.percent} message={progress.message} etaSec={progress.etaSec} />
    <p className="pc-meta">Các kết quả của SĐK này và cùng hoạt chất, cùng nhà sản xuất; từng dòng ghi riêng hàm lượng, dạng và nhóm. Nhấp đúp dòng có liên kết để mở hồ sơ MSC. Số lượng là lượng trúng thầu theo nguồn, chưa phải lượng bán thực tế.</p>
    {error && <p role="alert">{error}</p>}
    {items && <AwardTable items={items} />}
  </Modal>
}

function AwardTable({ items }) {
  const [visible, setVisible] = useState(50)
  const sentinel = useRef(null)
  useEffect(() => { setVisible(50) }, [items])
  useEffect(() => {
    if (visible >= items.length || !sentinel.current || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(count => Math.min(count + 50, items.length))
    }, { root: sentinel.current.parentElement, rootMargin: '160px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [items, visible])
  const sourceUrl = row => /^https:\/\/muasamcong\.mpi\.gov\.vn\//.test(row.sourceUrl || '') ? row.sourceUrl : null
  return <div className="pc-table-wrap pc-history-scroll"><table className="pc-table pc-history"><thead><tr><th>Gói / Quyết định</th><th>Thời điểm</th><th>Tên thuốc</th><th>SĐK</th><th>Hoạt chất</th><th>Hàm lượng</th><th>Dạng bào chế</th><th>Nhóm</th><th>Cơ sở / Tỉnh</th><th>Đơn giá</th><th>Số lượng</th><th>Nguồn</th></tr></thead><tbody>{items.slice(0, visible).map((r, i) => <tr key={i} onDoubleClick={() => { const url = sourceUrl(r); if (url) window.open(url, '_blank', 'noopener,noreferrer') }}>
      <td><strong>{r.tenderNo || 'Chưa có mã gói'}</strong><small>{r.decision || 'Chưa có số quyết định'}</small></td><td>{dateLabel(r.date)}<small>{r.dateKind}</small></td><td>{r.name || '—'}</td><td>{r.registration || '—'}</td><td>{r.ingredient || r.inn || '—'}</td><td>{r.strength || '—'}</td><td>{r.dosageForm || '—'}</td><td>{r.group || '—'}</td><td>{r.buyer || '—'}<small>{r.province}</small></td><td className="pc-number">{r.price == null ? '—' : formatVnd(r.price)}<small>/ {r.unit || '?'}</small></td><td className="pc-number">{r.quantity == null ? '—' : Number(r.quantity).toLocaleString('vi-VN')}</td><td>{sourceUrl(r) ? <a href={sourceUrl(r)} target="_blank" rel="noreferrer">Hồ sơ MSC ↗</a> : <span>{r.source}<small>Chưa có link hồ sơ MSC</small></span>}</td>
    </tr>)}</tbody></table>{visible < items.length && <div ref={sentinel}><button type="button" className="pc-history-link" onClick={() => setVisible(count => Math.min(count + 50, items.length))}>Tải thêm ({visible}/{items.length.toLocaleString('vi-VN')})</button></div>}{!items.length && <p className="pc-empty">Chưa có kết quả trúng thầu đúng SĐK này trong dữ liệu đã tải.</p>}</div>
}

function PortfolioLookup({ items, registrations = false }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const found = useMemo(() => items.filter(row => fold([row.brandName, row.name, row.registration, row.regNumber, row.inn, row.ingredient, row.buyer, row.province, row.tenderNo, row.strength, row.dosageForm, row.ctyDangKy].filter(Boolean).join(' ')).includes(fold(query))), [items, query])
  const shown = found.slice(page * 50, page * 50 + 50)
  return <section aria-label={registrations ? 'SĐK cấp mới trong 12 tháng gần nhất' : 'Tra cứu từng kết quả trúng'}>
    <label className="pc-search">Tìm thuốc, hoạt chất, SĐK, cơ sở hoặc gói<input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Nhập để lọc kết quả…" /></label>
    <p className="pc-meta">{found.length.toLocaleString('vi-VN')} {registrations ? 'SĐK cấp trong 12 tháng gần nhất · mở từng SĐK để xem thuốc Bảo An khớp' : 'dòng trúng thầu · từng gói và thuốc ghi riêng'}</p>
    {registrations ? <div className="pc-table-wrap"><table className="pc-table pc-registrations"><thead><tr><th>SĐK</th><th>Tên thuốc</th><th>Ngày cấp</th><th>Hoạt chất</th><th>Hàm lượng · Dạng</th><th>Nhóm thầu</th><th>Công ty đăng ký</th><th>Thuốc Bảo An khớp</th></tr></thead><tbody>{shown.map(row => <Fragment key={row.regNumber}><tr><td><strong>{row.regNumber}</strong></td><td>{row.name || '—'}</td><td>{showDate(row.grantDate)}</td><td>{row.inn}</td><td>{row.strength}<small>{row.dosageForm}</small></td><td>{row.groupKnown ? row.groups.map(g => String(g).startsWith('N') ? g : `N${g}`).join(', ') : 'Chưa có dữ liệu nhóm để xác nhận'}</td><td>{row.ctyDangKy || '—'}</td><td><button type="button" className="pc-history-link" aria-expanded={expanded === row.regNumber} onClick={() => setExpanded(expanded === row.regNumber ? null : row.regNumber)}>{row.matches.length} thuốc · {expanded === row.regNumber ? 'Thu gọn' : 'Xem thuốc khớp'}</button></td></tr>{expanded === row.regNumber && <tr className="pc-sdk-expand"><td colSpan={8}><ul className="pc-sdk-panel">{row.matches.map(match => <li key={match.id}><strong>{match.brandName}</strong> · {match.inn} · {match.strength} · {match.dosageForm} · {match.groups.map(g => String(g).startsWith('N') ? g : `N${g}`).join(', ') || 'Chưa rõ nhóm'}</li>)}</ul></td></tr>}</Fragment>)}</tbody></table>{!shown.length && <p className="pc-empty">Không có SĐK mới khớp.</p>}</div> : <AwardTable items={found} />}
    {registrations && found.length > 50 && <div className="pc-chips"><button disabled={!page} onClick={() => setPage(page - 1)}>Trước</button><span>Trang {page + 1}/{Math.ceil(found.length / 50)}</span><button disabled={(page + 1) * 50 >= found.length} onClick={() => setPage(page + 1)}>Sau</button></div>}
  </section>
}

function pct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}

function plantKey(name) {
  return fold(name).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function passes(row, filter, plant) {
  if (plant && plantKey(row.manufacturer) !== plant) return false
  if (filter === 'gold') return !!row.isNicheGold
  if (filter === 'be') return row.recommendation === 'Lap de an BE len Nhom 3' || !!row.be?.recommend
  if (filter === 'dm93') return !!row.dm93
  if (filter === 'won') return !!row.wonBid
  return true
}

function tone(color) {
  if (color === 'GREEN') return 'ok'
  if (color === 'YELLOW') return 'warn'
  return 'danger'
}

function pathOf(geometry, project) {
  const rings = geometry?.type === 'Polygon'
    ? geometry.coordinates
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates.flat()
      : []
  return rings.map((ring) => {
    if (!ring?.length) return ''
    return ring.map((pt, index) => {
      const [x, y] = project(pt[0], pt[1])
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ') + ' Z'
  }).join(' ')
}

function VietnamMap({ provinces }) {
  const [geo, setGeo] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    fetch(`${base}data/vn-provinces.geojson`, { signal: abort.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Không tải được bản đồ tỉnh.')
        return res.json()
      })
      .then((data) => setGeo(data))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
    return () => abort.abort()
  }, [])

  const lookup = useMemo(() => {
    const byCode = new Map()
    const byName = new Map()
    for (const row of provinces || []) {
      const code = String(row.maTinh || '').trim().padStart(2, '0')
      if (row.maTinh) byCode.set(code, row)
      if (row.tenTinh) byName.set(fold(row.tenTinh), row)
    }
    return { byCode, byName }
  }, [provinces])

  const max = Math.max(0, ...(provinces || []).map((row) => Number(row.value) || 0))
  const project = useMemo(() => {
    const features = geo?.features || []
    let minX = 180
    let maxX = -180
    let minY = 90
    let maxY = -90
    const visit = (pt) => {
      minX = Math.min(minX, pt[0])
      maxX = Math.max(maxX, pt[0])
      minY = Math.min(minY, pt[1])
      maxY = Math.max(maxY, pt[1])
    }
    for (const feature of features) {
      const coords = feature.geometry?.type === 'Polygon'
        ? feature.geometry.coordinates
        : (feature.geometry?.coordinates || []).flat()
      for (const ring of coords) ring.forEach(visit)
    }
    const width = 220
    const height = 380
    return (lon, lat) => {
      const x = ((lon - minX) / Math.max(0.01, maxX - minX)) * width
      const y = ((maxY - lat) / Math.max(0.01, maxY - minY)) * height
      return [x, y]
    }
  }, [geo])

  if (error) return <p className="pc-empty">{error}</p>
  if (!geo) return <p className="pc-empty">Đang tải bản đồ…</p>
  if (!provinces?.length) return <p className="pc-empty">Chưa có dòng tiền BHYT theo tỉnh cho hoạt chất này từ 2025.</p>

  return (
    <svg className="pc-map" viewBox="0 0 220 380" role="img" aria-label="Bản đồ dòng tiền theo tỉnh">
      {geo.features.map((feature) => {
        const code = String(feature.properties?.ma || '').padStart(2, '0')
        const hit = lookup.byCode.get(code) || lookup.byName.get(fold(feature.properties?.name || ''))
        const value = Number(hit?.value) || 0
        const t = max > 0 && value > 0 ? Math.sqrt(value / max) : 0
        const fill = t ? `rgba(15, 92, 107, ${0.18 + t * 0.82})` : '#e7edf0'
        return (
          <path
            key={code || feature.properties?.name}
            d={pathOf(feature.geometry, project)}
            fill={fill}
            stroke="#ffffff"
            strokeWidth="0.6"
          >
            <title>{`${feature.properties?.name || code}: ${value ? formatVnd(value) : 'không có dữ liệu'}`}</title>
          </path>
        )
      })}
    </svg>
  )
}

function productCell(column, row, { sdkOpen, onToggleSdk, onHistory }) {
  if (column.id === 'brand') return <td key={column.id}><strong>{row.brandName}</strong><small>{row.regNumber || 'Chưa khớp SĐK'}</small></td>
  if (column.id === 'year') return <td key={column.id}>{showYear(row.grantYear)}</td>
  if (column.id === 'inn') return <td key={column.id}>{row.inn || '—'}</td>
  if (column.id === 'strength') return <td key={column.id}>{row.strength || '—'}</td>
  if (column.id === 'form') return <td key={column.id}>{row.dosageForm || '—'}</td>
  if (column.id === 'exp') return <td key={column.id}>{showDate(row.expDate)}</td>
  if (column.id === 'registrant') return <td key={column.id}>{row.ctyDangKy || '—'}</td>
  if (column.id === 'maker') return <td key={column.id}>{row.manufacturer || '—'}</td>
  if (column.id === 'group') return <td key={column.id}>{row.mscGroup || 'Chưa có'}</td>
  if (column.id === 'decision') return <td key={column.id}>{row.soQuyetDinh || '—'}</td>
  if (column.id === 'sdk') return <td key={column.id}><button type="button" className={`pc-dot ${tone(row.statusColor)}`} aria-expanded={sdkOpen} aria-controls={`pc-sdk-${row.id}`} aria-label={`SĐK đối thủ của ${row.brandName}: ${row.competitorCount}`} onClick={event => { event.stopPropagation(); onToggleSdk(row.id) }}>{row.competitorCount}</button></td>
  if (column.id === 'price') return <PriceCell key={column.id} row={row} alert={rivalUndercuts(row)} />
  if (column.id === 'qty') return <QuantityCell key={column.id} row={row} />
  return <td key={column.id}>{row.latestAward ? <><strong>{row.latestAward.sourceUrl ? <a href={row.latestAward.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{row.latestAward.tenderNo || row.latestAward.decision || 'Hồ sơ MSC'} ↗</a> : (row.latestAward.tenderNo || row.latestAward.decision || 'Chưa có mã gói')}</strong>{!row.latestAward.sourceUrl && <small>Chưa có link hồ sơ MSC</small>}<small>{dateLabel(row.latestAward.date)} · {row.latestAward.buyer}</small></> : <small>Chưa có kết quả</small>}<button className="pc-history-link" onClick={event => { event.stopPropagation(); onHistory({ id: row.id, regNumber: row.regNumber, name: row.brandName, manufacturer: row.manufacturer }) }}>Lịch sử ({row.awardCount || 0}) ↗</button></td>
}

function rivalCell(column, row, parent, onHistory) {
  const open = () => onHistory({ id: parent.id, regNumber: row.regNumber, name: row.name, manufacturer: row.manufacturer })
  if (column.id === 'brand') return <td key={column.id}><strong>{row.name || '—'}</strong><small>{row.regNumber}</small></td>
  if (column.id === 'year') return <td key={column.id}>{showYear(row.grantYear)}</td>
  if (column.id === 'inn') return <td key={column.id}>{row.inn || '—'}</td>
  if (column.id === 'strength') return <td key={column.id}>{row.strength || '—'}</td>
  if (column.id === 'form') return <td key={column.id}>{row.dosageForm || '—'}</td>
  if (column.id === 'exp') return <td key={column.id}>{showDate(row.expDate)}</td>
  if (column.id === 'registrant') return <td key={column.id}>{row.ctyDangKy || '—'}</td>
  if (column.id === 'maker') return <td key={column.id}>{row.manufacturer || '—'}</td>
  if (column.id === 'group') return <td key={column.id}>{row.mscGroup || 'Chưa có'}</td>
  if (column.id === 'decision') return <td key={column.id}>{row.soQuyetDinh || '—'}</td>
  if (column.id === 'sdk') return <td key={column.id}>—</td>
  if (column.id === 'price') return <PriceCell key={column.id} row={row} compare />
  if (column.id === 'qty') return <QuantityCell key={column.id} row={row} />
  return <td key={column.id}>{row.latestAward && <><strong>{row.latestAward.sourceUrl ? <a href={row.latestAward.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{row.latestAward.tenderNo || row.latestAward.decision || 'Hồ sơ MSC'} ↗</a> : (row.latestAward.tenderNo || row.latestAward.decision || 'Chưa có mã gói')}</strong>{!row.latestAward.sourceUrl && <small>Chưa có link hồ sơ MSC</small>}<small>{dateLabel(row.latestAward.date)}</small></>}<button className="pc-history-link" onClick={open}>Lịch sử ({row.awardCount || 0}) ↗</button></td>
}

function PortfolioTable({ rows, mode, selectedId, openSdkId, onSelect, onToggleSdk, onHistory }) {
  const columns = columnsFor(mode)
  return <table className={`pc-table pc-products${mode === 'sorted' ? ' is-sorted' : ''}`}>
    <thead><tr>{columns.map(column => <th key={column.id}>{column.label}</th>)}</tr></thead>
    <tbody>{rows.map(row => {
      const sdkOpen = openSdkId === row.id
      const openHistory = item => onHistory({ id: row.id, regNumber: item.regNumber || row.regNumber, name: item.brandName || item.name || row.brandName, manufacturer: item.manufacturer })
      return <Fragment key={row.id}>
        <tr className={row.id === selectedId ? 'on' : ''} onClick={() => onSelect(row.id)} onDoubleClick={() => openHistory(row)}>
          {columns.map(column => productCell(column, row, { sdkOpen, onToggleSdk, onHistory }))}
        </tr>
        {sdkOpen && <>
          <tr className="pc-sdk-label"><td colSpan={columns.length} id={`pc-sdk-${row.id}`}>SĐK khác cùng hoạt chất, hàm lượng và dạng bào chế · nhấp đúp dòng để xem các gói thầu</td></tr>
          {(row.competitors || []).map(rival => <tr className="pc-rival" key={rival.regNumber} onDoubleClick={() => openHistory(rival)}>
            {columns.map(column => rivalCell(column, rival, row, onHistory))}
          </tr>)}
          {!row.competitors?.length && <tr><td colSpan={columns.length}>Không có SĐK khác trong cùng ô kỹ thuật.</td></tr>}
        </>}
      </Fragment>
    })}</tbody>
  </table>
}

export default function PortfolioCockpit({ localMode }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [plant, setPlant] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [openSdkId, setOpenSdkId] = useState(null)
  const [historyTarget, setHistoryTarget] = useState(null)
  const [tableMode, setTableMode] = useState('sorted')
  const catalogProgress = useLoadProgress(loading && !data, 'Đang ghép danh mục')

  useEffect(() => {
    if (!localMode && !supabaseConfigured) return undefined
    let live = true
    setLoading(true)
    setError('')
    const load = localMode ? api.baoanPortfolio() : cloudPortfolio()
    load
      .then((payload) => { if (live) setData(payload) })
      .catch((err) => { if (live) setError(err.message || 'Không tải được portfolio') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [localMode])

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null)
      return undefined
    }
    const embedded = data?.details?.[selectedId]
    if (embedded) {
      setDetail({
        selectedId,
        provinces: embedded.provinces || [],
        facilities: embedded.facilities || [],
      })
      return undefined
    }
    let live = true
    setDetail(null)
    const load = localMode ? api.baoanPortfolio(selectedId) : cloudPortfolio(selectedId)
    load
      .then((payload) => { if (live) setDetail(payload) })
      .catch(() => { if (live) setDetail(null) })
    return () => { live = false }
  }, [localMode, selectedId, data])

  const knownHistory = useMemo(() => {
    if (!historyTarget) return undefined
    const histories = data?.details?.[historyTarget.id]?.histories
    if (!histories || !Object.prototype.hasOwnProperty.call(histories, historyTarget.regNumber)) return undefined
    return histories[historyTarget.regNumber]
  }, [data, historyTarget])

  const rows = data?.rows || []
  const visible = useMemo(
    () => rows.filter((row) => passes(row, filter, plant)),
    [rows, filter, plant],
  )
  const selected = rows.find((row) => row.id === selectedId) || null
  const kpis = data?.kpis

  return (
    <section className="pc">
      <header className="pc-head">
        <div>
          <p className="pc-kicker">Bảo An Pharma</p>
          <h1>Danh mục Bảo An · đối chiếu thuốc và lịch sử trúng thầu</h1>
          <p className="pc-lead">Giá và lịch sử theo đúng SĐK; dòng tiền BHYT là giá trị trúng thầu của thị trường cùng hoạt chất từ 2025.</p>
        </div>
      </header>

      <LoadingOverlay show={(loading && !data) || catalogProgress.percent > 0} percent={catalogProgress.percent} message={catalogProgress.message} etaSec={catalogProgress.etaSec} />
      {error && <div className="pc-banner" role="alert">{error}</div>}

      {kpis && (
        <div className="pc-kpis">
          <article><span>Tổng doanh thu trúng thầu 12 tháng</span><strong>{formatVnd(kpis.awards12m?.revenue)} VNĐ</strong><small>{showDate(kpis.awards12m?.from)} – {showDate(kpis.awards12m?.to)}</small></article>
          <article><span>Số lượng thuốc trúng thầu 12 tháng</span>{(kpis.awards12m?.quantityTotals || []).filter(total => total.unit?.trim().toLowerCase() !== 'gói').map(total => <strong key={total.unit}>{Number(total.quantity).toLocaleString('vi-VN')} {total.unit?.toLowerCase() === 'gói' ? 'gói thuốc' : total.unit}</strong>)}<small>Số lượng theo kết quả thầu, chưa phải lượng bán thực tế</small></article>
          <article><span>Số gói thầu trúng 12 tháng</span><strong>{(kpis.awards12m?.packages || 0).toLocaleString('vi-VN')}</strong><small>{(kpis.awards12m?.records || 0).toLocaleString('vi-VN')} dòng kết quả</small></article>
          <article><span>An toàn chu kỳ</span><strong>{pct(kpis.cycle.greenPct)} xanh</strong><small>{kpis.cycle.ready36} SKU đủ 36 tháng</small></article>
        </div>
      )}

      <div className="pc-filters">
        <div className="pc-chips" role="tablist" aria-label="Lọc danh mục">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'on' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        {filter === 'all' && <div className="pc-chips" role="group" aria-label="Chế độ cột">
          {[['sorted', 'Sorted'], ['full', 'Full']].map(([id, label]) => (
            <button key={id} type="button" className={tableMode === id ? 'on' : ''} aria-pressed={tableMode === id} onClick={() => setTableMode(id)}>{label}</button>
          ))}
        </div>}
        {filter === 'all' && <label>
          Xưởng CMO
          <select value={plant} onChange={(event) => setPlant(event.target.value)}>
            <option value="">Tất cả xưởng</option>
            {(kpis?.cmo.shares || []).map((share) => (
              <option key={plantKey(share.name)} value={plantKey(share.name)}>{share.name} ({share.count})</option>
            ))}
          </select>
        </label>}
      </div>

      {filter === 'won' ? <PortfolioLookup key="awards" items={data?.awardRows || []} /> : filter === 'new' ? <PortfolioLookup key="registrations" items={data?.newRegistrations || []} registrations /> : <div className="pc-table-wrap">
        <PortfolioTable
          rows={visible}
          mode={tableMode}
          selectedId={selectedId}
          openSdkId={openSdkId}
          onSelect={setSelectedId}
          onToggleSdk={(id) => setOpenSdkId(openSdkId === id ? null : id)}
          onHistory={setHistoryTarget}
        />
        {!loading && !visible.length && <p className="pc-empty">Không có SKU nào khớp bộ lọc.</p>}
      </div>}
      <p className="pc-meta">Đã ghép {rows.reduce((n, r) => n + (r.awardCount || 0), 0).toLocaleString('vi-VN')} kết quả của thuốc Bảo An trong dữ liệu đã tải. SĐK cũ–mới chỉ được nối khi DAV xác nhận; chưa có kết quả không có nghĩa là chưa từng trúng. Số lượng là lượng trúng thầu, chưa phải lượng bán thực tế.</p>
      <AwardHistory target={historyTarget} knownItems={knownHistory} remote={!localMode} onClose={() => setHistoryTarget(null)} />

      {filter === 'all' && selected && (
        <article className="pc-dossier">
          <header>
            <div>
              <p className="pc-kicker">{selected.category}</p>
              <h2>{selected.brandName}</h2>
              <p>{[selected.inn, selected.dosageForm, selected.strength, selected.packing].filter(Boolean).join(' · ')}</p>
            </div>
            <a href={selected.webUrl} target="_blank" rel="noreferrer">Trang sản phẩm ↗</a>
          </header>
          {selected.strategyNote && <p className="pc-note">{selected.strategyNote}</p>}
          <div className="pc-dossier-grid">
            <section>
              <h3>Toán BE chuyển nhóm</h3>
              <dl className="pc-math">
                <div><dt>Chi phí BE mặc định</dt><dd>{formatVnd(selected.be?.cost)}</dd></div>
                <div><dt>Trung vị giá nhóm 3</dt><dd>{formatVnd(selected.be?.medianGroup3)}</dd></div>
                <div><dt>Trung vị giá nhóm 4</dt><dd>{formatVnd(selected.be?.medianGroup4)}</dd></div>
                <div><dt>Khối lượng ước tính</dt><dd>{Number(selected.be?.units || 0).toLocaleString('vi-VN')}</dd></div>
                <div><dt>Chênh lệch</dt><dd>{formatVnd(selected.be?.delta)}</dd></div>
              </dl>
              <p>{selected.be?.recommend ? 'Chênh lệch vượt chi phí BE: nên lập đề án lên Nhóm 3.' : 'Chưa đủ chênh lệch giá để tự khuyến nghị BE từ dòng tiền hiện có.'}</p>
              {selected.be?.note && <p className="pc-note">{selected.be.note}</p>}
            </section>
          <section className="pc-heat">
            <h3>Dòng tiền cùng hoạt chất theo tỉnh</h3>
            {!detail ? <p className="pc-empty">Đang tải bản đồ và danh sách cơ sở…</p> : (
            <div className="pc-heat-grid">
              <VietnamMap provinces={detail.provinces || []} />
              <div>
                {(detail.facilities || []).length ? (
                  <ol className="pc-facilities">
                    {detail.facilities.map((item) => (
                      <li key={`${item.name}-${item.province}`}>
                        <span>{item.name}</span>
                        <small>{item.province || '—'}</small>
                        <strong>{formatVnd(item.value)}</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="pc-empty">Chưa có cơ sở khám chữa bệnh nào trong dòng tiền của hoạt chất này.</p>
                )}
              </div>
            </div>
            )}
          </section>
          </div>
        </article>
      )}
    </section>
  )
}

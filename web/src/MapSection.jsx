import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api, fmtDateTime } from './api'
import { cloudCatalog, cloudMap, cloudMscSearch, cloudSuggest } from './supabaseCloud'
import { StatCards } from './areaStats'
import { DetailModal, Field, SuggestField } from './components'
import { fmtInt, fmtMoney, fmtVndCompact } from './metrics'
import { VN_PROVINCES } from './vnProvinces'
import { baoanLinesForIngredient, isExactBaoanMatch } from './baoanIngredient'
import {
  REGION_ORDER,
  heatFill,
  heatFillValue,
  heatSwatch,
  cameraForIntent,
  focusAfterClear,
  focusAfterProvinceClick,
  focusAfterRegionClick,
  leafletBoundsFor,
  meanLatLon,
  rankByValue,
  regionOf,
  showProvinceLabels,
} from './mapGeo'
import { selectListedDot } from './mapSelection'

const STATUS_OPTIONS = [
  ['', 'Mọi trạng thái'],
  ['open', 'Đang mời thầu'],
  ['review', 'Đang xét kết quả'],
  ['closed', 'Vừa đóng thầu'],
]

const EMPTY = {
  source: 'vss',
  hoatchat: '',
  region: '',
  province: '',
  group: '',
  status: '',
  q: '',
}

const NORTH_VIEW = [21.6, 105.2]

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

const POPUP_WIDTH = 400

function concatChunks(chunks, received) {
  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function fetchJsonWithProgress(url, onRatio) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('geo')
  const total = Number(res.headers.get('Content-Length') || 0)
  if (!res.body || !Number.isFinite(total) || total <= 0) {
    onRatio?.(null)
    return res.json()
  }
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onRatio?.(Math.max(0, Math.min(1, received / total)))
  }
  const text = new TextDecoder().decode(concatChunks(chunks, received))
  return JSON.parse(text)
}

function IngredientName({ name, hits }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState('')
  const [box, setBox] = useState(null)
  const anchorRef = useRef(null)
  const hideTimer = useRef(0)
  const show = () => {
    window.clearTimeout(hideTimer.current)
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect) {
      setBox({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 16)),
      })
    }
    setOpen(true)
  }
  const hide = () => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setOpen(false), 180)
  }
  const copyReg = async (reg) => {
    const text = String(reg || '')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const input = document.createElement('textarea')
      input.value = text
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    }
    setCopied(text)
    window.setTimeout(() => setCopied((current) => (current === text ? '' : current)), 1600)
  }
  if (!hits.length) return <strong>{name}</strong>
  return (
    <span
      className="map-inn"
      ref={anchorRef}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) hide()
      }}
    >
      <strong>{name}</strong>
      {open && (
        <span className="map-inn-pop" role="tooltip" style={box || undefined} onMouseEnter={show} onMouseLeave={hide}>
          <p>Khớp danh mục Bảo An</p>
          <ul>
            {hits.map((hit) => {
              const meta = [hit.strength, hit.form].filter(Boolean).join(' · ')
              return (
                <li key={`${hit.reg}-${hit.brand}-${hit.strength}`}>
                  <span className="map-inn-line">
                    <strong>{hit.brand || 'Thuốc Bảo An'}</strong>
                    {meta && <span className="map-inn-meta">{meta}</span>}
                    <span className="map-inn-reg">SĐK {hit.reg || '—'}</span>
                  </span>
                  {hit.reg && (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => copyReg(hit.reg)}
                    >
                      {copied === hit.reg ? 'Đã chép' : 'Chép'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </span>
      )}
    </span>
  )
}

function hitCount(row) {
  return Array.isArray(row?.baoanHits) ? row.baoanHits.length : 0
}

function matchRank(row) {
  const level = String(row?.match || '').trim()
  if (level === 'exact') return 3
  if (level === 'near') return 2
  return hitCount(row) > 0 ? 1 : 0
}

function rowHits(row, catalog, fromScope) {
  if (Array.isArray(row.baoanHits) && row.baoanHits.length) return row.baoanHits.slice(0, 8)
  if (fromScope || row.match) return []
  return baoanLinesForIngredient(row.name, catalog).slice(0, 8)
}

function rowTone(row, hits) {
  const level = String(row?.match || '').trim()
  if (level === 'exact') return 'is-baoan'
  if (level === 'near') return 'is-baoan-near'
  return hits.length ? 'is-baoan' : ''
}

function IngredientLineLabel({ row }) {
  const meta = [row.strength, row.form].filter(Boolean).join(' · ')
  if (!meta) return <strong>{row.name}</strong>
  return (
    <span className="map-line-label">
      <strong>{row.name}</strong>
      <small className="map-line-meta">{meta}</small>
    </span>
  )
}

function IngredientRank({ rows = [], title, note, valueLabel, qtyLabel, catalog = [], pinMatches = false, fromScope = false }) {
  const [by, setBy] = useState('value')
  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const delta = (Number(b[by]) || 0) - (Number(a[by]) || 0)
      if (!pinMatches) return delta
      const mark = matchRank(b) - matchRank(a)
      return mark || delta
    })
    return copy
  }, [rows, by, pinMatches])
  const lines = catalog || []
  return (
    <section className="map-rank" aria-label={title || 'Hoạt chất'}>
      <header>
        <h3>{title || 'Hoạt chất trúng thầu'}</h3>
        <div className="map-rank-switch" role="group" aria-label="Cách xếp hạng">
          <button type="button" aria-pressed={by === 'value'} onClick={() => setBy('value')}>{valueLabel || 'Giá trị'}</button>
          <button type="button" aria-pressed={by === 'quantity'} onClick={() => setBy('quantity')}>{qtyLabel || 'Số lượng'}</button>
        </div>
      </header>
      {note && <p className="metric-lead">{note}</p>}
      <div className="map-rank-scroll">
        {sorted.length ? (
          <ol>
            {sorted.map((row, index) => {
              const hits = rowHits(row, lines, fromScope)
              const tone = rowTone(row, hits)
              return (
                <li key={`${row.name}-${row.strength}-${row.form}-${index}`} className={tone}>
                  <span className="price-rank">{index + 1}</span>
                  {hits.length ? (
                    <span className="map-line-label">
                      <IngredientName name={row.name} hits={hits} />
                      {(row.strength || row.form) && (
                        <small className="map-line-meta">{[row.strength, row.form].filter(Boolean).join(' · ')}</small>
                      )}
                    </span>
                  ) : <IngredientLineLabel row={row} />}
                  <em>{by === 'quantity' ? fmtInt(row.quantity) : fmtVndCompact(row.value)}</em>
                </li>
              )
            })}
          </ol>
        ) : <p className="metric-lead">Chưa có hoạt chất trong 12 tháng này.</p>}
      </div>
    </section>
  )
}

function PackagePanel({ dot, onClose, onDetail }) {
  return (
    <div className="map-package">
      <header>
        <p className="metric-kicker">{dot.statusLabel || 'Gói thầu'}</p>
        <h2>{dot.name || dot.tenderNo || 'Gói thầu'}</h2>
        <button type="button" className="btn ghost sm" onClick={onClose}>Về tổng</button>
      </header>
      {dot.status === 'closed' && (
        <p className="map-winner">
          <span>Nhà thầu trúng</span>
          <strong>{dot.winner || dot.winnerCode || 'Chưa có tên trong hồ sơ'}</strong>
          {dot.winnerPrice > 0 && <em>{fmtVndCompact(dot.winnerPrice)}</em>}
        </p>
      )}
      <dl>
        <div><dt>Mã TBMT</dt><dd>{dot.tenderNo || '—'}</dd></div>
        <div><dt>Chủ đầu tư</dt><dd>{dot.buyer || '—'}</dd></div>
        <div><dt>Tỉnh</dt><dd>{dot.province || '—'}</dd></div>
        <div><dt>Huyện / xã</dt><dd>{dot.district || '—'}</dd></div>
        <div><dt>Giá gói</dt><dd>{fmtVndCompact(dot.value)}</dd></div>
        <div><dt>Đóng thầu</dt><dd>{fmtDateTime(dot.closeDate) || '—'}</dd></div>
        <div><dt>Hình thức</dt><dd>{dot.bidForm || '—'}</dd></div>
      </dl>
      <p className="metric-lead">{dot.placeNote}</p>
      <button type="button" className="btn secondary sm" onClick={onDetail}>Xem chi tiết gói</button>
    </div>
  )
}

function RankList({ source, rows, total, truncated, selectedId, loading, onPick, place }) {
  const msc = source === 'msc' || source === 'msc_prices'
  const price = source === 'msc_prices'
  const title = price ? 'Cơ sở / CĐT theo giá trị' : (msc ? 'Nhà đầu tư theo giá trị' : 'Cơ sở y tế theo giá trị')
  const empty = price ? 'Chưa có cơ sở / CĐT trong bộ lọc này.' : (msc ? 'Chưa có nhà đầu tư trong bộ lọc này.' : 'Chưa có cơ sở y tế trong bộ lọc này.')
  const count = !place && truncated && total
    ? `${fmtInt(rows.length)} / ${fmtInt(total)}`
    : (rows.length ? fmtInt(rows.length) : '')
  return (
    <aside className="map-list" aria-label={title}>
      <header>
        <div>
          <h2>{title}</h2>
          {place && <p>{place}</p>}
        </div>
        {count && <p>{count}</p>}
      </header>
      <div className="map-list-scroll">
        {rows.length ? (
          <ol>
            {rows.map((row, index) => {
              const label = msc
                ? (row.buyer || row.name || (price ? 'Cơ sở / CĐT' : 'Nhà đầu tư'))
                : (row.name || row.buyer || 'Cơ sở y tế')
              return (
                <li key={row.id || `${label}-${index}`}>
                  <button
                    type="button"
                    aria-pressed={selectedId === row.id}
                    onClick={() => onPick(row)}
                  >
                    <span className="price-rank">{index + 1}</span>
                    <span className="map-list-name">
                      <span className="map-list-title">
                        <strong title={label}>{label}</strong>
                        {msc && isExactBaoanMatch(row) && <span className="map-match-tag">Khớp</span>}
                      </span>
                      <small>{msc && row.tenderNo ? `${row.tenderNo} · ` : ''}{row.province || '—'}</small>
                    </span>
                    <em>{fmtVndCompact(row.value)}</em>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : <p className="metric-lead map-list-empty">{loading ? 'Đang xếp hạng…' : empty}</p>}
      </div>
    </aside>
  )
}

export default function MapSection({ localMode = true }) {
  const [draft, setDraft] = useState(EMPTY)
  const [query, setQuery] = useState(EMPTY)
  const [geo, setGeo] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pct, setPct] = useState(6)
  const [overlayOn, setOverlayOn] = useState(true)
  const [place, setPlace] = useState(null)
  const [pick, setPick] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [detail, setDetail] = useState(null)
  const [mapEpoch, setMapEpoch] = useState(0)
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const geoRef = useRef(null)
  const zoomIntent = useRef({ north: true })
  geoRef.current = geo
  const isTenderSource = query.source === 'msc'
  const isPriceSource = query.source === 'msc_prices'
  const isMscSource = isTenderSource || isPriceSource

  const applyFit = useCallback(() => {
    const map = mapRef.current
    const features = geoRef.current?.features
    const node = mapNodeRef.current
    if (!map || !features || !node || node.clientWidth < 40) return
    const intent = zoomIntent.current
    if (!intent) return
    const bounds = leafletBoundsFor(features, intent)
    if (!bounds) return
    zoomIntent.current = null
    const motion = cameraForIntent(intent)
    map.flyToBounds(bounds, motion)
  }, [])

  useEffect(() => {
    const node = mapNodeRef.current
    if (!node || mapRef.current) return undefined
    const map = L.map(node, {
      zoomControl: true,
      attributionControl: false,
      minZoom: 5,
      maxZoom: 12,
    })
    map.setView(NORTH_VIEW, 6)
    mapRef.current = map
    setMapEpoch((n) => n + 1)
    const syncZoom = () => {
      if (mapRef.current !== map) return
      node.classList.toggle('is-far', !showProvinceLabels(map.getZoom()))
    }
    const fix = () => {
      if (mapRef.current !== map) return
      map.invalidateSize()
      applyFit()
      syncZoom()
    }
    const frame = requestAnimationFrame(fix)
    const observer = new ResizeObserver(fix)
    observer.observe(node)
    map.on('zoomend', syncZoom)
    syncZoom()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      map.off('zoomend', syncZoom)
      map.remove()
      if (mapRef.current === map) mapRef.current = null
    }
  }, [applyFit])

  useEffect(() => {
    applyFit()
  }, [applyFit, mapEpoch, geo, query])

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const stop = () => {
      if (timer) window.clearInterval(timer)
      timer = 0
    }
    setPct(6)
    timer = window.setInterval(() => {
      setPct((n) => (n >= 46 ? n : n + 5))
    }, 180)
    fetchJsonWithProgress('/data/vn-provinces.geojson?v=65', (ratio) => {
      if (cancelled || ratio == null) return
      stop()
      setPct(Math.max(8, Math.min(60, Math.round(8 + ratio * 52))))
    })
      .then((payload) => {
        if (cancelled) return
        setGeo(payload)
        setPct((n) => Math.max(n, 60))
      })
      .catch(() => {
        if (!cancelled) setError('Chưa tải được ranh giới tỉnh.')
      })
      .finally(stop)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPct((n) => (geoRef.current ? 64 : Math.min(n, 40)))
    const timer = window.setInterval(() => {
      setPct((n) => {
        if (!geoRef.current) return n
        const next = Math.max(n, 62) + 3
        return next >= 94 ? 94 : next
      })
    }, 220)
    const load = localMode ? api.metricsMap : cloudMap
    load({
      source: query.source,
      months: 12,
      filters: {
        hoatchat: query.hoatchat,
        region: query.region,
        province: query.province,
        group: query.group,
        status: isTenderSource ? query.status : '',
        q: query.q,
      },
    })
      .then((payload) => { if (!cancelled) setData(payload) })
      .catch((err) => { if (!cancelled) setError(String(err?.message || err || 'Chưa tính được bản đồ.')) })
      .finally(() => {
        window.clearInterval(timer)
        if (cancelled) return
        setLoading(false)
        if (geoRef.current) setPct(100)
      })
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [localMode, query, isTenderSource])

  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const suggestIngredient = useCallback(async (q) => {
    const needle = String(q || '').trim()
    if (needle.length < 2) return []
    if (draft.source === 'msc' || draft.source === 'msc_prices') {
      const res = localMode
        ? await api.mscSearch({ kind: 'prices', filters: { ingredient: needle }, page: 0, size: 40 })
        : await cloudMscSearch({ kind: 'prices', filters: { ingredient: needle }, page: 0, size: 40 })
      const seen = new Set()
      const out = []
      for (const row of res?.items || []) {
        const text = String(row.ingredient || '').trim()
        if (!text || seen.has(text)) continue
        seen.add(text)
        out.push(text)
        if (out.length >= 8) break
      }
      return out
    }
    if (!localMode) {
      const items = await cloudSuggest('vss', 'hoatchat', needle)
      return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, 8)
    }
    const res = await api.suggest('vss', 'hoatchat', needle)
    return (res?.items || []).filter(Boolean).slice(0, 8)
  }, [draft.source, localMode])

  const byCode = useMemo(() => {
    const map = new Map()
    for (const row of data?.provinces || []) map.set(row.code, row)
    return map
  }, [data])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const group = L.layerGroup().addTo(map)
    const selectedCode = place?.type === 'province' ? place.id : ''
    const features = geo?.features || []
    const heatTone = query.status === 'open' ? 'open' : query.status === 'closed' ? 'closed' : 'other'
    const sortedPositive = isMscSource
      ? [...byCode.values()].map((row) => Number(row?.value) || 0).filter((value) => value > 0).sort((a, b) => a - b)
      : []
    if (geo) {
      L.geoJSON(geo, {
        style: (feature) => {
          const code = String(feature.properties?.ma || '')
          const stats = byCode.get(code)
          const on = selectedCode === code
          const inRegion = place?.type === 'region' && regionOf(code) === place.id
          return {
            color: on || inRegion ? '#14532d' : '#64748b',
            weight: on || inRegion ? 2.4 : 1,
            fillColor: isMscSource
              ? heatFillValue(stats?.value, heatTone, sortedPositive)
              : heatFill(stats?.yoy, stats?.value),
            fillOpacity: 1,
          }
        },
        onEachFeature: (feature, layer) => {
          const code = String(feature.properties?.ma || '')
          const name = feature.properties?.name || VN_PROVINCES[code] || code
          layer.bindTooltip(esc(name), {
            permanent: true,
            direction: 'center',
            className: 'map-prov-label',
            opacity: 1,
          })
          layer.on('click', (event) => {
            L.DomEvent.stopPropagation(event)
            const next = focusAfterProvinceClick(code)
            zoomIntent.current = next.camera
            setPlace(next.place)
            setPick(null)
            setDetail(null)
            applyFit()
          })
        },
      }).addTo(group)
    }
    const byRegion = new Map()
    for (const feature of features) {
      const name = regionOf(feature.properties?.ma)
      if (!name) continue
      const list = byRegion.get(name) || []
      list.push(feature)
      byRegion.set(name, list)
    }
    for (const name of REGION_ORDER) {
      const point = meanLatLon(byRegion.get(name) || [])
      if (!point) continue
      const icon = L.divIcon({
        className: `map-region-label${place?.type === 'region' && place.id === name ? ' is-on' : ''}`,
        html: `<span>${esc(name)}</span>`,
        iconSize: [200, 20],
        iconAnchor: [100, 10],
      })
      const marker = L.marker(point, { icon, keyboard: false }).addTo(group)
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        const next = focusAfterRegionClick(name)
        zoomIntent.current = next.camera
        setPlace(next.place)
        setPick(null)
        setDetail(null)
        applyFit()
      })
    }
    return () => {
      try { group.remove() } catch { /* Map already removed. */ }
    }
  }, [applyFit, mapEpoch, geo, place, byCode, isMscSource, query.status])

  const selectedCode = place?.type === 'province' ? place.id : ''
  const selectedRegion = place?.type === 'region' ? place.id : ''
  const rankedRows = useMemo(() => {
    if (isMscSource) {
      const areas = data?.packageAreas || {}
      if (selectedCode) return rankByValue(areas[selectedCode] || [])
      if (selectedRegion) {
        return rankByValue(Object.values(areas).flat().filter((dot) => dot.region === selectedRegion))
      }
      return rankByValue(data?.packages || [])
    }
    if (selectedCode) return rankByValue(data?.areaDots?.[selectedCode] || [])
    if (selectedRegion) {
      const rows = Object.values(data?.areaDots || {}).flat().filter((dot) => dot.region === selectedRegion)
      return rankByValue(rows)
    }
    return rankByValue((data?.dots || []).filter((dot) => dot.kind === 'facility'))
  }, [data, isMscSource, selectedCode, selectedRegion])
  const selectedPlace = selectedRegion || (selectedCode ? (byCode.get(selectedCode)?.name || '') : '')
  const selectedDot = useMemo(() => {
    if (pick?.type !== 'dot') return null
    const pools = [
      ...(data?.packages || []),
      ...Object.values(data?.packageAreas || {}).flat(),
      ...(data?.dots || []),
      ...Object.values(data?.areaDots || {}).flat(),
    ]
    return pools.find((dot) => dot.id === pick.id) || null
  }, [data, pick])
  const cardStats = selectedRegion
    ? (data?.regions || []).find((row) => row.name === selectedRegion)
    : selectedCode
      ? byCode.get(selectedCode)
      : data?.summary
  const cardTitle = selectedRegion
    ? 'Khu vực'
    : selectedCode
      ? 'Tỉnh / thành'
      : (isTenderSource ? 'MSC · gói thầu' : (isPriceSource ? 'MSC · đơn giá' : 'VSS · giá trị trúng thầu'))

  const setSource = (source) => {
    zoomIntent.current = focusAfterClear().camera
    const status = source === 'msc' ? 'open' : ''
    setDraft((current) => ({ ...current, source, status }))
    setQuery((current) => ({ ...current, source, status }))
    setPlace(null)
    setPick(null)
  }
  const onSearch = (event) => {
    event.preventDefault()
    const next = { ...draft }
    if (next.province || next.region) {
      zoomIntent.current = {
        province: next.province,
        region: next.province ? '' : next.region,
      }
    } else {
      zoomIntent.current = null
    }
    setQuery(next)
    setPlace(null)
    setPick(null)
  }
  const clearFilters = () => {
    zoomIntent.current = focusAfterClear().camera
    const next = { ...EMPTY, source: query.source, status: isTenderSource ? 'open' : '' }
    setDraft(next)
    setQuery(next)
    setPlace(null)
    setPick(null)
  }
  useEffect(() => {
    let cancel = false
    const load = localMode ? api.baoanCatalog : cloudCatalog
    load()
      .then((res) => { if (!cancel) setCatalog(res?.items || []) })
      .catch(() => { if (!cancel) setCatalog([]) })
    return () => { cancel = true }
  }, [localMode])
  const ready = Boolean(geo) && Boolean(data) && !loading
  useEffect(() => {
    if (error) {
      setOverlayOn(false)
      return undefined
    }
    if (!ready) {
      setOverlayOn(true)
      return undefined
    }
    setPct(100)
    const timer = window.setTimeout(() => setOverlayOn(false), 400)
    return () => window.clearTimeout(timer)
  }, [ready, error])
  const showOverlay = overlayOn && !error
  const displayPct = ready ? 100 : Math.max(1, Math.min(99, pct))

  return (
    <div className="section map-section">
      <header className="section-head map-head">
        <div className="map-title">
          <span className="kicker">Bản đồ nhiệt</span>
          <h1>Việt Nam theo tỉnh</h1>
        </div>
        <form className="map-filters compact-fields" onSubmit={onSearch}>
          <SuggestField
            label="Hoạt chất"
            value={draft.hoatchat}
            placeholder="vd. paracetamol"
            onChange={(value) => set('hoatchat', value)}
            suggest={suggestIngredient}
          />
          <Field label="Khu vực">
            <select aria-label="Khu vực" value={draft.region} onChange={(event) => set('region', event.target.value)}>
              <option value="">Cả nước</option>
              {REGION_ORDER.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
          <Field label="Tỉnh">
            <select aria-label="Tỉnh" value={draft.province} onChange={(event) => set('province', event.target.value)}>
              <option value="">Mọi tỉnh</option>
              {Object.entries(VN_PROVINCES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </Field>
          <Field label="Nhóm">
            <select aria-label="Nhóm" value={draft.group} onChange={(event) => set('group', event.target.value)}>
              <option value="">Mọi nhóm</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>Nhóm {n}</option>)}
            </select>
          </Field>
          <Field label="Trạng thái" hint={draft.source === 'msc' ? 'MSC gói thầu' : 'Không áp dụng'}>
            <select
              aria-label="Trạng thái gói thầu"
              disabled={draft.source !== 'msc'}
              title={draft.source === 'msc' ? 'Trạng thái gói MSC' : 'Bộ lọc trạng thái chỉ áp dụng cho MSC gói thầu.'}
              value={draft.source === 'msc' ? draft.status : 'closed'}
              onChange={(event) => set('status', event.target.value)}
            >
              {draft.source !== 'msc'
                ? <option value="closed">Đã đóng</option>
                : STATUS_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label={draft.source === 'msc' ? 'Chủ đầu tư' : (draft.source === 'msc_prices' ? 'Cơ sở / CĐT' : 'Cơ sở y tế')}>
            <input
              aria-label={draft.source === 'msc' ? 'Tìm chủ đầu tư' : (draft.source === 'msc_prices' ? 'Tìm cơ sở hoặc chủ đầu tư' : 'Tìm cơ sở y tế')}
              value={draft.q}
              placeholder={draft.source === 'msc' ? 'Tìm chủ đầu tư' : (draft.source === 'msc_prices' ? 'Tìm cơ sở / CĐT' : 'Tìm cơ sở y tế')}
              onChange={(event) => set('q', event.target.value)}
            />
          </Field>
          <div className="filter-actions">
            <button type="submit" className="btn sm">Tìm</button>
            <button type="button" className="btn secondary sm" onClick={clearFilters}>Xóa lọc</button>
          </div>
        </form>
      </header>
      {error && <p className="info-note" role="status">{error}</p>}
      <div className={`map-layout${loading ? ' is-loading' : ''}`}>
        <RankList
          source={query.source}
          rows={rankedRows}
          place={selectedPlace}
          total={isMscSource
            ? (selectedPlace ? rankedRows.length : (data?.packageTotal || rankedRows.length))
            : (selectedPlace ? rankedRows.length : data?.dotTotal)}
          truncated={isMscSource
            ? (!selectedPlace && Number(data?.packageTotal || 0) > (data?.packages || []).length)
            : (!selectedPlace && Boolean(data?.truncated))}
          selectedId={pick?.type === 'dot' ? pick.id : ''}
          loading={loading || !data}
          onPick={(row) => {
            const next = selectListedDot({ place, query, zoomIntent: zoomIntent.current, pick }, row)
            setPick(next.pick)
            setDetail(null)
          }}
        />

        <div className="map-stage">
          <div className="map-switch" role="group" aria-label="Nguồn dữ liệu">
            <button type="button" aria-pressed={query.source === 'vss'} onClick={() => setSource('vss')}>VSS</button>
            <button type="button" aria-pressed={isPriceSource} onClick={() => setSource('msc_prices')}>MSC đơn giá</button>
            <button type="button" aria-pressed={query.source === 'msc'} onClick={() => setSource('msc')}>MSC gói thầu</button>
          </div>
          <div className="map-frame">
            <div className="map-canvas" ref={mapNodeRef} role="application" aria-label="Bản đồ Việt Nam theo tỉnh" />
            {showOverlay && (
              <div className="map-loading" role="status">
                <strong>Đang tải bản đồ … {displayPct}%</strong>
                <span>{geo ? 'Đang tính số liệu.' : 'Đang mở ranh giới tỉnh.'}</span>
              </div>
            )}
          </div>
          <p className="map-legend">
            {isMscSource ? (
              <>
                <span><i className="swatch" style={{ background: heatSwatch(query.status === 'open' ? 'open' : query.status === 'closed' ? 'closed' : 'other', 0.08) }} /> Thấp</span>
                <span><i className="swatch" style={{ background: heatSwatch(query.status === 'open' ? 'open' : query.status === 'closed' ? 'closed' : 'other', 0.5) }} /> Trung bình</span>
                <span><i className="swatch" style={{ background: heatSwatch(query.status === 'open' ? 'open' : query.status === 'closed' ? 'closed' : 'other', 1) }} /> Cao</span>
                <span><i className="flat" /> {isPriceSource ? 'Chưa có đơn giá' : 'Chưa có gói'}</span>
              </>
            ) : (
              <>
                <span><i className="up" /> Tăng</span>
                <span><i className="down" /> Giảm</span>
                <span><i className="steady" /> Có số, chưa có cùng kỳ</span>
                <span><i className="flat" /> Chưa có số liệu</span>
              </>
            )}
          </p>
          {query.source === 'vss' && (
            <p className="metric-lead map-note">Mọi gói VSS đều đã đóng thầu, nên lọc trạng thái không áp dụng.</p>
          )}
        </div>

        <aside className="map-side" aria-label="Thẻ thông tin">
          {selectedDot?.kind === 'package'
            ? <PackagePanel dot={selectedDot} onClose={() => { setPick(null); setDetail(null) }} onDetail={() => setDetail(selectedDot)} />
            : (
              <StatCards
                stats={selectedDot?.kind === 'facility' || selectedDot?.kind === 'price_buyer' ? {
                  name: selectedDot.name,
                  value: selectedDot.value,
                  yoy: null,
                  lots: selectedDot.lots,
                  facilities: 1,
                  trend: [],
                  groups: [],
                } : (data ? {
                  ...cardStats,
                  name: selectedRegion || (selectedCode ? (byCode.get(selectedCode)?.name) : 'Toàn bộ bộ lọc'),
                } : null)}
                pending={!data}
                months={data?.months || 12}
                title={selectedDot?.kind === 'facility' ? 'Cơ sở y tế' : selectedDot?.kind === 'price_buyer' ? 'Cơ sở / CĐT' : selectedDot?.kind === 'investor' ? 'Nhà đầu tư' : cardTitle}
                note={selectedDot
                  ? `${selectedDot.province || ''}. ${selectedDot.placeNote || ''}`
                  : (cardStats && !Number(cardStats.value) ? 'Chưa có kết quả trong 12 tháng này.' : '')}
                showGroups={!isTenderSource && selectedDot?.kind !== 'facility' && selectedDot?.kind !== 'price_buyer'}
                trendLabel={isMscSource ? (data?.trendLabel || 'Giá trị mỗi tháng') : ''}
              />
            )}
          <IngredientRank
            rows={
              selectedDot
                ? (selectedDot.ingredients || [])
                : selectedCode
                  ? (data?.ingredientAreas?.[selectedCode] || [])
                  : selectedRegion
                    ? (data?.ingredientAreas?.[selectedRegion] || [])
                    : (data?.ingredients || [])
            }
            title={selectedDot?.kind === 'package'
              ? (selectedDot.scopeLines?.length ? 'Phạm vi gói thầu' : `Hoạt chất · ${selectedDot.name || selectedDot.buyer || ''}`)
              : (selectedDot ? `Hoạt chất · ${selectedDot.name || selectedDot.buyer || ''}` : data?.ingredientTitle)}
            note={selectedDot
              ? (selectedDot.kind === 'investor'
                ? 'Theo nhà đầu tư đang chọn.'
                : selectedDot.kind === 'facility'
                  ? 'Theo cơ sở y tế đang chọn.'
                  : selectedDot.scopeLines?.length
                    ? `${selectedDot.scopeLines.length.toLocaleString('vi-VN')} dòng · cùng danh sách phạm vi như MSC gói thầu.`
                    : 'Theo gói thầu đang chọn (đơn giá trúng).')
              : data?.ingredientNote}
            valueLabel={selectedDot?.scopeLines?.length ? 'Giá phần' : data?.ingredientValueLabel}
            qtyLabel={data?.ingredientQtyLabel}
            catalog={catalog}
            fromScope={Boolean(selectedDot?.kind === 'package' && selectedDot.scopeLines?.length)}
            pinMatches={selectedDot?.kind === 'package'}
          />
        </aside>
      </div>
      <DetailModal
        row={detail}
        fields={[
          { key: 'tenderNo', label: 'Mã TBMT' },
          { key: 'name', label: 'Tên gói thầu' },
          { key: 'buyer', label: 'Chủ đầu tư' },
          { key: 'province', label: 'Tỉnh / TP' },
          { key: 'district', label: 'Huyện / xã' },
          { key: 'statusLabel', label: 'Trạng thái' },
          { key: 'value', label: 'Giá gói thầu', text: (row) => fmtMoney(row.value) },
          { key: 'closeDate', label: 'Đóng thầu', text: (row) => fmtDateTime(row.closeDate) },
          { key: 'winner', label: 'Nhà thầu trúng' },
          { key: 'winnerPrice', label: 'Giá trúng', text: (row) => fmtMoney(row.winnerPrice) },
          { key: 'placeNote', label: 'Vị trí trên bản đồ' },
          { key: 'sourceUrl', label: 'Trang nguồn' },
        ]}
        title={detail?.name || 'Chi tiết gói thầu'}
        subtitle={detail ? `Gói thầu · ${detail.tenderNo || ''}` : ''}
        onClose={() => setDetail(null)}
        sourceUrl={detail?.sourceUrl}
        renderValue={(field, row, val) => (field.key === 'sourceUrl' && row.sourceUrl
          ? <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">Mở trang nguồn</a>
          : val)}
      />
    </div>
  )
}

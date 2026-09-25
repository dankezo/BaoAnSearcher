import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fold, fmtDateTime, getStaticStatus, getStatus, relativeTime, sectionMeta } from './api'
import { cloudMeta, supabaseConfigured } from './supabaseCloud'
import { exportXlsx } from './export'
import { HOSPITAL_GRADES } from './tt20'

export { IngredientLink, IngredientText, Tt20Provider, useTt20 } from './tt20'

/* ------------------------------------------------------------------ */
/* Icons (inline, 16px)                                                 */
/* ------------------------------------------------------------------ */
const I = {
  search: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  x: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  filter: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>,
  download: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0l-4-4m4 4l4-4M4 19h16" /></svg>,
  external: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg>,
  chevL: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>,
  chevR: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>,
  clock: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  columns: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg>,
}
export const Icons = I

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */
export function LoadingOverlay({ show, percent = 0, message = 'Đang xử lý…', etaSec = null, onCancel }) {
  if (!show) return null
  const pct = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-msg">{message}</div>
        <div className="pct">{pct}<span>%</span></div>
        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
        {etaSec != null && etaSec > 0 && (
          <div className="loading-eta muted">Ước tính còn ~{etaSec}s</div>
        )}
        {onCancel && pct >= 85 && (
          <button type="button" className="btn secondary sm" style={{ marginTop: 12 }} onClick={onCancel}>
            Bỏ qua / thử lại
          </button>
        )}
      </div>
    </div>
  )
}

const LOAD_AVG_KEY = 'baoan.loadAvgMs'

/** Real-ish progress: uses controlled percent when provided; else ETA from rolling avg of past loads. */
export function useLoadProgress(active, baseMsg = 'Đang tải', controlledPct = null) {
  const [pct, setPct] = useState(0)
  const [etaSec, setEtaSec] = useState(null)
  const [message, setMessage] = useState(`${baseMsg}…`)
  const startRef = useRef(0)

  useEffect(() => {
    if (!active) {
      if (startRef.current > 0) {
        const dur = Date.now() - startRef.current
        if (dur > 120) {
          try {
            const prev = Number(sessionStorage.getItem(LOAD_AVG_KEY) || dur)
            sessionStorage.setItem(LOAD_AVG_KEY, String(Math.round(prev * 0.55 + dur * 0.45)))
          } catch { /* ignore */ }
        }
        startRef.current = 0
        setPct(100)
        setEtaSec(null)
        setMessage(`${baseMsg}…`)
        const t = setTimeout(() => setPct(0), 180)
        return () => clearTimeout(t)
      }
      setPct(0)
      setEtaSec(null)
      return undefined
    }

    if (startRef.current === 0) startRef.current = Date.now()

    if (controlledPct != null) {
      const mapped = Math.max(1, Math.min(99, Number(controlledPct) || 1))
      setPct(mapped)
      let avgMs = 1600
      try { avgMs = Math.max(600, Number(sessionStorage.getItem(LOAD_AVG_KEY) || 1600)) } catch { /* ignore */ }
      const elapsed = Date.now() - startRef.current
      const estTotal = mapped > 5 ? (elapsed / mapped) * 100 : avgMs
      const remain = Math.max(0, estTotal - elapsed)
      const sec = remain > 250 ? Math.ceil(remain / 1000) : null
      setEtaSec(sec)
      setMessage(sec != null ? `${baseMsg}… · còn ~${sec}s` : `${baseMsg}…`)
      return undefined
    }

    setPct(6)
    setMessage(`${baseMsg}…`)
    let avgMs = 1600
    try { avgMs = Math.max(600, Number(sessionStorage.getItem(LOAD_AVG_KEY) || 1600)) } catch { /* ignore */ }
    const tick = setInterval(() => {
      const elapsed = Date.now() - startRef.current
      // Ease toward 97% based on expected duration — never freeze at a fake 92 forever
      const ratio = elapsed / avgMs
      const mapped = Math.min(97, 6 + (1 - Math.exp(-ratio * 1.35)) * 91)
      setPct(mapped)
      const remain = Math.max(0, avgMs - elapsed)
      const sec = remain > 250 ? Math.ceil(remain / 1000) : null
      setEtaSec(sec)
      setMessage(sec != null ? `${baseMsg}… · còn ~${sec}s` : `${baseMsg}…`)
    }, 120)
    return () => clearInterval(tick)
  }, [active, baseMsg, controlledPct])

  return { percent: pct, message, etaSec }
}

/** @deprecated use useLoadProgress */
export function useSimProgress(active, baseMsg = 'Đang tải') {
  return useLoadProgress(active, baseMsg)
}

/* ------------------------------------------------------------------ */
/* Filter inputs                                                        */
/* ------------------------------------------------------------------ */
export function Field({ label, children, hint, className = '' }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}{hint && <span className="hint"> {hint}</span>}</label>
      {children}
    </div>
  )
}

export function HospitalGradeField({ value, onChange }) {
  return (
    <Field label="Hạng bệnh viện" hint="TT 20/2022">
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Tất cả</option>
        {HOSPITAL_GRADES.map((g) => (
          <option key={g.id} value={g.id}>{g.label}</option>
        ))}
      </select>
    </Field>
  )
}

/**
 * Compact filter input with 1–3 typeahead suggestions.
 * suggest: async (query) => string[]  (or sync)
 */
export function SuggestField({
  label, hint, value, onChange, onSearch, suggest, placeholder = '', className = '',
}) {
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [hi, setHi] = useState(-1)
  const seq = useRef(0)
  const timer = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    clearTimeout(timer.current)
    const q = String(value ?? '').trim()
    if (!suggest || q.length < 1) {
      setItems([])
      return undefined
    }
    timer.current = setTimeout(async () => {
      const id = ++seq.current
      try {
        const list = await suggest(q)
        if (id === seq.current) {
          setItems((list || []).filter(Boolean).slice(0, 3))
          setHi(-1)
        }
      } catch {
        if (id === seq.current) setItems([])
      }
    }, 220)
    return () => clearTimeout(timer.current)
  }, [value, suggest])

  const show = open && items.length > 0

  const pick = (text) => {
    onChange(text)
    setOpen(false)
    setItems([])
    onSearch?.(text)
  }

  const onKey = (e) => {
    if (e.nativeEvent?.isComposing) return
    if (e.key === 'ArrowDown' && show) {
      e.preventDefault()
      setHi((i) => (i + 1) % items.length)
      return
    }
    if (e.key === 'ArrowUp' && show) {
      e.preventDefault()
      setHi((i) => (i <= 0 ? items.length - 1 : i - 1))
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (show && hi >= 0 && items[hi]) {
        pick(items[hi])
        return
      }
      onSearch?.(value)
    }
  }

  return (
    <Field label={label} hint={hint} className={`suggest-field ${className}`.trim()}>
      <div className="suggest-wrap" ref={wrapRef}>
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {show && (
          <ul className="suggest-list" role="listbox">
            {items.map((t, i) => (
              <li key={`${t}-${i}`}>
                <button
                  type="button"
                  className={`suggest-item${i === hi ? ' hi' : ''}`}
                  onMouseEnter={() => setHi(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(t)}
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  )
}

/** Bare input+suggest for table column filter row. */
export function SuggestInput({
  value, onChange, onSearch, suggest, placeholder = 'Lọc…', 'aria-label': ariaLabel,
}) {
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [hi, setHi] = useState(-1)
  const seq = useRef(0)
  const timer = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    clearTimeout(timer.current)
    const q = String(value ?? '').trim()
    if (!suggest || q.length < 1) { setItems([]); return undefined }
    timer.current = setTimeout(async () => {
      const id = ++seq.current
      try {
        const list = await suggest(q)
        if (id === seq.current) {
          setItems((list || []).filter(Boolean).slice(0, 3))
          setHi(-1)
        }
      } catch {
        if (id === seq.current) setItems([])
      }
    }, 220)
    return () => clearTimeout(timer.current)
  }, [value, suggest])

  const show = open && items.length > 0
  const pick = (text) => {
    onChange(text)
    setOpen(false)
    setItems([])
    onSearch?.(text)
  }

  return (
    <div className="th-filter suggest-wrap" ref={wrapRef}>
      <input
        value={value || ''}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.nativeEvent?.isComposing) return
          if (e.key === 'ArrowDown' && show) { e.preventDefault(); setHi((i) => (i + 1) % items.length); return }
          if (e.key === 'ArrowUp' && show) { e.preventDefault(); setHi((i) => (i <= 0 ? items.length - 1 : i - 1)); return }
          if (e.key === 'Escape') { setOpen(false); return }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (show && hi >= 0 && items[hi]) { pick(items[hi]); return }
            onSearch?.(value)
          }
        }}
      />
      {value ? (
        <button type="button" className="clear" aria-label="Xóa" onClick={() => { onChange(''); setItems([]) }}>{I.x}</button>
      ) : null}
      {show && (
        <ul className="suggest-list col" role="listbox">
          {items.map((t, i) => (
            <li key={`${t}-${i}`}>
              <button
                type="button"
                className={`suggest-item${i === hi ? ' hi' : ''}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Modal shell for secondary filters (used in multi-view). */
export function FilterModal({ open, title = 'Bộ lọc chi tiết', onClose, onApply, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="filter-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="filter-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="filter-modal-head">
          <strong>{title}</strong>
          <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>{I.x}</button>
        </div>
        <div className="filter-modal-body">{children}</div>
        <div className="filter-modal-foot">
          <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
          <button type="button" className="btn" onClick={() => { onApply?.(); onClose?.() }}>{I.search} Áp dụng</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Centered hero search bar with optional typeahead (3–4 rows).
 * suggestions: [{ id, title, subtitle, meta? }]
 */
export function SearchSuggestBar({
  value,
  onChange,
  onSubmit,
  placeholder = 'Tìm theo tên · SĐK · hoạt chất · hàm lượng…',
  hint = 'Gõ để xem gợi ý · Enter để tìm',
  suggestions = [],
  open = false,
  onOpenChange,
  onPick,
  loading = false,
  submitLabel = 'Tìm kiếm',
  showSubmit = true,
}) {
  const wrapRef = useRef(null)
  const [hi, setHi] = useState(-1)

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onOpenChange?.(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onOpenChange])

  useEffect(() => { setHi(-1) }, [suggestions])

  const show = open && suggestions.length > 0

  const pick = (item) => {
    onPick?.(item)
    onOpenChange?.(false)
  }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      if (!show) return
      e.preventDefault()
      setHi((i) => (i + 1) % suggestions.length)
      return
    }
    if (e.key === 'ArrowUp') {
      if (!show) return
      e.preventDefault()
      setHi((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
      return
    }
    if (e.key === 'Escape') {
      onOpenChange?.(false)
      return
    }
    if (e.key === 'Enter') {
      if (show && hi >= 0 && suggestions[hi]) {
        e.preventDefault()
        pick(suggestions[hi])
        return
      }
      onSubmit?.()
    }
  }

  return (
    <div className="search-hero" ref={wrapRef}>
      {hint && <div className="search-hero-hint">{hint}</div>}
      <div className={`search-hero-bar${show ? ' open' : ''}`}>
        <span className="search-hero-icon" aria-hidden>{I.search}</span>
        <input
          className="search-hero-input"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            onOpenChange?.(true)
          }}
          onFocus={() => onOpenChange?.(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={show}
        />
        {value ? (
          <button
            type="button"
            className="search-hero-clear"
            aria-label="Xóa"
            onClick={() => { onChange(''); onOpenChange?.(false) }}
          >
            {I.x}
          </button>
        ) : null}
        {showSubmit ? (
          <button type="button" className="btn search-hero-btn" onClick={() => onSubmit?.()} disabled={loading}>
            {I.search} {submitLabel}
          </button>
        ) : null}
      </div>
      {show && (
        <ul className="search-suggest" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.id ?? i} role="option" aria-selected={i === hi}>
              <button
                type="button"
                className={`search-suggest-item${i === hi ? ' hi' : ''}`}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(s)}
              >
                <span className="search-suggest-title">{s.title}</span>
                {s.subtitle && <span className="search-suggest-sub">{s.subtitle}</span>}
                {s.meta && <span className="search-suggest-meta">{s.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CountSelect({ label, value, onChange, options, otherValue, onOther }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className={`count-select${value === 'other' ? ' with-other' : ''}`}>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Tất cả</option>
          {options.map((o) => (
            <option key={o} value={String(o)}>{o}</option>
          ))}
          <option value="other">Khác…</option>
        </select>
        {value === 'other' && (
          <input
            type="number"
            min="0"
            placeholder="Nhập số"
            value={otherValue || ''}
            onChange={(e) => onOther(e.target.value)}
          />
        )}
      </div>
    </div>
  )
}

export function ColumnPicker({ allColumns, visible, onChange, open, onClose }) {
  if (!open) return null
  return (
    <div className="colpicker">
      <div className="colpicker-head">
        <strong>Chọn cột hiển thị</strong>
        <span className="muted">{visible.length}/{allColumns.length}</span>
        <div className="spacer" />
        <button type="button" className="btn ghost sm" onClick={() => onChange(allColumns.map((c) => c.key))}>Tất cả</button>
        <button type="button" className="btn ghost sm" onClick={() => onChange([])}>Bỏ hết</button>
        <button type="button" className="btn secondary sm" onClick={onClose}>Đóng</button>
      </div>
      <div className="colpicker-grid">
        {allColumns.map((c) => (
          <label key={c.key} className="check">
            <input
              type="checkbox"
              checked={visible.includes(c.key)}
              onChange={(e) => {
                if (e.target.checked) onChange([...visible, c.key])
                else onChange(visible.filter((k) => k !== c.key))
              }}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export function ViewModeSelect({ value, onChange }) {
  return (
    <select className="select sm" value={value} onChange={(e) => onChange(e.target.value)} title="Chế độ cột">
      <option value="compact">Cột rút gọn</option>
      <option value="full">Hiện hết trường</option>
      <option value="custom">Tùy chọn cột…</option>
    </select>
  )
}

/* ------------------------------------------------------------------ */
/* Pagination                                                           */
/* ------------------------------------------------------------------ */
export function Pagination({
  page, size, total, onPage, shown, extra, pageSize, onPageSize,
  pageSizeOptions = [50, 100, 200, 300, 400, 500],
}) {
  const effectiveSize = size > 0 ? size : Math.max(total || 1, 1)
  const pages = Math.max(1, Math.ceil((total || 0) / effectiveSize))
  const preset = pageSizeOptions.map(String)
  const isCustom = pageSize != null && !preset.includes(String(pageSize))
  const [customOpen, setCustomOpen] = useState(isCustom)
  const [customVal, setCustomVal] = useState(isCustom ? String(pageSize) : '')

  useEffect(() => {
    if (isCustom) {
      setCustomOpen(true)
      setCustomVal(String(pageSize))
    }
  }, [pageSize, isCustom])

  const applyCustom = () => {
    const n = parseInt(String(customVal).trim(), 10)
    if (!Number.isFinite(n) || n < 1) return
    onPageSize?.(Math.min(2000, Math.max(1, n)))
  }

  return (
    <div className="footer-bar">
      <span>
        <strong>{(total || 0).toLocaleString('vi-VN')}</strong> kết quả
        {shown != null && shown !== Math.min(effectiveSize, Math.max(0, (total || 0) - page * effectiveSize)) && (
          <> · hiển thị <strong>{shown}</strong> sau lọc cột</>
        )}
      </span>
      {extra}
      <div className="spacer" />
      {onPageSize && (
        <label className="page-size">
          <span className="muted">Số dòng</span>
          <select
            className="select sm"
            value={customOpen || isCustom ? 'custom' : String(pageSize ?? 100)}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'custom') {
                setCustomOpen(true)
                setCustomVal(String(pageSize && !preset.includes(String(pageSize)) ? pageSize : 100))
                return
              }
              setCustomOpen(false)
              onPageSize(Number(v))
            }}
            aria-label="Số dòng mỗi trang"
          >
            {pageSizeOptions.map((o) => (
              <option key={String(o)} value={String(o)}>{o}</option>
            ))}
            <option value="custom">Khác…</option>
          </select>
          {(customOpen || isCustom) && (
            <span className="page-size-custom">
              <input
                className="input sm"
                type="number"
                min={1}
                max={2000}
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }}
                aria-label="Số dòng tùy chọn"
              />
              <button type="button" className="btn ghost sm" onClick={applyCustom}>OK</button>
            </span>
          )}
        </label>
      )}
      <span className="muted">Trang {page + 1}/{pages.toLocaleString('vi-VN')}</span>
      <div className="pager">
        <button type="button" className="icon-btn" aria-label="Trang trước" disabled={page <= 0} onClick={() => onPage(page - 1)}>{I.chevL}</button>
        <button type="button" className="icon-btn" aria-label="Trang sau" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>{I.chevR}</button>
      </div>
    </div>
  )
}

/** Resolve UI page-size choice → numeric size for API. */
export const PAGE_SIZE_FULL_CHUNK = 500
export const PAGE_SIZE_FULL_CAP = 5000
export function resolvePageSize(choice) {
  if (choice === 'full' || choice === 0) return 100 // legacy full → safe default
  const n = Number(choice)
  return Number.isFinite(n) && n > 0 ? Math.min(2000, n) : 100
}
export function isFullPageSize() {
  return false
}

/* ------------------------------------------------------------------ */
/* Data freshness                                                       */
/* ------------------------------------------------------------------ */
/**
 * Resolve {updated, count} for a section.
 * localMode → /api/status meta; otherwise ./data/status.json or the fallback derived from the export.
 */
export function useSectionMeta(section, localMode, fallback, refreshKey) {
  const [meta, setMeta] = useState({ updated: null, count: null })
  useEffect(() => {
    let alive = true
    const run = async () => {
      let m = { updated: null, count: null }
      if (localMode) {
        const st = await getStatus(true)
        m = sectionMeta(st, section)
      } else if (supabaseConfigured) {
        const cm = await cloudMeta(section)
        if (cm) m = { updated: cm.updated || null, count: cm.count ?? null }
      } else {
        const st = await getStaticStatus()
        m = sectionMeta(st, section)
      }
      if (!alive) return
      setMeta({
        updated: m.updated || fallback?.updated || null,
        count: m.count ?? fallback?.count ?? null,
      })
    }
    run()
    return () => { alive = false }
  }, [section, localMode, fallback?.updated, fallback?.count, refreshKey])
  return meta
}

export function UpdatedNote({ updated, count, source }) {
  if (!updated && count == null) return null
  return (
    <div className="updated-note" title={updated ? String(updated) : undefined}>
      {I.clock}
      <span>
        {updated ? <>Dữ liệu cập nhật từ <strong>{fmtDateTime(updated)}</strong> <em>({relativeTime(updated)})</em></> : 'Chưa rõ thời điểm cập nhật'}
        {count != null && <> · {Number(count).toLocaleString('vi-VN')} bản ghi</>}
        {source && <> · {source}</>}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal + detail                                                       */
/* ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, subtitle, children, footer, width = 760 }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        <div className="modal-head">
          <div>
            {subtitle && <div className="modal-kicker">{subtitle}</div>}
            <h3>{title}</h3>
          </div>
          <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>{I.x}</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

function isEmptyVal(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * Detail modal listing all fields of a record.
 * fields: [{key,label,text?}] ordered; remaining non-underscore keys are appended.
 */
export function DetailModal({ row, fields, title, subtitle, onClose, sourceUrl, renderValue }) {
  const all = useMemo(() => {
    if (!row) return []
    const known = new Set(fields.map((f) => f.key))
    const rest = Object.keys(row)
      .filter((k) => !known.has(k) && !k.startsWith('_'))
      .map((k) => ({ key: k, label: k }))
    return [...fields, ...rest]
  }, [row, fields])
  if (!row) return null
  const url = sourceUrl || row.source_url
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={(
        <>
          <span className="muted">{all.length} trường</span>
          <div className="spacer" />
          {url && (
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              {I.external} Mở trang nguồn
            </a>
          )}
          <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
        </>
      )}
    >
      <dl className="detail-grid">
        {all.map((f) => {
          const raw = row[f.key]
          let val = f.text ? f.text(row) : raw
          if (typeof val === 'object' && val !== null) val = JSON.stringify(val)
          else if (typeof val === 'number') val = val.toLocaleString('vi-VN')
          else if (typeof val === 'boolean') val = val ? 'Có' : 'Không'
          if (renderValue) val = renderValue(f, row, val)
          return (
            <div key={f.key} className={`detail-row${isEmptyVal(raw) ? ' empty' : ''}`}>
              <dt>{f.label}</dt>
              <dd>{isEmptyVal(raw) ? '—' : val}</dd>
            </div>
          )
        })}
      </dl>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Selection                                                            */
/* ------------------------------------------------------------------ */
export function useSelection() {
  const [selected, setSelected] = useState(() => new Map())
  const toggle = useCallback((key, row) => {
    setSelected((m) => {
      const n = new Map(m)
      if (n.has(key)) n.delete(key)
      else n.set(key, row)
      return n
    })
  }, [])
  const setMany = useCallback((pairs, checked) => {
    setSelected((m) => {
      const n = new Map(m)
      for (const [k, r] of pairs) {
        if (checked) n.set(k, r)
        else n.delete(k)
      }
      return n
    })
  }, [])
  const clear = useCallback(() => setSelected(new Map()), [])
  return { selected, toggle, setMany, clear, size: selected.size }
}

/* ------------------------------------------------------------------ */
/* Column filters                                                       */
/* ------------------------------------------------------------------ */
export function cellText(row, col) {
  if (col.text) return col.text(row)
  const v = row[col.key]
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Client-side refine of loaded rows by per-column filters. */
export function applyColumnFilters(rows, columns, filters) {
  const active = Object.entries(filters || {}).filter(([, v]) => String(v ?? '').trim() !== '')
  if (!active.length) return rows
  const byKey = Object.fromEntries(columns.map((c) => [c.key, c]))
  return rows.filter((row) =>
    active.every(([key, value]) => {
      const col = byKey[key] || { key }
      const text = fold(cellText(row, col))
      const needle = fold(value).trim()
      if (col.filter === 'select') return text.trim() === needle
      return needle.split(/\s+/).every((w) => text.includes(w))
    }),
  )
}

/** Map column filters onto server filter keys (only those mapped). */
export function serverFilters(columnFilters, map) {
  const out = {}
  for (const [k, v] of Object.entries(columnFilters || {})) {
    if (String(v ?? '').trim() === '') continue
    const target = map?.[k]
    if (target) out[target] = v
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                              */
/* ------------------------------------------------------------------ */
export function TableToolbar({
  title, kicker, selectedCount, onClearSelection, onExport, exporting,
  filtersVisible, onToggleFilters, activeColumnFilters, onClearColumnFilters, children,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-title">
        {kicker && <span className="kicker">{kicker}</span>}
        <h2>{title}</h2>
      </div>
      <div className="toolbar-actions">
        {children}
        <button
          type="button"
          className={`btn ghost sm${filtersVisible ? ' on' : ''}`}
          onClick={onToggleFilters}
          title="Bật/tắt dòng lọc theo cột (kiểu Excel)"
        >
          {I.filter} Lọc cột
          {activeColumnFilters > 0 && <span className="pill">{activeColumnFilters}</span>}
        </button>
        {activeColumnFilters > 0 && (
          <button type="button" className="btn ghost sm" onClick={onClearColumnFilters}>Xóa lọc cột</button>
        )}
        <button
          type="button"
          className="btn secondary sm"
          onClick={onExport}
          disabled={exporting}
          title={selectedCount ? `Xuất ${selectedCount} dòng đã chọn` : 'Xuất toàn bộ kết quả đã lọc'}
        >
          {I.download} Xuất Excel{selectedCount ? ` (${selectedCount})` : ''}
        </button>
        {selectedCount > 0 && (
          <button type="button" className="btn ghost sm" onClick={onClearSelection}>Bỏ chọn</button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DataTable                                                            */
/* ------------------------------------------------------------------ */
/**
 * columns: [{ key, label, render?(value,row), text?(row), filter?: 'text'|'select'|false,
 *             align?: 'right'|'center', mono?: bool, nowrap?: bool, width? }]
 */
export function DataTable({
  columns, rows, rowKey, startIndex = 0, showIndex = true,
  selectable = true, selected, onToggleRow, onToggleAll,
  columnFilters = {}, onColumnFilter, filtersVisible = true, onFilterEnter,
  onFilterSuggest,
  onRowDoubleClick, emptyText = 'Không có dữ liệu', loading,
  trailing, // { label, render(row) }
  minWidth,
}) {
  const keys = useMemo(() => rows.map((r, i) => rowKey(r, i)), [rows, rowKey])
  const allChecked = rows.length > 0 && keys.every((k) => selected?.has(k))
  const someChecked = !allChecked && keys.some((k) => selected?.has(k))
  const headRef = useRef(null)

  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someChecked
  }, [someChecked])

  const options = useMemo(() => {
    const out = {}
    for (const c of columns) {
      if (c.filter !== 'select') continue
      const set = new Set()
      for (const r of rows) {
        const t = cellText(r, c).trim()
        if (t) set.add(t)
      }
      out[c.key] = [...set].sort((a, b) => a.localeCompare(b, 'vi'))
    }
    return out
  }, [columns, rows])

  const extraCols = (showIndex ? 1 : 0) + (selectable ? 1 : 0) + (trailing ? 1 : 0)

  const defaultSuggest = useCallback((key) => async (q) => {
    if (onFilterSuggest) return onFilterSuggest(key, q)
    const col = columns.find((c) => c.key === key)
    if (!col) return []
    const needle = fold(q)
    const seen = new Set()
    const out = []
    for (const r of rows) {
      const t = cellText(r, col).trim()
      if (!t || seen.has(t)) continue
      if (!fold(t).includes(needle)) continue
      seen.add(t)
      out.push(t)
      if (out.length >= 3) break
    }
    return out
  }, [onFilterSuggest, columns, rows])

  return (
    <div className="table-wrap">
      <table className={`data${filtersVisible ? ' with-filters' : ''}`} style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr className="labels">
            {selectable && (
              <th className="sel">
                <input
                  ref={headRef}
                  type="checkbox"
                  aria-label="Chọn tất cả trang này"
                  checked={allChecked}
                  onChange={(e) => onToggleAll?.(keys.map((k, i) => [k, rows[i]]), e.target.checked)}
                />
              </th>
            )}
            {showIndex && <th className="idx">#</th>}
            {columns.map((c) => (
              <th key={c.key} className={c.align ? `al-${c.align}` : ''} style={c.width ? { minWidth: c.width } : undefined}>
                <span className="th-label">{c.label}</span>
                {columnFilters[c.key] && <span className="th-dot" title="Đang lọc cột này" />}
              </th>
            ))}
            {trailing && <th className="trail">{trailing.label}</th>}
          </tr>
          {filtersVisible && (
            <tr className="filters-row">
              {selectable && <th className="sel" />}
              {showIndex && <th className="idx" />}
              {columns.map((c) => (
                <th key={c.key}>
                  {c.filter === false ? null : c.filter === 'select' ? (
                    <select
                      value={columnFilters[c.key] || ''}
                      onChange={(e) => onColumnFilter?.(c.key, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) onFilterEnter?.() }}
                      aria-label={`Lọc ${c.label}`}
                    >
                      <option value="">Tất cả</option>
                      {(options[c.key] || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <SuggestInput
                      value={columnFilters[c.key] || ''}
                      placeholder="Lọc…"
                      aria-label={`Lọc ${c.label}`}
                      onChange={(v) => onColumnFilter?.(c.key, v)}
                      onSearch={() => onFilterEnter?.()}
                      suggest={defaultSuggest(c.key)}
                    />
                  )}
                </th>
              ))}
              {trailing && <th className="trail" />}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const k = keys[i]
            const isSel = selected?.has(k)
            return (
              <tr
                key={k}
                className={isSel ? 'selected' : ''}
                onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                title={onRowDoubleClick ? 'Nhấp đôi để xem chi tiết' : undefined}
              >
                {selectable && (
                  <td className="sel" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={!!isSel} onChange={() => onToggleRow?.(k, row)} aria-label="Chọn dòng" />
                  </td>
                )}
                {showIndex && <td className="idx">{startIndex + i + 1}</td>}
                {columns.map((c) => {
                  const v = row[c.key]
                  let content
                  if (c.render) content = c.render(v, row)
                  else if (typeof v === 'number') content = v.toLocaleString('vi-VN')
                  else content = v ?? ''
                  const cls = [c.align ? `al-${c.align}` : '', c.mono ? 'mono' : '', c.nowrap ? 'nowrap' : ''].filter(Boolean).join(' ')
                  return <td key={c.key} className={cls || undefined}>{content}</td>
                })}
                {trailing && <td className="trail">{trailing.render(row)}</td>}
              </tr>
            )
          })}
          {!rows.length && !loading && (
            <tr className="empty"><td colSpan={columns.length + extraCols}>{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Export helper                                                        */
/* ------------------------------------------------------------------ */
/**
 * Export selected rows (if any) else all rows returned by fetchAll().
 * Returns the number of exported rows.
 */
export async function exportSelectionOrAll({ columns, selected, fetchAll, filename, sheetName, columnFilters }) {
  let rows
  if (selected && selected.size > 0) rows = [...selected.values()]
  else {
    rows = await fetchAll()
    if (columnFilters) rows = applyColumnFilters(rows, columns, columnFilters)
  }
  if (!rows.length) return 0
  exportXlsx({
    columns,
    rows,
    getValue: (r, c) => {
      if (c.text) return c.text(r)
      const v = r[c.key]
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : v
    },
    filename,
    sheetName,
  })
  return rows.length
}

/** Page through a server search until total/cap reached. */
export async function fetchAllPages(fetchPage, {
  size = PAGE_SIZE_FULL_CHUNK,
  cap = PAGE_SIZE_FULL_CAP,
  onProgress,
} = {}) {
  const first = await fetchPage(0, size)
  const items = [...(first.items || [])]
  const total = Math.min(first.total || items.length, cap)
  onProgress?.(items.length && total ? Math.min(99, Math.round((items.length / total) * 100)) : 5)
  let page = 1
  while (items.length < total && page < 500) {
    const more = await fetchPage(page, size)
    if (!more.items?.length) break
    items.push(...more.items)
    onProgress?.(Math.min(99, Math.round((items.length / Math.max(total, 1)) * 100)))
    page++
    if (more.items.length < size) break
  }
  onProgress?.(100)
  return items.slice(0, cap)
}

export function ErrorNote({ children }) {
  if (!children) return null
  return <div className="error-note">{children}</div>
}

import { useEffect, useState } from 'react'

export function LoadingOverlay({ show, percent = 0, message = 'Đang xử lý…' }) {
  if (!show) return null
  const pct = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div>{message}</div>
        <div className="pct">{pct}%</div>
        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  )
}

export function useSimProgress(active, baseMsg = 'Đang tải') {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    if (!active) { setPct(0); return }
    setPct(8)
    const t = setInterval(() => {
      setPct((p) => (p >= 92 ? p : p + Math.random() * 7))
    }, 400)
    return () => clearInterval(t)
  }, [active])
  return { percent: pct, message: `${baseMsg}…` }
}

export function CountSelect({ label, value, onChange, options, otherValue, onOther }) {
  return (
    <div className="field">
      <label>{label}</label>
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
  )
}

export function ColumnPicker({ allColumns, visible, onChange, open, onClose }) {
  if (!open) return null
  return (
    <div className="filters" style={{ background: 'rgba(13,110,95,.04)' }}>
      <strong>Chọn cột hiển thị</strong>
      <div className="filter-grid">
        {allColumns.map((c) => (
          <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.85rem' }}>
            <input
              type="checkbox"
              checked={visible.includes(c.key)}
              onChange={(e) => {
                if (e.target.checked) onChange([...visible, c.key])
                else onChange(visible.filter((k) => k !== c.key))
              }}
            />
            {c.label}
          </label>
        ))}
      </div>
      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
      </div>
    </div>
  )
}

export function Pagination({ page, size, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <div className="footer-bar">
      <span>{total.toLocaleString('vi-VN')} kết quả · Trang {page + 1}/{pages}</span>
      <div className="spacer" />
      <button type="button" className="btn secondary" disabled={page <= 0} onClick={() => onPage(page - 1)}>←</button>
      <button type="button" className="btn secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>→</button>
    </div>
  )
}

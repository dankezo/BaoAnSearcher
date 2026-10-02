import { useEffect, useMemo, useRef, useState } from 'react'
import { api, containsWords } from './api'
import { cloudCatalog, supabaseConfigured } from './supabaseCloud'
import { readCompare } from './compare'

export default function BaoAnCatalog({ localMode }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [focusRegs, setFocusRegs] = useState([])
  const rowRefs = useRef(new Map())
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!localMode && !supabaseConfigured) return undefined
    let live = true
    setLoading(true)
    const load = localMode ? api.baoanCatalog() : cloudCatalog()
    load
      .then((payload) => { if (live) setRows(payload.items || []) })
      .catch((err) => { if (live) setError(err.message || 'Không tải được danh mục') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [localMode])

  useEffect(() => {
    const apply = (detail) => {
      if (!detail) return
      setFocusRegs([...(detail.regs || [])].filter(Boolean))
    }
    apply(readCompare())
    const onCompare = (event) => apply(event.detail)
    const onFocus = (event) => apply(event.detail)
    window.addEventListener('baoan-compare', onCompare)
    window.addEventListener('baoan-focus', onFocus)
    return () => {
      window.removeEventListener('baoan-compare', onCompare)
      window.removeEventListener('baoan-focus', onFocus)
    }
  }, [])

  const shown = useMemo(() => {
    const wanted = new Set(focusRegs)
    return rows.filter((row) => wanted.has(row.reg) || containsWords(`${row.inn} ${row.brand}`, query))
  }, [rows, query, focusRegs])

  useEffect(() => {
    const hit = shown.find((row) => focusRegs.includes(row.reg))
    const node = hit && rowRefs.current.get(hit.reg)
    const wrap = wrapRef.current
    if (!node || !wrap) return
    const nodeRect = node.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    wrap.scrollTop += nodeRect.top - wrapRect.top - wrap.clientHeight / 2 + nodeRect.height / 2
  }, [shown, focusRegs])

  if (!localMode && !supabaseConfigured) {
    return <p className="muted baoan-catalog-note">Chưa cấu hình Cloud.</p>
  }

  return (
    <section className="baoan-catalog">
      <header className="baoan-catalog-head">
        <h2>Danh mục Bảo An</h2>
        <label className="baoan-catalog-search">
          <span>Hoạt chất</span>
          <input
            className="input"
            value={query}
            placeholder="Tìm hoạt chất…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>
      {loading && !rows.length && <p className="muted small">Đang tải danh mục…</p>}
      {error && <p className="muted small">{error}</p>}
      <div className="baoan-catalog-wrap" ref={wrapRef}>
        <table className="baoan-catalog-table">
          <thead>
            <tr>
              <th>Tên thuốc</th>
              <th>Hoạt chất</th>
              <th>Hàm lượng</th>
              <th>Dạng bào chế</th>
              <th>Đường dùng</th>
              <th>SĐK</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.id || row.reg}
                ref={(node) => {
                  if (node && row.reg) rowRefs.current.set(row.reg, node)
                  else if (row.reg) rowRefs.current.delete(row.reg)
                }}
                className={focusRegs.includes(row.reg) ? 'is-hit' : ''}
              >
                <td>{row.brand || '—'}</td>
                <td>{row.inn || '—'}</td>
                <td>{row.strength || '—'}</td>
                <td>{row.form || '—'}</td>
                <td>{row.route || '—'}</td>
                <td className="mono">{row.reg || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !shown.length && <p className="muted small baoan-catalog-note">Không có thuốc khớp ô tìm.</p>}
      </div>
    </section>
  )
}

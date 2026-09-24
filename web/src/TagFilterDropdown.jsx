import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_TAG_CONFIGS, TAG_XANH, defaultSelectedTags, loadTagConfigs,
  persistSelectedTags, saveTagLabel,
} from './tagConfig'

/**
 * Multi-select status tag filter for SĐK commercial classification.
 * Stack-agnostic (Vite/React) equivalent of the Shadcn TagFilterDropdown spec.
 */
export function TagFilterDropdown({
  selectedTags,
  onChange,
  configs: configsProp,
}) {
  const [open, setOpen] = useState(false)
  const [configs, setConfigs] = useState(() => configsProp || loadTagConfigs())
  const [editingId, setEditingId] = useState(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [hoverId, setHoverId] = useState(null)
  const rootRef = useRef(null)

  useEffect(() => {
    if (configsProp) setConfigs(configsProp)
  }, [configsProp])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = selectedTags || []
  const activeConfigs = useMemo(
    () => configs.filter((c) => selected.includes(c.id)),
    [configs, selected],
  )

  const toggle = (id) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id]
    onChange(next)
    persistSelectedTags(next)
  }

  const setQuick = (ids) => {
    onChange(ids)
    persistSelectedTags(ids)
  }

  const startRename = (t) => {
    setEditingId(t.id)
    setDraftLabel(t.label)
  }

  const commitRename = () => {
    if (!editingId) return
    const label = draftLabel.trim() || configs.find((c) => c.id === editingId)?.label
    saveTagLabel(editingId, label)
    setConfigs((prev) => prev.map((c) => (c.id === editingId ? { ...c, label } : c)))
    setEditingId(null)
  }

  return (
    <div className="tag-filter" ref={rootRef}>
      <button
        type="button"
        className={`tag-filter-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
          <path d="M3 5h18l-7 8v6l-4-2v-4z" />
        </svg>
        <span>Lọc theo trạng thái</span>
        <span className="tag-filter-count">Đã chọn: {selected.length}</span>
        <span className="tag-dots" aria-hidden>
          {activeConfigs.map((c) => (
            <span key={c.id} className="tag-dot" style={{ background: c.colorHex }} title={c.label} />
          ))}
        </span>
      </button>

      {open && (
        <div className="tag-filter-panel" role="dialog" aria-label="Lọc phân loại dữ liệu">
          <div className="tag-filter-head">Lọc phân loại dữ liệu</div>
          <ul className="tag-filter-list">
            {configs.map((t) => {
              const checked = selected.includes(t.id)
              return (
                <li
                  key={t.id}
                  className={`tag-filter-row${checked ? ' on' : ''}`}
                  onMouseEnter={() => setHoverId(t.id)}
                  onMouseLeave={() => setHoverId((id) => (id === t.id ? null : id))}
                >
                  <label className="tag-filter-label">
                    <input type="checkbox" checked={checked} onChange={() => toggle(t.id)} />
                    <span className="tag-dot lg" style={{ background: t.colorHex }} />
                    {editingId === t.id ? (
                      <input
                        className="tag-rename"
                        value={draftLabel}
                        autoFocus
                        onChange={(e) => setDraftLabel(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="tag-name" onDoubleClick={() => startRename(t)}>{t.label}</span>
                    )}
                  </label>
                  <button
                    type="button"
                    className="tag-info"
                    title="Thông tin"
                    aria-label={`Thông tin ${t.label}`}
                    onClick={(e) => { e.preventDefault(); setHoverId(t.id) }}
                  >
                    ?
                  </button>
                  {hoverId === t.id && (
                    <div className="tag-tooltip" role="tooltip">
                      <div className="tag-tooltip-title">
                        <span className="tag-dot" style={{ background: t.colorHex }} />
                        {t.shortTitle}
                      </div>
                      <p>{t.description}</p>
                      <button type="button" className="tag-rename-btn" onClick={() => startRename(t)}>
                        Đổi tên hiển thị…
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="tag-filter-foot">
            <button type="button" className="btn ghost sm" onClick={() => setQuick([TAG_XANH])}>Chỉ lấy Xanh</button>
            <button type="button" className="btn ghost sm" onClick={() => setQuick(configs.map((c) => c.id))}>Chọn tất cả</button>
            <button type="button" className="btn ghost sm" onClick={() => setQuick([])}>Xóa chọn</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TagBadge({ tagId, configs }) {
  const list = configs || loadTagConfigs()
  const t = list.find((c) => c.id === tagId)
  if (!t) return <span className="muted">—</span>
  return (
    <span className="tag-badge" title={t.shortTitle} style={{ '--tag-c': t.colorHex }}>
      <span className="tag-dot" style={{ background: t.colorHex }} />
      {t.label}
    </span>
  )
}

export function useTagFilterState() {
  const [selectedTags, setSelectedTags] = useState(() => defaultSelectedTags())
  const [configs, setConfigs] = useState(() => loadTagConfigs())
  const setTags = (ids) => {
    setSelectedTags(ids)
    persistSelectedTags(ids)
  }
  const refreshConfigs = () => setConfigs(loadTagConfigs())
  return { selectedTags, setSelectedTags: setTags, configs, refreshConfigs }
}

export { DEFAULT_TAG_CONFIGS, defaultSelectedTags }

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fold } from './api'

/* ------------------------------------------------------------------ */
/* Catalog loading + indexing                                          */
/* ------------------------------------------------------------------ */

const Tt20Context = createContext({ index: null, ready: false, popover: null, toggle: () => {}, close: () => {} })

/** Canonical form for fuzzy-but-safe matching of ingredient names. */
export function canon(s) {
  return fold(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(.)\1+/g, '$1') // amoxicillin → amoxicilin
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith('e') ? w.slice(0, -1) : w)) // metronidazole → metronidazol
    .join(' ')
}

/** Salt / form words that appear in parentheses but are not ingredient aliases. */
const ALIAS_STOP = new Set([
  'citrat', 'natri', 'kali', 'calci', 'hydroclorid', 'clohydrat', 'maleat', 'hydrogen maleat',
  'sulfat', 'acetat', 'tartrat', 'mesylat', 'besylat', 'human', 'fast acting', 'short acting',
].map(canon))

function buildIndex(catalog) {
  const index = new Map()
  const add = (key, group) => {
    const k = canon(key)
    if (!k) return
    if (!index.has(k)) index.set(k, group)
  }
  const groups = new Map()
  for (const e of catalog || []) {
    const name = String(e.hoatChat || '').trim()
    if (!name) continue
    const gk = fold(name)
    if (!groups.has(gk)) groups.set(gk, { name, entries: [] })
    groups.get(gk).entries.push(e)
  }
  for (const group of groups.values()) {
    const name = group.name
    add(name, group)
    const main = name.replace(/\([^)]*\)/g, ' ').trim()
    add(main, group)
    for (const m of name.matchAll(/\(([^)]+)\)/g)) {
      for (const alias of m[1].split(/[,;/]/)) {
        if (!ALIAS_STOP.has(canon(alias))) add(alias, group)
      }
    }
  }
  return index
}

/** Find a catalog group for one ingredient token (longest word-prefix match). */
export function matchToken(index, token) {
  if (!index) return null
  const bare = String(token).replace(/\([^)]*\)?/g, ' ').replace(/\d.*$/, '')
  const words = canon(bare).split(' ').filter(Boolean)
  for (let n = Math.min(words.length, 5); n >= 1; n--) {
    const hit = index.get(words.slice(0, n).join(' '))
    if (hit) return hit
  }
  return null
}

/** Depth-aware split of an ingredient cell into [{text, sep}] segments. */
export function tokenizeIngredients(text) {
  const s = String(text ?? '')
  const out = []
  let depth = 0
  let buf = ''
  const push = (t, sep) => { if (t) out.push({ text: t, sep }) }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ';' || ch === ',' || ch === '+' || ch === '/' || ch === '|')) {
      push(buf, false)
      push(ch, true)
      buf = ''
      continue
    }
    if (depth === 0 && /\s/.test(ch)) {
      const rest = s.slice(i)
      const m = rest.match(/^\s+(và|and)\s+/i)
      if (m) {
        push(buf, false)
        push(m[0], true)
        buf = ''
        i += m[0].length - 1
        continue
      }
    }
    buf += ch
  }
  push(buf, false)
  return out
}

export function Tt20Provider({ children }) {
  const [catalog, setCatalog] = useState(null)
  const [popover, setPopover] = useState(null) // { id, group, anchor }

  useEffect(() => {
    let alive = true
    const tryLoad = async (url) => {
      const r = await fetch(url)
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    }
    tryLoad('./data/tt20_bhyt.json')
      .catch(() => tryLoad('/data/tt20_bhyt.json'))
      .then((d) => { if (alive) setCatalog(Array.isArray(d) ? d : d?.items || []) })
      .catch(() => { if (alive) setCatalog([]) })
    return () => { alive = false }
  }, [])

  const index = useMemo(() => (catalog ? buildIndex(catalog) : null), [catalog])

  const toggle = useCallback((id, group, anchor) => {
    setPopover((p) => (p && p.id === id ? null : { id, group, anchor }))
  }, [])
  const close = useCallback(() => setPopover(null), [])

  const value = useMemo(
    () => ({ index, ready: !!catalog, popover, toggle, close }),
    [index, catalog, popover, toggle, close],
  )

  return (
    <Tt20Context.Provider value={value}>
      {children}
      {popover && <Tt20Popover key={popover.id} data={popover} onClose={close} />}
    </Tt20Context.Provider>
  )
}

export function useTt20() {
  return useContext(Tt20Context)
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const mark = (v) => (String(v || '').trim() ? '✓' : '—')

function tooltipFor(group) {
  return group.entries
    .map((e) => `${e.duongDung || '—'}: ĐB/I ${mark(e.hangDB_I)} · II ${mark(e.hangII)} · III/IV ${mark(e.hangIII_IV)} · Trạm YT ${mark(e.tramYT)}`)
    .join('\n')
}

/** A single clickable ingredient. */
export function IngredientLink({ text, group }) {
  const { popover, toggle } = useTt20()
  const id = useId()
  const ref = useRef(null)
  const active = popover?.id === id
  return (
    <button
      ref={ref}
      type="button"
      className={`ing-link${active ? ' active' : ''}`}
      title={`TT 20/2022 — ${group.name}\n${tooltipFor(group)}`}
      data-tt20-anchor={id}
      onClick={(e) => {
        e.stopPropagation()
        toggle(id, group, ref.current)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {text}
    </button>
  )
}

/** Render an ingredient cell, linking any tokens found in the TT20 catalog. */
export function IngredientText({ text }) {
  const { index } = useTt20()
  const segs = useMemo(() => tokenizeIngredients(text), [text])
  if (!text) return null
  if (!index) return <>{text}</>
  return (
    <>
      {segs.map((s, i) => {
        if (s.sep) return <span key={i}>{s.text}</span>
        const group = matchToken(index, s.text)
        if (!group) return <span key={i}>{s.text}</span>
        return <IngredientLink key={i} text={s.text} group={group} />
      })}
    </>
  )
}

function Tt20Popover({ data, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, placement: 'below' })
  const { group, anchor, id } = data

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      if (!el) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = el.offsetWidth
      const h = el.offsetHeight
      const r = anchor?.getBoundingClientRect?.() || { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2 }
      let left = Math.max(12, Math.min(r.left, vw - w - 12))
      let top = r.bottom + 8
      let placement = 'below'
      if (top + h > vh - 12 && r.top - h - 8 > 12) {
        top = r.top - h - 8
        placement = 'above'
      } else if (top + h > vh - 12) {
        top = Math.max(12, vh - h - 12)
      }
      setPos({ top, left, placement })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return
      if (e.target.closest?.(`[data-tt20-anchor="${id}"]`)) return // handled by toggle
      onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [id, onClose])

  return (
    <div
      ref={ref}
      className={`tt20-pop ${pos.placement}`}
      role="dialog"
      aria-label={`TT 20/2022 — ${group.name}`}
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="tt20-head">
        <div>
          <div className="tt20-kicker">Thông tư 20/2022/TT-BYT · Danh mục thuốc BHYT</div>
          <div className="tt20-title">{group.name}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="tt20-table-wrap">
        <table className="tt20-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>Đường dùng / dạng dùng</th>
              <th className="c">Hạng ĐB, I</th>
              <th className="c">Hạng II</th>
              <th className="c">Hạng III, IV</th>
              <th className="c">Trạm YT</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {group.entries.map((e, i) => (
              <tr key={i}>
                <td className="num">{e.stt ?? ''}</td>
                <td>{e.duongDung || '—'}</td>
                <Tick v={e.hangDB_I} />
                <Tick v={e.hangII} />
                <Tick v={e.hangIII_IV} />
                <Tick v={e.tramYT} />
                <td className="note">{e.ghiChu || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Tick({ v }) {
  const on = String(v || '').trim() !== ''
  return <td className={`c ${on ? 'tick on' : 'tick'}`}>{on ? '✓' : '—'}</td>
}

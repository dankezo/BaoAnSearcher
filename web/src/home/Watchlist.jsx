import { useEffect, useRef, useState } from 'react'
import { REGION_ORDER } from '../mapGeo'
import { loadUserJson, saveUserJson } from '../userPrefs'
import {
  PROVINCE_NAMES,
  WATCH_KEY,
  WATCH_STATUSES,
  cleanTopicName,
  countTopic,
  criteriaFromDraft,
  criterionEntries,
  defaultTopicName,
  dropCriterion,
  emptyDraft,
  hasCriteria,
  mergeCriteria,
  newWatchId,
  normalizeTopics,
  topicSentence,
} from './watchTopics'

function WatchDialog({ open, title, onClose, children }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])
  if (!open) return null
  return (
    <div className="home-sheet-root" role="presentation" onClick={onClose}>
      <aside
        className="home-sheet home-watch-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="home-sheet-bar">
          <h2>{title}</h2>
          <button type="button" className="home-icon-btn" onClick={onClose} aria-label="Đóng">×</button>
        </header>
        <div className="home-sheet-body">{children}</div>
      </aside>
    </div>
  )
}

const VALUE_KEY = {
  ingredient: 'ingredientText',
  strength: 'strengthText',
  form: 'formText',
  region: 'regionValue',
  province: 'provinceValue',
  company: 'companyText',
  contractor: 'contractorText',
  status: 'statusValue',
  sdk: 'sdkText',
}

function WatchBuilder({ draft, setDraft, onSubmit, submitLabel }) {
  const flag = (key, checked) => setDraft(current => {
    const next = { ...current, [key]: checked }
    if (!checked) next[VALUE_KEY[key]] = ''
    if (checked && key === 'status' && !next.statusValue) next.statusValue = 'open'
    return next
  })
  const text = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  const fieldClass = (on) => `home-watch-field${on ? ' is-on' : ' is-off'}`
  return (
    <form
      className="home-watch-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label className={fieldClass(draft.ingredient)}>
        <input type="checkbox" aria-label="Hoạt chất" checked={draft.ingredient} onChange={event => flag('ingredient', event.target.checked)} />
        <span>Hoạt chất</span>
        <input aria-label="Giá trị hoạt chất" value={draft.ingredientText} disabled={!draft.ingredient} placeholder="Metformin" onChange={event => text('ingredientText', event.target.value)} />
      </label>
      <label className={fieldClass(draft.strength)}>
        <input type="checkbox" aria-label="Hàm lượng" checked={draft.strength} onChange={event => flag('strength', event.target.checked)} />
        <span>Hàm lượng</span>
        <input aria-label="Giá trị hàm lượng" value={draft.strengthText} disabled={!draft.strength} placeholder="500mg" onChange={event => text('strengthText', event.target.value)} />
      </label>
      <label className={fieldClass(draft.form)}>
        <input type="checkbox" aria-label="Dạng bào chế" checked={draft.form} onChange={event => flag('form', event.target.checked)} />
        <span>Dạng bào chế</span>
        <input aria-label="Giá trị dạng bào chế" value={draft.formText} disabled={!draft.form} placeholder="Viên nén" onChange={event => text('formText', event.target.value)} />
      </label>
      <label className={fieldClass(draft.region)}>
        <input type="checkbox" aria-label="Khu vực" checked={draft.region} onChange={event => flag('region', event.target.checked)} />
        <span>Khu vực</span>
        <select aria-label="Chọn khu vực" value={draft.regionValue} disabled={!draft.region} onChange={event => text('regionValue', event.target.value)}>
          <option value="">Chọn khu vực</option>
          {REGION_ORDER.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className={fieldClass(draft.province)}>
        <input type="checkbox" aria-label="Tỉnh" checked={draft.province} onChange={event => flag('province', event.target.checked)} />
        <span>Tỉnh</span>
        <select aria-label="Chọn tỉnh" value={draft.provinceValue} disabled={!draft.province} onChange={event => text('provinceValue', event.target.value)}>
          <option value="">Chọn tỉnh</option>
          {PROVINCE_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className={fieldClass(draft.company)}>
        <input type="checkbox" aria-label="Công ty" checked={draft.company} onChange={event => flag('company', event.target.checked)} />
        <span>Công ty</span>
        <input aria-label="Giá trị công ty" value={draft.companyText} disabled={!draft.company} placeholder="Bên mời thầu hoặc nhà sản xuất" onChange={event => text('companyText', event.target.value)} />
      </label>
      <label className={fieldClass(draft.contractor)}>
        <input type="checkbox" aria-label="Nhà thầu" checked={draft.contractor} onChange={event => flag('contractor', event.target.checked)} />
        <span>Nhà thầu</span>
        <input aria-label="Giá trị nhà thầu" value={draft.contractorText} disabled={!draft.contractor} placeholder="Tên nhà thầu" onChange={event => text('contractorText', event.target.value)} />
      </label>
      <label className={fieldClass(draft.status)}>
        <input type="checkbox" aria-label="Trạng thái gói" checked={draft.status} onChange={event => flag('status', event.target.checked)} />
        <span>Trạng thái gói</span>
        <select aria-label="Chọn trạng thái" value={draft.statusValue} disabled={!draft.status} onChange={event => text('statusValue', event.target.value)}>
          {WATCH_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className={fieldClass(draft.sdk)}>
        <input type="checkbox" aria-label="SĐK mới liên quan hoạt chất" checked={draft.sdk} onChange={event => flag('sdk', event.target.checked)} />
        <span>SĐK mới liên quan hoạt chất</span>
        <input aria-label="Hoạt chất SĐK mới" value={draft.sdkText} disabled={!draft.sdk} placeholder="Hoạt chất của số đăng ký mới" onChange={event => text('sdkText', event.target.value)} />
      </label>
      <button type="button" className="home-watch-submit" onClick={onSubmit}>{submitLabel}</button>
    </form>
  )
}

function TopicNameField({ label, value, onChange, onBlur }) {
  return (
    <label className="home-watch-name">
      <span>Tên tiêu chí</span>
      <input
        aria-label={label}
        value={value}
        placeholder="Tiêu chí 1"
        onChange={event => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </label>
  )
}

function TopicEditor({ topic, index, onRename, onChange }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [hint, setHint] = useState('')
  const [draftName, setDraftName] = useState(topic.name || '')
  useEffect(() => { setDraftName(topic.name || '') }, [topic.name])
  const stack = () => {
    const extra = criteriaFromDraft(draft)
    if (!hasCriteria(extra)) {
      setHint('Chọn thêm một tiêu chí rồi bấm Gắn vào mục.')
      return
    }
    setHint('')
    onChange(mergeCriteria(topic.criteria, extra))
    setDraft(emptyDraft())
    setOpen(false)
  }
  return (
    <article className="home-watch-card">
      <TopicNameField
        label="Sửa tên tiêu chí"
        value={draftName}
        onChange={(value) => {
          const next = value.slice(0, 80)
          setDraftName(next)
          const cleaned = cleanTopicName(next)
          if (cleaned) onRename(cleaned)
        }}
        onBlur={() => {
          const next = cleanTopicName(draftName) || defaultTopicName(topic.criteria, index + 1)
          setDraftName(next)
          onRename(next)
        }}
      />
      <h3>{topicSentence(topic.criteria)}</h3>
      <div className="home-chips">
        {criterionEntries(topic.criteria).map(item => (
          <span key={item.key} className="home-criterion">
            {item.label}: {item.value}
            <button type="button" aria-label={`Bỏ ${item.label}`} onClick={() => onChange(dropCriterion(topic.criteria, item.key))}>Bỏ</button>
          </span>
        ))}
      </div>
      <div className="home-actions">
        <button type="button" className="home-text" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {open ? 'Đóng thêm tiêu chí' : 'Thêm tiêu chí'}
        </button>
        <button type="button" className="home-text" onClick={() => onChange({})}>Xóa mục</button>
      </div>
      {open && (
        <>
          <WatchBuilder draft={draft} setDraft={setDraft} onSubmit={stack} submitLabel="Gắn vào mục" />
          {hint && <p className="home-note">{hint}</p>}
        </>
      )}
    </article>
  )
}

export default function Watchlist({ user, rows, capped, expanded = false, onToggle, onTopics }) {
  const [topics, setTopics] = useState(() => normalizeTopics(loadUserJson(WATCH_KEY, user, [])))
  const [draft, setDraft] = useState(emptyDraft)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [hint, setHint] = useState('')
  const [open, setOpen] = useState(false)
  const preview = criteriaFromDraft(draft)
  const suggestedName = hasCriteria(preview) ? defaultTopicName(preview, topics.length + 1) : ''
  const nameValue = nameEdited ? name : suggestedName

  useEffect(() => {
    saveUserJson(WATCH_KEY, user, topics)
  }, [topics, user])

  useEffect(() => {
    onTopics?.(topics)
  }, [topics, onTopics])

  const confirm = () => {
    const criteria = criteriaFromDraft(draft)
    if (!hasCriteria(criteria)) {
      setHint('Chọn ít nhất một tiêu chí rồi bấm Xác nhận.')
      return
    }
    setHint('')
    const chosen = cleanTopicName(nameEdited ? name : defaultTopicName(criteria, topics.length + 1))
    setTopics(list => [...list, {
      id: newWatchId(),
      name: chosen || defaultTopicName(criteria, list.length + 1),
      criteria,
    }])
    setDraft(emptyDraft())
    setName('')
    setNameEdited(false)
    setOpen(false)
  }

  const updateTopic = (id, criteria) => {
    setTopics(list => (
      hasCriteria(criteria)
        ? list.map(item => (item.id === id ? { ...item, criteria } : item))
        : list.filter(item => item.id !== id)
    ))
  }

  const renameTopic = (id, nextName) => {
    setTopics(list => list.map((item, index) => (
      item.id === id
        ? { ...item, name: cleanTopicName(nextName) || defaultTopicName(item.criteria, index + 1) }
        : item
    )))
  }

  const openPanel = () => {
    setHint('')
    setDraft(emptyDraft())
    setName('')
    setNameEdited(false)
    setOpen(true)
  }

  const counted = topics.map(topic => countTopic(topic.criteria, rows, Date.now(), { capped }))
  const liveTopics = counted.filter(item => item.kind === 'live')
  const packageCount = liveTopics.reduce((sum, item) => sum + item.live, 0)
  const summary = topics.length
    ? (liveTopics.length
      ? `${topics.length.toLocaleString('vi-VN')} mục theo dõi · ${packageCount.toLocaleString('vi-VN')} gói trên trang đã tải`
      : `${topics.length.toLocaleString('vi-VN')} mục theo dõi`)
    : 'Chưa có mục theo dõi.'

  return (
    <article className={`home-radar-card home-watch${expanded ? ' on' : ''}`} aria-label="Mục theo dõi">
      <button
        type="button"
        className="home-open-toggle"
        aria-label="Mục theo dõi"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <strong>{topics.length.toLocaleString('vi-VN')}</strong>
        <span>Mục theo dõi</span>
        <span className="home-watch-brief">{summary}</span>
      </button>
      <button type="button" className="home-watch-launch" onClick={openPanel}>
        {topics.length ? 'Quản lý mục theo dõi' : 'Thêm'}
      </button>
      <WatchDialog
        open={open}
        title={topics.length ? 'Quản lý mục theo dõi' : 'Thêm mục theo dõi'}
        onClose={() => setOpen(false)}
      >
        {!!topics.length && (
          <div className="home-watch-cards">
            {topics.map((topic, index) => (
              <TopicEditor
                key={topic.id}
                topic={topic}
                index={index}
                onRename={nextName => renameTopic(topic.id, nextName)}
                onChange={criteria => updateTopic(topic.id, criteria)}
              />
            ))}
          </div>
        )}
        <p className="home-note">Đặt tên tiêu chí, tick hoạt chất, hàm lượng, dạng bào chế, khu vực, tỉnh, công ty, nhà thầu, trạng thái gói hoặc SĐK mới liên quan hoạt chất, rồi bấm Xác nhận.</p>
        <TopicNameField
          label="Tên tiêu chí"
          value={nameValue}
          onChange={(value) => {
            setNameEdited(true)
            setName(value.slice(0, 80))
          }}
        />
        <WatchBuilder draft={draft} setDraft={setDraft} onSubmit={confirm} submitLabel="Xác nhận" />
        {hint && <p className="home-note" role="status">{hint}</p>}
      </WatchDialog>
    </article>
  )
}

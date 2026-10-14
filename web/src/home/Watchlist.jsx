import * as DialogPrimitive from '@radix-ui/react-dialog'
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
 const retained=useRef({title,children});if(open)retained.current={title,children}
 return <DialogPrimitive.Root open={open} onOpenChange={value=>{if(!value)onClose()}}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="home-sheet-root"/><DialogPrimitive.Content className="home-sheet home-watch-sheet home-animated-sheet home-sheet-right-desktop" aria-describedby={undefined} aria-label={retained.current.title}><header className="home-sheet-bar"><DialogPrimitive.Title asChild><h2>{retained.current.title}</h2></DialogPrimitive.Title><DialogPrimitive.Close className="home-icon-btn" aria-label="Đóng">×</DialogPrimitive.Close></header><div className="home-sheet-body">{retained.current.children}</div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
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
  const fields = [
    ['ingredient','Hoạt chất','Metformin'], ['company','Bệnh viện / CĐT','Bệnh viện Đa khoa Sơn Tây'], ['province','Tỉnh',''],
    ['strength','Hàm lượng','500mg'], ['form','Dạng bào chế','Viên nén'], ['region','Khu vực',''],
    ['contractor','Nhà thầu','Tên nhà thầu'], ['status','Trạng thái gói',''], ['sdk','SĐK mới liên quan hoạt chất','Hoạt chất'],
  ]
  const text = (key, value) => setDraft(current => ({ ...current, [VALUE_KEY[key]]: value, [key]: Boolean(value.trim()) }))
  const render = ([key,label,placeholder]) => {
    const options = key==='province'?PROVINCE_NAMES.map(value=>[value,value]):key==='region'?REGION_ORDER.map(value=>[value,value]):key==='status'?WATCH_STATUSES:null
    return <label key={key} className="home-watch-field"><span>{label}</span>{options?
      <select aria-label={key==='province'?'Chọn tỉnh':key==='region'?'Chọn khu vực':'Chọn trạng thái'} value={draft[VALUE_KEY[key]]} onChange={event=>text(key,event.target.value)}><option value="">Tất cả</option>{options.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select>:
      <input aria-label={key==='ingredient'?'Giá trị hoạt chất':label} value={draft[VALUE_KEY[key]]} placeholder={placeholder} onChange={event=>text(key,event.target.value)}/>}</label>
  }
  return <form className="home-watch-form" onSubmit={event=>{event.preventDefault();onSubmit()}}>
    {fields.slice(0,3).map(render)}
    <details className="home-watch-more"><summary>Thêm điều kiện: hàm lượng, dạng, nhà thầu…</summary><div className="home-watch-form">{fields.slice(3).map(render)}</div></details>
    <button type="submit" className="home-watch-submit">{submitLabel}</button>
  </form>
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
        <p className="home-note">Nhập hoạt chất hoặc bệnh viện bạn quan tâm, rồi bấm Lưu theo dõi. Ô để trống sẽ không lọc.</p>
        <TopicNameField
          label="Tên tiêu chí"
          value={nameValue}
          onChange={(value) => {
            setNameEdited(true)
            setName(value.slice(0, 80))
          }}
        />
        <WatchBuilder draft={draft} setDraft={setDraft} onSubmit={confirm} submitLabel="Lưu theo dõi" />
        {hint && <p className="home-note" role="status">{hint}</p>}
      </WatchDialog>
    </article>
  )
}

import { useMemo } from 'react'
import { ShareBar, computeDavCompound } from '../../metrics'
import { metricHelp } from '../../metricHelp'
import type { DavMetricCard, DavMetricPatch, DrugItem } from '../../types/dav'

interface Props {
  error: string
  onRetry: () => void
  items: DrugItem[]
  cards: DavMetricCard[] | null
  total: number
  activeId: string | null
  onFilter: (patch: DavMetricPatch, id: string) => void
  loading: boolean
}
const titles = ['Mật độ SĐK/HC', 'Tag hồ sơ', 'Dạng bào chế', 'SĐK mới cấp']
const tones: Record<string, string> = { neutral: 'slate', ok: 'emerald', warn: 'amber', danger: 'rose' }
const TAG_PIE: Record<string, { label: string; color: string }> = {
  tag_xanh: { label: 'Sẵn sàng dự thầu', color: '#16a34a' },
  tag_vang: { label: 'Cần xác minh', color: '#ca8a04' },
  tag_cam: { label: 'Bẫy DM93', color: '#f97316' },
  tag_xam: { label: 'Đã hết hạn', color: '#64748b' },
}
function pieValue(count: string | number | undefined) {
  const raw = String(count ?? '').replace(/\./g, '').replace(',', '.')
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}
export function DavMetricCards({ items, cards, total, activeId, onFilter, loading, error, onRetry }: Props) {
  const display: DavMetricCard[] = useMemo(
    () => (cards?.length ? cards : computeDavCompound(items, total)),
    [cards, items, total],
  )
  if (error && !cards?.length) {
    return (
      <aside className="dav-metrics" aria-label="Chỉ số DAV">
        <div className="dav-metrics-error" role="status">
          {error}{' '}
          <button type="button" className="btn secondary sm" onClick={onRetry}>
            Thử lại chỉ số
          </button>
        </div>
      </aside>
    )
  }
  return (
    <aside className="dav-metrics" aria-label="Chỉ số DAV" aria-busy={loading}>
      {error && (
        <div className="dav-metrics-error" role="status">
          {error}{' '}
          <button type="button" className="btn secondary sm" onClick={onRetry}>
            Thử lại chỉ số
          </button>
        </div>
      )}
      {loading
        ? titles.map((title) => (
            <section className="dav-metric-card" key={title}>
              <h3>{title}</h3>
              <div className="dav-skeleton dav-skeleton-value" />
              <div className="dav-skeleton" />
              <span className="sr-only">Đang tải chỉ số</span>
            </section>
          ))
        : display.map((card) => (
            <section className="dav-metric-card" key={card.key} title={card.titleTip}>
              <h3>{card.key === 'density' ? 'Mật độ SĐK/HC' : (card.title || titles[0])}</h3>
              {card.key !== 'tags' && <div className="dav-metric-value">
                {error ? '--' : (card.mainValue ?? '0')} <small>{card.key === 'density' ? 'hoạt chất 1–2 SĐK' : card.unit}</small>
              </div>}
              {card.key === 'tags' && !error && (
                <ShareBar
                  label="Cơ cấu tag hồ sơ"
                  slices={card.subMetrics.map((item) => ({
                    key: item.id,
                    label: TAG_PIE[item.id]?.label || item.label,
                    color: TAG_PIE[item.id]?.color || '#94a3b8',
                    value: pieValue(item.count),
                  }))}
                />
              )}
              {card.key !== 'tags' && <p>{card.subtitle || '--'}</p>}
              <div className="dav-metric-badges">
                {card.subMetrics.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`dav-metric-badge tone-${tones[item.tone || 'neutral'] || 'slate'}${activeId === item.id ? ' on' : ''}`}
                    aria-pressed={activeId === item.id}
                    title={metricHelp(item)}
                    onKeyDown={(e) => { if (!item.info && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onFilter(item.patch || { _quick: item.id }, item.id) } }}
                    onDoubleClick={
                      item.info ? undefined : () => onFilter(item.patch || { _quick: item.id }, item.id)
                    }
                  >
                    <span>{TAG_PIE[item.id]?.label || item.label}</span>
                    <strong>{error ? '--' : (item.count ?? '0')}</strong>
                  </button>
                ))}
              </div>
            </section>
          ))}
    </aside>
  )
}

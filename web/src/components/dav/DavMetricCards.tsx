import { useMemo } from 'react'
import { computeDavCompound } from '../../metrics'
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
const titles = ['Mật độ SĐK', 'Tag hồ sơ', 'Dạng bào chế', 'SĐK mới cấp']
const tones: Record<string, string> = { neutral: 'slate', ok: 'emerald', warn: 'amber', danger: 'rose' }
export function DavMetricCards({ items, cards, total, activeId, onFilter, loading, error, onRetry }: Props) {
  const display: DavMetricCard[] = useMemo(
    () => (cards?.length ? cards : computeDavCompound(items, total)),
    [cards, items, total],
  )
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
        : display.map((card, i) => (
            <section className="dav-metric-card" key={card.key} title={card.titleTip}>
              <h3>{titles[i] ?? card.title}</h3>
              <div className="dav-metric-value">
                {error ? '--' : (card.mainValue ?? '0')} <small>{card.unit}</small>
              </div>
              <p>{card.subtitle || '--'}</p>
              <div className="dav-metric-badges">
                {card.subMetrics.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`dav-metric-badge tone-${tones[item.tone || 'neutral'] || 'slate'}${activeId === item.id ? ' on' : ''}`}
                    aria-pressed={activeId === item.id}
                    title={item.title || (item.info ? undefined : 'Nhấp đúp để lọc bảng bên dưới')}
                    onDoubleClick={
                      item.info ? undefined : () => onFilter(item.patch || { _quick: item.id }, item.id)
                    }
                  >
                    <span>{item.label}</span>
                    <strong>{error ? '--' : (item.count ?? '0')}</strong>
                  </button>
                ))}
              </div>
            </section>
          ))}
    </aside>
  )
}

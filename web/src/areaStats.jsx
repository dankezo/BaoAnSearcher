import { GroupShareBar, fmtInt, fmtPct, fmtVndCompact } from './metrics'
import { GROUP_COLORS } from './mapGeo'

const CSYT_TIP = 'Số cơ sở y tế (bệnh viện, trung tâm) có kết quả trong cửa sổ.'

export function Sparkline({ points = [], width = 168, height = 46 }) {
  const values = points.map((point) => Number(point.value) || 0)
  if (!values.length) return <span className="muted">Chưa có xu hướng</span>
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const d = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width
    const y = height - ((value - min) / span) * (height - 8) - 4
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg className="map-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function StatCards({
  stats,
  months = 12,
  title,
  note,
  showGroups = true,
  pending = false,
  hideHeader = false,
  trendLabel = '',
}) {
  if (pending || !stats || stats.value == null) {
    return (
      <div className="map-argus" aria-busy="true" aria-label="Chỉ số khu vực">
        {hideHeader
          ? <p className="metric-lead">Đang tải số liệu…</p>
          : (
            <header>
              <p className="metric-kicker">{title || 'Số liệu'}</p>
              <h2>Đang tải số liệu…</h2>
            </header>
          )}
      </div>
    )
  }
  const yoyClass = stats.yoy == null ? 'flat' : stats.yoy < 0 ? 'neg' : 'pos'
  const slices = GROUP_COLORS.map((color, index) => {
    const value = Number(stats.groups?.[index]) || 0
    return {
      key: `n${index + 1}`,
      label: `Nhóm ${index + 1}`,
      color,
      value,
    }
  })
  return (
    <div className="map-argus" aria-label="Chỉ số khu vực">
      {!hideHeader && (
        <header>
          <p className="metric-kicker">{title}</p>
          <h2>{stats.name || 'Bộ lọc hiện tại'}</h2>
          {note && <p className="metric-lead">{note}</p>}
        </header>
      )}
      <dl>
        <div>
          <dt>Giá trị {months} tháng</dt>
          <dd>{fmtVndCompact(stats.value)}</dd>
        </div>
        <div>
          <dt>Tăng/giảm cùng kỳ</dt>
          <dd className={yoyClass}>{stats.yoy == null ? 'Chưa có cùng kỳ' : fmtPct(stats.yoy)}</dd>
        </div>
        <div>
          <dt>Số phần/lô</dt>
          <dd>{fmtInt(stats.lots ?? 0)}</dd>
        </div>
        <div>
          <dt title={CSYT_TIP}>CSYT</dt>
          <dd title={CSYT_TIP}>{fmtInt(stats.facilities ?? 0)}</dd>
        </div>
        <div className="map-argus-trend">
          <dt>{trendLabel || `Xu hướng ${months} tháng`}</dt>
          <dd><Sparkline points={stats.trend} /></dd>
        </div>
      </dl>
      {showGroups && (
        <div className="map-argus-groups">
          <span>Cơ cấu nhóm 1–5</span>
          <GroupShareBar groups={stats.groups || []} />
          <ol className="share-legend map-group-legend">
            {slices.map((slice) => (
              <li key={slice.key}>
                <i style={{ background: slice.color }} />
                <span>{slice.label}</span>
                <em>{fmtVndCompact(slice.value)}</em>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

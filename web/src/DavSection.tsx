import { fmtDate, DAV_LOOKUP } from './api'
import { DetailModal, IngredientText, LoadingOverlay, UpdatedNote } from './components'
import { TagBadge } from './TagFilterDropdown'
import { ALL_COLS } from './components/dav/davConfig'
import { DavDataTable } from './components/dav/DavDataTable'
import { DavFilterSection } from './components/dav/DavFilterSection'
import { DavMetricCards } from './components/dav/DavMetricCards'
import { useDavSearch } from './hooks/useDavSearch'
import type { DavSectionProps } from './types/dav'
import './components/dav/dav.css'

export default function DavSection({ localMode, embedded = false, filtersInModal = false }: DavSectionProps) {
  const controller = useDavSearch({ localMode, embedded })
  const { meta, detail, setDetail, configs, loading, sim, exporting, exportPct } = controller
  return (
    <div className={`section${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="section-head">
          <div>
            <span className="kicker">Cục Quản lý Dược · dichvucong.dav.gov.vn</span>
            <h1>Tra cứu thuốc DAV</h1>
            <p>
              Danh mục số đăng ký — tag trạng thái SĐK, khớp danh mục 93 / TT20, nhấp kính lúp để copy tên
              thuốc và mở trang công bố.
            </p>
          </div>
          <UpdatedNote updated={meta.updated} count={meta.count} />
        </header>
      )}

      <div className="panel">
        <div className="filters dav-filters">
          <div className={`filters-split${embedded ? ' no-stats' : ''}`}>
            <DavFilterSection
              controller={controller}
              localMode={localMode}
              embedded={embedded}
              filtersInModal={filtersInModal}
            />
            {!embedded && (
              <DavMetricCards
                error={controller.metricsError}
                onRetry={controller.retryMetrics}
                items={controller.metricsItems}
                cards={controller.metricsCards}
                total={controller.metricsTotal ?? controller.metricsSample?.length ?? controller.data.total}
                activeId={controller.metricActiveId}
                onFilter={controller.onMetricFilter}
                loading={
                  controller.metricsLoading ||
                  (controller.metricsSample === null && controller.metricsCards === null)
                }
              />
            )}
          </div>
        </div>
        <DavDataTable controller={controller} embedded={embedded} />
      </div>

      <DetailModal
        row={detail}
        fields={[
          ...ALL_COLS,
          { key: 'ngayGiaHan', label: 'Ngày gia hạn', text: (r) => fmtDate(r.ngayGiaHan) },
          { key: 'conHieuLuc', label: 'Còn hiệu lực' },
          { key: 'ingredientCount', label: 'Số SĐK cùng HC' },
        ]}
        title={detail?.tenThuoc || 'Chi tiết thuốc'}
        subtitle={detail ? `SĐK ${detail.soDangKy}` : ''}
        sourceUrl={DAV_LOOKUP}
        onClose={() => setDetail(null)}
        renderValue={(f, row, val) => {
          if (f.key === 'hoatChat') return <IngredientText text={row.hoatChat} />
          if (f.key === 'tagId') return <TagBadge tagId={row.tagId} configs={configs} detailed />
          return val
        }}
      />
      <LoadingOverlay
        show={loading}
        percent={sim.percent}
        message={sim.message}
        etaSec={sim.etaSec}
        onCancel={controller.cancelSearch}
      />
      <LoadingOverlay
        show={exporting}
        percent={exportPct}
        message="Đang gom dữ liệu để xuất Excel…"
        onCancel={controller.cancelExport}
      />
    </div>
  )
}

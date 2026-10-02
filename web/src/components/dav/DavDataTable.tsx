import { useState } from 'react'
import { DataTable, ErrorNote, Icons, Pagination, TableToolbar } from '../../components'
import { openDavLookup } from '../../api'
import { SERVER_MAP } from './davConfig'
import type { DavSearchController } from '../../hooks/useDavSearch'
import type { DrugItem } from '../../types/dav'
export function DavDataTable({
  controller,
  embedded = false,
}: {
  controller: DavSearchController
  embedded?: boolean
}) {
  const {
    sel,
    doExport,
    exporting,
    filtersRow,
    setFiltersRow,
    activeCF,
    search,
    runSearch,
    err,
    cols,
    rows,
    rowKey,
    page,
    pageSizeNum,
    columnFilters,
    setCF,
    searchColumn,
    clearColumnFilters,
    fieldSuggest,
    setDetail,
    loading,
    data,
    pageSize,
    setPageSize,
    setPage,
  } = controller
  const [hiddenColumns, setHiddenColumns] = useState<Set<keyof DrugItem>>(new Set())
  const visibleColumns = cols.filter((col) => !hiddenColumns.has(col.key))
  return (
    <>
      <TableToolbar
        kicker="Bảng chính"
        title={embedded ? 'DAV' : 'Danh mục số đăng ký'}
        selectedCount={sel.size}
        onClearSelection={sel.clear}
        onExport={doExport}
        exporting={exporting}
        filtersVisible={filtersRow}
        onToggleFilters={() => setFiltersRow((v) => !v)}
        activeColumnFilters={activeCF}
        onClearColumnFilters={clearColumnFilters}
      >
        <details className="dav-column-picker">
          <summary className="btn ghost sm">{Icons.columns} Ẩn/hiện cột</summary>
          <div className="dav-column-options">
            {cols.map((col) => (
              <label key={col.key}>
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(col.key)}
                  disabled={visibleColumns.length === 1 && !hiddenColumns.has(col.key)}
                  onChange={() =>
                    setHiddenColumns((previous) => {
                      const next = new Set(previous)
                      if (next.has(col.key)) next.delete(col.key)
                      else next.add(col.key)
                      return next
                    })
                  }
                />
                {col.label}
              </label>
            ))}
          </div>
        </details>
        <button type="button" className="btn ghost sm" onClick={() => runSearch()} title="Quét lại dữ liệu">
          {Icons.refresh} Quét lại
        </button>
      </TableToolbar>

      <ErrorNote>
        {err && (
          <div role="alert">
            {err}{' '}
            <button
              type="button"
              className="btn secondary sm"
              disabled={loading}
              onClick={() => search(page)}
            >
              Thử lại
            </button>
          </div>
        )}
      </ErrorNote>

      <DataTable
        columns={visibleColumns}
        rows={rows}
        rowKey={rowKey}
        startIndex={page * pageSizeNum}
        selected={sel.selected}
        onToggleRow={sel.toggle}
        onToggleAll={sel.setMany}
        columnFilters={columnFilters}
        onColumnFilter={setCF}
        filtersVisible={filtersRow}
        onFilterEnter={searchColumn}
        onFilterSuggest={async (key, q) => {
          const mapKey = SERVER_MAP[key as keyof DrugItem] || key
          return fieldSuggest(mapKey)(q)
        }}
        onRowDoubleClick={setDetail}
        loading={loading}
        emptyText="Không có dữ liệu phù hợp"
        emptyAction={
          <button type="button" className="btn" onClick={() => runSearch()}>
            {Icons.refresh} Tìm kiếm lại
          </button>
        }
        cardKeys={['tenThuoc', 'soDangKy', 'hoatChat', 'ngayHetHan', 'tagId']}
        minWidth={embedded ? 720 : 1100}
        trailing={{
          label: 'Tra cứu',
          render: (row) => (
            <button
              type="button"
              className="icon-btn accent"
              title="Copy tên thuốc & mở DAV"
              onClick={() => openDavLookup(row.tenThuoc)}
            >
              {Icons.search}
            </button>
          ),
        }}
      />
      <Pagination
        page={page}
        size={pageSizeNum}
        total={data.total}
        hasMore={data.hasMore}
        shown={rows.length}
        onPage={(p) => search(p)}
        pageSize={pageSize}
        onPageSize={(v) => {
          setPageSize(v)
          setPage(0)
        }}
        extra={sel.size > 0 && <span className="chip">{sel.size} dòng đã chọn</span>}
      />
    </>
  )
}

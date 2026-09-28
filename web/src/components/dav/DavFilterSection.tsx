import {
  CountSelect,
  FilterModal,
  HospitalGradeField,
  Icons,
  MultiSelectField,
  SearchSuggestBar,
  SuggestField,
} from '../../components'
import { TagFilterDropdown } from '../../TagFilterDropdown'
import { EMPTY_FILTERS } from './davConfig'
import { api, davErrorMessage } from '../../services/davService'
import type { DavSearchController } from '../../hooks/useDavSearch'
import type { DavSectionProps } from '../../types/dav'
export function DavFilterSection({
  controller,
  localMode,
  embedded = false,
  filtersInModal = false,
}: DavSectionProps & { controller: DavSearchController }) {
  const {
    filters,
    setFilters,
    setColumnFilters,
    setSuggests,
    setDraftTags,
    configs,
    setErr,
    setF,
    runSearch,
    fieldSuggest,
    suggests,
    suggestOpen,
    setSuggestOpen,
    loading,
    suggesting,
    setDetail,
    draftTags,
    userId,
    advancedActive,
    setFilterModalOpen,
    filterModalOpen,
  } = controller
  const detailFields = (
    <div className="filter-grid tight">
      <SuggestField
        label="Tên thuốc"
        value={filters.tenThuoc}
        onChange={(v) => setF('tenThuoc', v)}
        onSearch={(v) => runSearch({ tenThuoc: v })}
        suggest={fieldSuggest('tenThuoc')}
      />
      <SuggestField
        label="Số ĐK"
        value={filters.soDangKy}
        onChange={(v) => setF('soDangKy', v)}
        onSearch={(v) => runSearch({ soDangKy: v })}
        suggest={fieldSuggest('soDangKy')}
      />
      <SuggestField
        label="Hoạt chất"
        value={filters.hoatChat}
        onChange={(v) => setF('hoatChat', v)}
        onSearch={(v) => runSearch({ hoatChat: v })}
        suggest={fieldSuggest('hoatChat')}
      />
      <SuggestField
        label="Dạng bào chế"
        value={filters.dangBaoChe}
        onChange={(v) => setF('dangBaoChe', v)}
        onSearch={(v) => runSearch({ dangBaoChe: v })}
        suggest={fieldSuggest('dangBaoChe')}
      />
      <SuggestField
        label="Công ty SX"
        value={filters.sanXuat}
        onChange={(v) => setF('sanXuat', v)}
        onSearch={(v) => runSearch({ sanXuat: v })}
        suggest={fieldSuggest('sanXuat')}
      />
      <SuggestField
        label="Công ty ĐK"
        value={filters.dangKy}
        onChange={(v) => setF('dangKy', v)}
        onSearch={(v) => runSearch({ dangKy: v })}
        suggest={fieldSuggest('dangKy')}
      />
      <MultiSelectField
        label="Nước SX"
        value={filters.nuocSanXuat}
        onChange={(v) => setF('nuocSanXuat', v)}
        suggest={fieldSuggest('nuocSanXuat')}
        placeholder="Chọn nước…"
      />
      <HospitalGradeField value={filters.hangBenhVien} onChange={(v) => setF('hangBenhVien', v)} />
      <CountSelect
        label="Số hoạt chất"
        value={filters.ingredientCount}
        otherValue={filters.ingredientCountOther}
        options={[1, 2, 3, 4, 5]}
        onChange={(v) => setF('ingredientCount', v)}
        onOther={(v) => setF('ingredientCountOther', v)}
      />
      <CountSelect
        label="Số dạng bào chế (nhóm HC)"
        value={filters.dosageFormCount}
        otherValue={filters.dosageFormCountOther}
        options={[1, 2, 3, 4, 5, 6, 7]}
        onChange={(v) => setF('dosageFormCount', v)}
        onOther={(v) => setF('dosageFormCountOther', v)}
      />
      <CountSelect
        label="Mức hàm lượng (nhóm HC)"
        value={filters.strengthCount}
        otherValue={filters.strengthCountOther}
        options={[1, 3, 4, 5]}
        onChange={(v) => setF('strengthCount', v)}
        onOther={(v) => setF('strengthCountOther', v)}
      />
    </div>
  )

  return (
    <>
      <div className="filters-left">
        <SearchSuggestBar
          value={filters.q}
          onChange={(v) => setF('q', v)}
          onSubmit={() => runSearch()}
          suggestions={suggests}
          open={suggestOpen}
          onOpenChange={setSuggestOpen}
          loading={loading || suggesting}
          hint="Gõ gợi ý · tick trạng thái rồi bấm Tìm kiếm"
          onPick={(s) => {
            const row = s.row
            const q = row?.tenThuoc || s.title || filters.q
            setFilters((f) => ({ ...f, q }))
            setSuggestOpen(false)
            if (row) setDetail(row)
            runSearch({ q })
          }}
        />
        <div className="filter-actions">
          <TagFilterDropdown
            selectedTags={draftTags}
            onChange={setDraftTags}
            configs={configs}
            userId={userId}
            deferApply
          />
          {filtersInModal ? (
            <button
              type="button"
              className={`btn ghost${advancedActive ? ' on' : ''}`}
              onClick={() => setFilterModalOpen(true)}
            >
              {Icons.filter} Bộ lọc chi tiết
              {advancedActive > 0 && <span className="pill">{advancedActive}</span>}
            </button>
          ) : null}
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setFilters(EMPTY_FILTERS)
              setColumnFilters({})
              setSuggests([])
              setDraftTags(configs.map((c) => c.id))
            }}
          >
            Xóa lọc
          </button>
          {localMode && !embedded && (
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                api
                  .davValidity()
                  .then(() => runSearch())
                  .catch((e) => setErr(davErrorMessage(e)))
              }
            >
              Rebuild tập hiệu lực
            </button>
          )}
        </div>
        {!filtersInModal && detailFields}
        {draftTags.length === 0 && (
          <div className="tag-empty-hint">Chọn ít nhất một phân loại tag, rồi bấm Tìm kiếm.</div>
        )}
      </div>
      <FilterModal
        open={filtersInModal && filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onApply={() => runSearch()}
      >
        {detailFields}
      </FilterModal>
    </>
  )
}

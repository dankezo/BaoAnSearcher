import { useEffect, useRef, useState } from 'react'
import {
  CountSelect,
  FilterModal,
  Icons,
  MultiSelectField,
  SuggestField,
} from '../../components'
import { TagFilterDropdown } from '../../TagFilterDropdown'
import { EMPTY_FILTERS } from './davConfig'
import { api, davErrorMessage } from '../../services/davService'
import type { DavSearchController } from '../../hooks/useDavSearch'
import type { DavFilters, DavSectionProps } from '../../types/dav'

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
    applyFilters,
    fieldSuggest,
    draftTags,
    userId,
    setFilterModalOpen,
    filterModalOpen,
  } = controller
  const draftRef = useRef(filters)
  const [draft, setDraft] = useState(filters)
  const appliedKey = JSON.stringify(filters)
  useEffect(() => {
    const next = JSON.parse(appliedKey) as DavFilters
    draftRef.current = next
    setDraft(next)
  }, [appliedKey])

  const setLocal = <K extends keyof DavFilters>(key: K, val: DavFilters[K]) => {
    const next = { ...draftRef.current, [key]: val }
    draftRef.current = next
    setDraft(next)
  }
  const commit = (override?: Partial<DavFilters>) => {
    const next = { ...draftRef.current, ...(override || {}) }
    draftRef.current = next
    setDraft(next)
    applyFilters(next)
  }
  const advancedActive = [
    draft.tenThuoc,
    draft.soDangKy,
    draft.hoatChat,
    draft.drugGroup,
    draft.tenderGroup,
    draft.dangBaoChe,
    draft.sanXuat,
    draft.dangKy,
    draft.nuocSanXuat,
    draft.ingredientCount,
    draft.dosageFormCount,
    draft.strengthCount,
  ].filter((v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '')).length

  const detailFields = (
    <div className="filter-grid tight cols-4">
      <SuggestField
        label="Hoạt chất"
        value={draft.hoatChat}
        onChange={(v) => setLocal('hoatChat', v)}
        onSearch={(v) => commit({ hoatChat: v })}
        suggest={fieldSuggest('hoatChat')}
      />
      <MultiSelectField
        label="Phân loại thuốc"
        value={draft.drugGroup}
        onChange={(v) => setLocal('drugGroup', v)}
        suggest={fieldSuggest('drugGroup')}
        placeholder="Chọn phân loại…"
      />
      {localMode && (
        <MultiSelectField
          label="Nhóm thầu (VSS theo SĐK)"
          hint="Dữ liệu thầu, không phải phân loại DAV"
          value={draft.tenderGroup}
          onChange={(v) => setLocal('tenderGroup', v)}
          options={['Nhóm 1', 'Nhóm 2', 'Nhóm 3', 'Nhóm 4', 'Nhóm 5']}
          placeholder="Chọn nhóm thầu…"
        />
      )}
      <SuggestField
        label="Tên thuốc"
        value={draft.tenThuoc}
        onChange={(v) => setLocal('tenThuoc', v)}
        onSearch={(v) => commit({ tenThuoc: v })}
        suggest={fieldSuggest('tenThuoc')}
      />
      <SuggestField
        label="Số ĐK"
        value={draft.soDangKy}
        onChange={(v) => setLocal('soDangKy', v)}
        onSearch={(v) => commit({ soDangKy: v })}
        suggest={fieldSuggest('soDangKy')}
      />
      <SuggestField
        label="Dạng bào chế"
        value={draft.dangBaoChe}
        onChange={(v) => setLocal('dangBaoChe', v)}
        onSearch={(v) => commit({ dangBaoChe: v })}
        suggest={fieldSuggest('dangBaoChe')}
      />
      <MultiSelectField
        label="Nước SX"
        value={draft.nuocSanXuat}
        onChange={(v) => setLocal('nuocSanXuat', v)}
        suggest={fieldSuggest('nuocSanXuat')}
        placeholder="Chọn nước…"
      />
      <SuggestField
        label="Công ty SX"
        value={draft.sanXuat}
        onChange={(v) => setLocal('sanXuat', v)}
        onSearch={(v) => commit({ sanXuat: v })}
        suggest={fieldSuggest('sanXuat')}
      />
      <SuggestField
        label="Công ty ĐK"
        value={draft.dangKy}
        onChange={(v) => setLocal('dangKy', v)}
        onSearch={(v) => commit({ dangKy: v })}
        suggest={fieldSuggest('dangKy')}
      />
      <CountSelect
        label="Số SĐK cùng hoạt chất"
        value={draft.ingredientCount}
        otherValue={draft.ingredientCountOther}
        options={['1-2', '3-5', '6+', 1, 2, 3, 4, 5]}
        onChange={(v) => setLocal('ingredientCount', v)}
        onOther={(v) => setLocal('ingredientCountOther', v)}
      />
      <CountSelect
        label="Số dạng bào chế (nhóm HC)"
        value={draft.dosageFormCount}
        otherValue={draft.dosageFormCountOther}
        options={[1, 2, 3, 4, 5, 6, 7]}
        onChange={(v) => setLocal('dosageFormCount', v)}
        onOther={(v) => setLocal('dosageFormCountOther', v)}
      />
      <CountSelect
        label="Mức hàm lượng (nhóm HC)"
        value={draft.strengthCount}
        otherValue={draft.strengthCountOther}
        options={[1, 3, 4, 5]}
        onChange={(v) => setLocal('strengthCount', v)}
        onOther={(v) => setLocal('strengthCountOther', v)}
      />
    </div>
  )

  return (
    <>
      <div className="filters-left">
        <div className="filter-actions">
          <TagFilterDropdown
            selectedTags={draftTags}
            onChange={setDraftTags}
            configs={configs}
            userId={userId}
            deferApply
          />
          <button type="button" className="btn" onClick={() => commit()}>{Icons.search} Tìm kiếm</button>
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
              draftRef.current = EMPTY_FILTERS
              setDraft(EMPTY_FILTERS)
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
                  .then(() => commit())
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
        onApply={() => commit()}
      >
        {detailFields}
      </FilterModal>
    </>
  )
}
